// LeadHunter — Server con scraping + MercadoPago + Dashboard + Pro
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const scrapers = require('./scrapers');
let proFeatures;
try {
    proFeatures = require('./pro-features');
} catch (e) {
    proFeatures = { DailyAutomation: class { listJobs(){return []} scheduleDaily(){return{}} toggleJob(){return{}} deleteJob(){} }, LeadAlerts: class { listAlerts(){return []} createAlert(){return{}} toggleAlert(){return{}} deleteAlert(){} }, exportToExcel: ()=>'', exportToHubspot: ()=>[], exportToPipedrive: ()=>[], getAdvancedStats: ()=>({}) };
}

const app = express();
const PORT = process.env.PORT || 3003;

// =================== CONFIG ===================
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(16).toString('hex');
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

// Email helper
async function sendEmail(to, subject, html) {
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
        console.log(`📧 [EMAIL DISABLED] To: ${to} | Subject: ${subject}`);
        return false;
    }
    try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: SMTP_HOST.includes('465'),
            auth: { user: SMTP_USER, pass: SMTP_PASS }
        });
        await transporter.sendMail({ from: `"LeadHunter" <${SMTP_USER}>`, to, subject, html });
        console.log(`📧 Email sent to ${to}: ${subject}`);
        return true;
    } catch (err) {
        console.error('📧 Email error:', err.message);
        return false;
    }
}

// =================== PERSISTENT DATA ===================
// Render free tier wipes /app on redeploy. Use /tmp as fallback.
// In production, configure RENDER_DISK_MOUNT_PATH for true persistence.
const DISK_PATH = process.env.RENDER_DISK_MOUNT_PATH || '';
const DATA_DIR = DISK_PATH ? path.join(DISK_PATH, 'leadhunter-data') : path.join(__dirname, 'data');

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(filePath, fallback = '[]') {
    try {
        ensureDataDir();
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        try { return JSON.parse(fallback); } catch { return []; }
    }
}

function writeJSON(filePath, data) {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

const ALL_LEADS = path.join(DATA_DIR, 'all-leads.json');
const SUBSCRIPTIONS = path.join(DATA_DIR, 'subscriptions.json');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const SEARCH_USAGE_FILE = path.join(DATA_DIR, 'search-usage.json');
const API_KEY_FILE = path.join(DATA_DIR, 'api-key.json');

ensureDataDir();
if (!fs.existsSync(ALL_LEADS)) writeJSON(ALL_LEADS, []);
if (!fs.existsSync(SUBSCRIPTIONS)) writeJSON(SUBSCRIPTIONS, []);
if (!fs.existsSync(EVENTS_FILE)) writeJSON(EVENTS_FILE, []);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =================== RATE LIMITING ===================
const RATE_LIMITS = {};
function rateLimit(key, maxRequests, windowMs) {
    const now = Date.now();
    if (!RATE_LIMITS[key]) RATE_LIMITS[key] = [];
    RATE_LIMITS[key] = RATE_LIMITS[key].filter(t => now - t < windowMs);
    if (RATE_LIMITS[key].length >= maxRequests) return false;
    RATE_LIMITS[key].push(now);
    return true;
}

// Cleanup old rate limits every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const key in RATE_LIMITS) {
        RATE_LIMITS[key] = RATE_LIMITS[key].filter(t => now - t < 600000);
        if (RATE_LIMITS[key].length === 0) delete RATE_LIMITS[key];
    }
}, 300000);

// =================== FREE TIER RATE LIMITING ===================
const FREE_SEARCH_LIMIT = 3;
const searchUsage = readJSON(SEARCH_USAGE_FILE, '{}');

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
}

function getTodayKey() {
    return new Date().toISOString().split('T')[0];
}

function getUsageCount(ip) {
    const today = getTodayKey();
    const record = searchUsage[ip];
    if (!record || record.date !== today) {
        searchUsage[ip] = { date: today, count: 0 };
        return 0;
    }
    return record.count;
}

function incrementUsage(ip) {
    const today = getTodayKey();
    if (!searchUsage[ip] || searchUsage[ip].date !== today) {
        searchUsage[ip] = { date: today, count: 0 };
    }
    searchUsage[ip].count++;
    writeJSON(SEARCH_USAGE_FILE, searchUsage);
    return searchUsage[ip].count;
}

// Cleanup old entries daily
setInterval(() => {
    const today = getTodayKey();
    for (const ip in searchUsage) {
        if (searchUsage[ip].date !== today) delete searchUsage[ip];
    }
}, 60 * 60 * 1000);

// =================== PRICING ===================
const PRICING = {
    basico: {
        mensual: { price: 4970, id: process.env.MP_BASICO_MENSUAL || '' },
        anual: { price: 3970, id: process.env.MP_BASICO_ANUAL || '' }
    },
    pro: {
        mensual: { price: 14900, id: process.env.MP_PRO_MENSUAL || '' },
        anual: { price: 11900, id: process.env.MP_PRO_ANUAL || '' }
    },
    enterprise: {
        mensual: { price: 29900, id: process.env.MP_ENTERPRISE_MENSUAL || '' },
        anual: { price: 23900, id: process.env.MP_ENTERPRISE_ANUAL || '' }
    }
};

// =================== EVENTS LOG ===================
function logEvent(type, email, plan, amount, extra = {}) {
    const events = readJSON(EVENTS_FILE, '[]');
    events.push({ type, email, plan, amount, ...extra, timestamp: new Date().toISOString() });
    writeJSON(EVENTS_FILE, events);
}

// =================== ADMIN AUTH ===================
function requireAdmin(req, res, next) {
    const token = req.headers['x-admin-token'] || req.query.token;
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Token de admin inválido' });
    }
    next();
}

// =================== API KEY CONFIG ===================
function getApiKey() {
    const envKey = process.env.GOOGLE_MAPS_API_KEY || '';
    let fileKey = '';
    try { fileKey = JSON.parse(fs.readFileSync(API_KEY_FILE, 'utf8')).key || ''; } catch (e) {}
    return envKey || fileKey;
}

app.get('/api/admin/key', requireAdmin, (req, res) => {
    const key = getApiKey();
    res.json({ configured: !!key, key: key ? key.substring(0, 8) + '...' : '' });
});

app.post('/api/admin/key', requireAdmin, (req, res) => {
    const { key } = req.body;
    if (!key || typeof key !== 'string' || key.length < 10) {
        return res.status(400).json({ error: 'API key inválida' });
    }
    try {
        writeJSON(API_KEY_FILE, { key, updatedAt: new Date().toISOString() });
        process.env.GOOGLE_MAPS_API_KEY = key;
        res.json({ success: true, message: 'API key guardada.' });
    } catch (err) {
        res.status(500).json({ error: 'Error al guardar: ' + err.message });
    }
});

app.get('/api/admin/status', requireAdmin, (req, res) => {
    const key = getApiKey();
    res.json({
        apiKey: !!key,
        mercadopago: !!MP_ACCESS_TOKEN,
        adminToken: ADMIN_TOKEN.substring(0, 8) + '...',
        nodeEnv: process.env.NODE_ENV || 'development',
        uptime: process.uptime(),
        dataDir: DATA_DIR,
        persistentDisk: !!DISK_PATH
    });
});

// =================== ADMIN: SUBSCRIBERS ===================
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/subscribers', requireAdmin, (req, res) => {
    const subs = readJSON(SUBSCRIPTIONS, '[]');
    const active = subs.filter(s => s.status === 'active');
    const cancelled = subs.filter(s => s.status === 'cancelled' || s.status === 'paused');
    const totalRevenue = subs.reduce((sum, s) => sum + (s.amount || 0), 0);
    const mrr = active.reduce((sum, s) => sum + (s.amount || 0), 0);

    res.json({
        subscribers: subs,
        total: subs.length,
        active: active.length,
        cancelled: cancelled.length,
        totalRevenue,
        mrr
    });
});

app.get('/api/admin/events', requireAdmin, (req, res) => {
    const events = readJSON(EVENTS_FILE, '[]');
    res.json({ events: events.slice(-100) }); // Last 100 events
});

// =================== SUBSCRIPTION CHECK ===================
function hasActiveSubscription(email) {
    if (!email) return false;
    const subs = readJSON(SUBSCRIPTIONS, '[]');
    return subs.some(s => s.email === email && s.status === 'active');
}

app.get('/api/subscription/check', (req, res) => {
    const email = req.query.email;
    if (!email) return res.json({ active: false, error: 'Email requerido' });
    const active = hasActiveSubscription(email);
    res.json({ active, email });
});

// =================== SYNC WITH MERCADOPAGO ===================
// Periodically sync subscription status from MP API (backup for webhook failures)
async function syncSubscriptionsFromMP() {
    if (!MP_ACCESS_TOKEN) return;
    try {
        const mpRes = await fetch('https://api.mercadopago.com/preapproval/search?limit=50', {
            headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
        });
        const data = await mpRes.json();
        if (!data.results) return;

        const subs = readJSON(SUBSCRIPTIONS, '[]');
        let changed = false;

        for (const preapproval of data.results) {
            const existing = subs.find(s => s.preapprovalId === preapproval.id);

            if (preapproval.status === 'authorized' || preapproval.status === 'active') {
                if (!existing) {
                    subs.push({
                        email: preapproval.payer_email || '',
                        plan: preapproval.reason || 'unknown',
                        preapprovalId: preapproval.id,
                        status: 'active',
                        amount: preapproval.auto_recurring?.transaction_amount || 0,
                        createdAt: preapproval.date_created || new Date().toISOString(),
                        lastSync: new Date().toISOString()
                    });
                    changed = true;
                    logEvent('sync_new', preapproval.payer_email, preapproval.reason, preapproval.auto_recurring?.transaction_amount);
                } else if (existing.status !== 'active') {
                    existing.status = 'active';
                    existing.lastSync = new Date().toISOString();
                    changed = true;
                    logEvent('sync_reactivated', preapproval.payer_email, preapproval.reason, preapproval.auto_recurring?.transaction_amount);
                }
            } else if (preapproval.status === 'cancelled' || preapproval.status === 'ended') {
                if (existing && existing.status !== 'cancelled') {
                    existing.status = 'cancelled';
                    existing.cancelledAt = new Date().toISOString();
                    existing.lastSync = new Date().toISOString();
                    changed = true;
                    logEvent('sync_cancelled', preapproval.payer_email, preapproval.reason, preapproval.auto_recurring?.transaction_amount);

                    // Notify admin
                    if (ADMIN_EMAIL) {
                        sendEmail(ADMIN_EMAIL, '🔴 Baja detectada (sync) LeadHunter',
                            `<h2>Suscripción cancelada (detectado por sync)</h2><p><b>Email:</b> ${preapproval.payer_email}</p><p><b>Plan:</b> ${preapproval.reason}</p>`);
                    }
                }
            } else if (preapproval.status === 'paused') {
                if (existing && existing.status !== 'paused') {
                    existing.status = 'paused';
                    existing.lastSync = new Date().toISOString();
                    changed = true;
                }
            }
        }

        if (changed) {
            writeJSON(SUBSCRIPTIONS, subs);
            console.log('🔄 Subscription sync completed');
        }
    } catch (err) {
        console.error('🔄 Sync error:', err.message);
    }
}

// Run sync every 15 minutes
setInterval(syncSubscriptionsFromMP, 15 * 60 * 1000);
// Run initial sync on startup
setTimeout(syncSubscriptionsFromMP, 5000);

// =================== USAGE ENDPOINT ===================
app.get('/api/usage', (req, res) => {
    const ip = getClientIP(req);
    const used = getUsageCount(ip);
    res.json({ used, limit: FREE_SEARCH_LIMIT, remaining: Math.max(0, FREE_SEARCH_LIMIT - used) });
});

// =================== DEMO ENDPOINT ===================
app.post('/api/demo', async (req, res) => {
    const { rubro, ciudad, max = 5 } = req.body;
    if (!rubro || !ciudad) return res.json({ leads: [], error: 'Faltan rubro y ciudad' });

    // Rate limit: 5 requests per minute per IP
    const ip = getClientIP(req);
    if (!rateLimit(`demo:${ip}`, 5, 60000)) {
        return res.status(429).json({ error: 'Muchas solicitudes. Esperá un minuto.' });
    }

    const used = getUsageCount(ip);
    if (used >= FREE_SEARCH_LIMIT) {
        return res.json({
            leads: [],
            error: 'limit_reached',
            message: `Alcanzaste las ${FREE_SEARCH_LIMIT} búsquedas gratis del día. Upgrade a un plan para continuar.`,
            used,
            limit: FREE_SEARCH_LIMIT
        });
    }

    if (!getApiKey()) {
        return res.json({
            leads: [],
            error: 'API key de Google no configurada.',
            setupRequired: true
        });
    }
    process.env.GOOGLE_MAPS_API_KEY = getApiKey();

    try {
        const leads = await scrapers.searchAll(rubro, ciudad, Math.max(max, 10));
        incrementUsage(ip);
        res.json({ leads: leads.slice(0, max), usage: { used: used + 1, limit: FREE_SEARCH_LIMIT, remaining: Math.max(0, FREE_SEARCH_LIMIT - used - 1) } });
    } catch (err) {
        console.error('Demo error:', err.message);
        res.json({ leads: [], error: err.message });
    }
});

// =================== CHECKOUT (MercadoPago) ===================
// Step 1: Capture email before redirecting to MP
app.post('/api/checkout', async (req, res) => {
    const { plan, billing, email } = req.body;

    if (!PRICING[plan]) return res.status(400).json({ error: 'Plan inválido' });
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email inválido' });

    const planData = PRICING[plan][billing];
    if (!planData) return res.status(400).json({ error: 'Billing inválido' });

    // Rate limit checkout attempts: 3 per minute per email
    if (!rateLimit(`checkout:${email}`, 3, 60000)) {
        return res.status(429).json({ error: 'Muchos intentos. Esperá un minuto.' });
    }

    if (MP_ACCESS_TOKEN && planData.id) {
        try {
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    reason: `LeadHunter ${plan.charAt(0).toUpperCase() + plan.slice(1)} (${billing})`,
                    auto_recurring: {
                        frequency: billing === 'anual' ? 12 : 1,
                        frequency_type: 'months',
                        transaction_amount: planData.price,
                        currency_id: 'ARS'
                    },
                    payer_email: email,
                    back_url: `${baseUrl}/exito?plan=${plan}&email=${encodeURIComponent(email)}`,
                    notification_url: `${baseUrl}/api/webhook`,
                    external_reference: email
                })
            });

            const data = await mpRes.json();
            if (data.init_point) {
                // Save pending subscription
                const subs = readJSON(SUBSCRIPTIONS, '[]');
                subs.push({
                    email: email,
                    plan: `LeadHunter ${plan.charAt(0).toUpperCase() + plan.slice(1)} (${billing})`,
                    preapprovalId: data.id,
                    status: 'pending',
                    amount: planData.price,
                    createdAt: new Date().toISOString()
                });
                writeJSON(SUBSCRIPTIONS, subs);
                logEvent('created', email, plan, planData.price);

                res.json({ init_point: data.init_point });
            } else {
                console.error('MP preapproval error:', data);
                res.json({ error: data.message || 'Error al crear suscripción' });
            }
        } catch (err) {
            res.json({ error: err.message });
        }
    } else {
        // Demo mode
        res.json({
            init_point: `${req.protocol}://${req.get('host')}/exito?plan=${plan}&billing=${billing}&email=${encodeURIComponent(email)}`
        });
    }
});

// =================== WEBHOOK (MercadoPago) ===================
app.post('/api/webhook', async (req, res) => {
    const { type, data } = req.body;
    console.log('📩 Webhook received:', type, data?.id);

    // Handle subscription payments
    if (type === 'payment' && data?.id) {
        try {
            const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
                headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
            });
            const payment = await mpRes.json();

            if (payment.status === 'approved') {
                const subs = readJSON(SUBSCRIPTIONS, '[]');
                const existing = subs.find(s => s.preapprovalId === payment.preapproval_id);
                if (existing) {
                    existing.status = 'active';
                    existing.lastPayment = new Date().toISOString();
                    existing.paymentCount = (existing.paymentCount || 0) + 1;
                } else {
                    subs.push({
                        email: payment.payer?.email || '',
                        plan: payment.description || 'unknown',
                        preapprovalId: payment.preapproval_id || '',
                        status: 'active',
                        paymentId: payment.id,
                        amount: payment.transaction_amount,
                        createdAt: new Date().toISOString(),
                        lastPayment: new Date().toISOString(),
                        paymentCount: 1
                    });
                }
                writeJSON(SUBSCRIPTIONS, subs);
                logEvent('approved', payment.payer?.email, payment.description, payment.transaction_amount);

                // Email to user
                if (payment.payer?.email) {
                    sendEmail(payment.payer.email, '🎉 ¡Tu suscripción LeadHunter está activa!',
                        `<h2>¡Bienvenido a LeadHunter!</h2>
                         <p>Tu suscripción está activa y lista para usar.</p>
                         <p><b>Plan:</b> ${payment.description}</p>
                         <p><b>Monto:</b> $${payment.transaction_amount}</p>
                         <p><a href="https://${req.get('host')}/dashboard" style="display:inline-block;padding:12px 32px;background:#6C5CE7;color:white;text-decoration:none;border-radius:8px;">Ir al Dashboard →</a></p>`);
                }
                // Email to admin
                if (ADMIN_EMAIL) {
                    sendEmail(ADMIN_EMAIL, '💰 Nuevo pago LeadHunter',
                        `<h2>Nuevo pago aprobado</h2><p><b>Email:</b> ${payment.payer?.email}</p><p><b>Monto:</b> $${payment.transaction_amount}</p><p><b>Plan:</b> ${payment.description}</p>`);
                }
            } else if (payment.status === 'rejected') {
                logEvent('rejected', payment.payer?.email, payment.description, payment.transaction_amount);
                if (ADMIN_EMAIL) {
                    sendEmail(ADMIN_EMAIL, '❌ Pago rechazado LeadHunter',
                        `<h2>Pago rechazado</h2><p><b>Email:</b> ${payment.payer?.email}</p><p><b>Monto:</b> $${payment.transaction_amount}</p>`);
                }
            }
        } catch (err) {
            console.error('Webhook payment error:', err.message);
        }
    }

    // Handle subscription status changes
    if (type === 'subscription_preapproval' && data?.id) {
        try {
            const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${data.id}`, {
                headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
            });
            const preapproval = await mpRes.json();
            console.log('📋 Preapproval status:', preapproval.status, preapproval.payer_email);

            const subs = readJSON(SUBSCRIPTIONS, '[]');
            const existing = subs.find(s => s.preapprovalId === data.id);

            if (preapproval.status === 'authorized' || preapproval.status === 'active') {
                if (existing) {
                    existing.status = 'active';
                } else {
                    subs.push({
                        email: preapproval.payer_email || '',
                        plan: preapproval.reason || 'unknown',
                        preapprovalId: data.id,
                        status: 'active',
                        amount: preapproval.auto_recurring?.transaction_amount,
                        createdAt: new Date().toISOString()
                    });
                }
                logEvent('approved', preapproval.payer_email, preapproval.reason, preapproval.auto_recurring?.transaction_amount);

                // Email to user
                if (preapproval.payer_email) {
                    sendEmail(preapproval.payer_email, '🎉 ¡Tu suscripción LeadHunter está activa!',
                        `<h2>¡Bienvenido a LeadHunter!</h2><p>Tu suscripción está activa.</p><p><b>Plan:</b> ${preapproval.reason}</p>`);
                }
            } else if (preapproval.status === 'cancelled' || preapproval.status === 'ended') {
                if (existing) {
                    existing.status = 'cancelled';
                    existing.cancelledAt = new Date().toISOString();
                }
                logEvent('cancelled', preapproval.payer_email, preapproval.reason, preapproval.auto_recurring?.transaction_amount);
                console.log('❌ Subscription cancelled:', preapproval.payer_email);

                // Email to admin
                if (ADMIN_EMAIL) {
                    sendEmail(ADMIN_EMAIL, '🔴 Baja de suscripción LeadHunter',
                        `<h2>Suscripción cancelada</h2><p><b>Email:</b> ${preapproval.payer_email}</p><p><b>Plan:</b> ${preapproval.reason}</p>`);
                }
                // Email to user
                if (preapproval.payer_email) {
                    sendEmail(preapproval.payer_email, 'Tu suscripción LeadHunter fue cancelada',
                        `<h2>Suscripción cancelada</h2><p>Tu acceso ha sido desactivado.</p><p>Si creés que es un error, contactanos a hola@leadhunter.com.ar</p>`);
                }
            } else if (preapproval.status === 'paused') {
                if (existing) existing.status = 'paused';
                logEvent('paused', preapproval.payer_email, preapproval.reason, preapproval.auto_recurring?.transaction_amount);
            }

            writeJSON(SUBSCRIPTIONS, subs);
        } catch (err) {
            console.error('Webhook preapproval error:', err.message);
        }
    }

    res.sendStatus(200);
});

// =================== SEARCH ENDPOINT ===================
app.post('/api/search', async (req, res) => {
    const { query, city, max = 20 } = req.body;
    if (!query) return res.status(400).json({ error: 'Query requerido' });

    // Rate limit: 3 requests per minute per IP
    const ip = getClientIP(req);
    if (!rateLimit(`search:${ip}`, 3, 60000)) {
        return res.status(429).json({ error: 'Muchas solicitudes. Esperá un minuto.' });
    }

    const used = getUsageCount(ip);
    if (used >= FREE_SEARCH_LIMIT) {
        return res.status(403).json({
            error: 'limit_reached',
            message: `Alcanzaste las ${FREE_SEARCH_LIMIT} búsquedas gratis del día. Upgrade a un plan para continuar.`,
            used,
            limit: FREE_SEARCH_LIMIT
        });
    }

    if (!getApiKey()) {
        return res.status(400).json({
            error: 'API key de Google no configurada.',
            setupRequired: true
        });
    }
    process.env.GOOGLE_MAPS_API_KEY = getApiKey();

    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Búsqueda tardó demasiado')), 25000));

    try {
        const searchPromise = scrapers.searchAll(query, city || '', max);
        const allLeads = await Promise.race([searchPromise, timeout]);
        incrementUsage(ip);

        let existingLeads = readJSON(ALL_LEADS, '[]');
        const existingNames = new Set(existingLeads.map(l => l.name));
        const newLeads = allLeads.filter(l => !existingNames.has(l.name) && l.name);
        existingLeads.push(...newLeads);
        writeJSON(ALL_LEADS, existingLeads);

        res.json({ leads: allLeads, newCount: newLeads.length, total: existingLeads.length, usage: { used: used + 1, limit: FREE_SEARCH_LIMIT, remaining: Math.max(0, FREE_SEARCH_LIMIT - used - 1) } });
    } catch (err) {
        console.error('Search error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// =================== LEADS ENDPOINTS ===================
app.get('/api/leads', (req, res) => {
    const leads = readJSON(ALL_LEADS, '[]');
    res.json({ leads, total: leads.length });
});

app.get('/api/leads/export/csv', (req, res) => {
    const leads = readJSON(ALL_LEADS, '[]');
    const headers = 'name;email;phone;website;rating;reviews;address;instagram;facebook;tiktok;source\n';
    const rows = leads.map(l =>
        [l.name, l.email, l.phone, l.website, l.rating, l.reviews, l.address, l.instagram, l.facebook, l.tiktok, l.source].join(';')
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=leads.csv');
    res.send(headers + rows);
});

app.get('/api/leads/export/json', (req, res) => {
    const leads = readJSON(ALL_LEADS, '[]');
    res.setHeader('Content-Disposition', 'attachment; filename=leads.json');
    res.json(leads);
});

// =================== DASHBOARD ===================
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/stats', (req, res) => {
    const leads = readJSON(ALL_LEADS, '[]');
    const subs = readJSON(SUBSCRIPTIONS, '[]');
    res.json({
        totalLeads: leads.length,
        leadsWithEmail: leads.filter(l => l.email).length,
        leadsWithPhone: leads.filter(l => l.phone).length,
        leadsWithInstagram: leads.filter(l => l.instagram).length,
        leadsWithFacebook: leads.filter(l => l.facebook).length,
        leadsWithTikTok: leads.filter(l => l.tiktok).length,
        bySource: leads.reduce((acc, l) => { acc[l.source] = (acc[l.source] || 0) + 1; return acc; }, {}),
        byCity: leads.reduce((acc, l) => { const c = l.address?.split(',').pop()?.trim() || 'Otro'; acc[c] = (acc[c] || 0) + 1; return acc; }, {}),
        subscriptions: subs.length,
        activeSubscriptions: subs.filter(s => s.status === 'active').length
    });
});

// =================== PRO FEATURES ===================
const dailyAuto = new proFeatures.DailyAutomation();
const leadAlerts = new proFeatures.LeadAlerts();

app.get('/api/scheduled', (req, res) => { res.json({ jobs: dailyAuto.listJobs(req.query.userId || 'default') }); });
app.post('/api/scheduled', (req, res) => { res.json({ job: dailyAuto.scheduleDaily(req.body.userId || 'default', req.body.query, req.body.city, req.body.maxLeads || 100, req.body.time || '09:00') }); });
app.put('/api/scheduled/:id', (req, res) => { res.json({ job: dailyAuto.toggleJob(req.params.id, req.body.enabled) }); });
app.delete('/api/scheduled/:id', (req, res) => { dailyAuto.deleteJob(req.params.id); res.json({ success: true }); });

app.get('/api/alerts', (req, res) => { res.json({ alerts: leadAlerts.listAlerts(req.query.userId || 'default') }); });
app.post('/api/alerts', (req, res) => { res.json({ alert: leadAlerts.createAlert(req.body.userId || 'default', req.body.query, req.body.city, req.body.email) }); });
app.put('/api/alerts/:id', (req, res) => { res.json({ alert: leadAlerts.toggleAlert(req.params.id, req.body.enabled) }); });
app.delete('/api/alerts/:id', (req, res) => { leadAlerts.deleteAlert(req.params.id); res.json({ success: true }); });

app.get('/api/leads/export/excel', (req, res) => {
    const leads = readJSON(ALL_LEADS, '[]');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=leads-leadhunter.csv');
    res.send(proFeatures.exportToExcel(leads));
});
app.get('/api/leads/export/hubspot', (req, res) => { res.json(proFeatures.exportToHubspot(readJSON(ALL_LEADS, '[]'))); });
app.get('/api/leads/export/pipedrive', (req, res) => { res.json(proFeatures.exportToPipedrive(readJSON(ALL_LEADS, '[]'))); });
app.get('/api/stats/advanced', (req, res) => { res.json(proFeatures.getAdvancedStats()); });

// =================== PAGES ===================
app.get('/setup', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'setup.html')); });

app.get('/exito', (req, res) => {
    const plan = req.query.plan || '';
    const email = req.query.email || '';
    res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:100px;background:#0F0F23;color:white;">
            <h1>🎉 ¡Pago aprobado!</h1>
            <p>Tu suscripción a LeadHunter está activa.</p>
            <p style="color:#B2B2D0;">Plan: <strong>${plan}</strong></p>
            <p style="color:#B2B2D0;">Email: <strong>${email}</strong></p>
            <p style="color:#B2B2D0;">En breve recibirás un email con tu acceso.</p>
            <a href="/dashboard" style="display:inline-block;margin-top:16px;padding:12px 32px;background:#6C5CE7;color:white;text-decoration:none;border-radius:8px;font-weight:600;">Ir al Dashboard →</a>
            <br><br><a href="/" style="color:#6C5CE7;">Volver al inicio</a>
        </body></html>
    `);
});

app.get('/error', (req, res) => {
    res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:100px;background:#0F0F23;color:white;">
            <h1>❌ Pago no completado</h1>
            <p>Podés intentar de nuevo cuando quieras.</p>
            <a href="/#pricing" style="color:#6C5CE7;">Volver a elegir un plan</a>
        </body></html>
    `);
});

// =================== HEALTH CHECK ===================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// =================== START ===================
app.listen(PORT, () => {
    console.log(`🎯 LeadHunter server running on http://localhost:${PORT}`);
    console.log(`   MercadoPago: ${MP_ACCESS_TOKEN ? '✅ Configurado' : '⚠️ Demo mode'}`);
    console.log(`   Admin token: ${ADMIN_TOKEN.substring(0, 8)}...`);
    console.log(`   Data dir: ${DATA_DIR} (${DISK_PATH ? 'persistent disk' : 'local (will wipe on redeploy!)'})`);
    console.log(`   SMTP: ${SMTP_HOST ? '✅ Configurado' : '⚠️ Sin email (solo logs)'}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});
