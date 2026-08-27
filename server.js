// LeadHunter — Server con scraping + MercadoPago + Dashboard + Pro
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const scrapers = require('./scrapers');
let proFeatures;
try {
    proFeatures = require('./pro-features');
} catch (e) {
    // pro-features is optional
    proFeatures = { DailyAutomation: class { listJobs(){return []} scheduleDaily(){return{}} toggleJob(){return{}} deleteJob(){} }, LeadAlerts: class { listAlerts(){return []} createAlert(){return{}} toggleAlert(){return{}} deleteAlert(){} }, exportToExcel: ()=>'', exportToHubspot: ()=>[], exportToPipedrive: ()=>[], getAdvancedStats: ()=>({}) };
}

const app = express();
const PORT = process.env.PORT || 3003;

// Email config (optional)
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

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
        await transporter.sendMail({ from: SMTP_USER, to, subject, html });
        console.log(`📧 Email sent to ${to}: ${subject}`);
        return true;
    } catch (err) {
        console.error('📧 Email error:', err.message);
        return false;
    }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =================== FREE TIER RATE LIMITING ===================
const FREE_SEARCH_LIMIT = 3; // 3 búsquedas gratis por día
const SEARCH_USAGE_FILE = path.join(__dirname, 'data', 'search-usage.json');

// In-memory usage tracker (resets on server restart — fine for demo)
const searchUsage = {};

// Load usage from file on startup
try {
    const data = JSON.parse(fs.readFileSync(SEARCH_USAGE_FILE, 'utf8'));
    Object.assign(searchUsage, data);
} catch (e) {}

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
    // Persist to file
    try { fs.writeFileSync(SEARCH_USAGE_FILE, JSON.stringify(searchUsage, null, 2)); } catch (e) {}
    return searchUsage[ip].count;
}

// Cleanup old entries daily
setInterval(() => {
    const today = getTodayKey();
    for (const ip in searchUsage) {
        if (searchUsage[ip].date !== today) delete searchUsage[ip];
    }
}, 60 * 60 * 1000);

// MercadoPago (configurar con tu access token)
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';

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

// =================== LEADS DB ===================
const DB_DIR = path.join(__dirname, 'data');
const ALL_LEADS = path.join(DB_DIR, 'all-leads.json');
const SUBSCRIPTIONS = path.join(DB_DIR, 'subscriptions.json');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(ALL_LEADS)) fs.writeFileSync(ALL_LEADS, '[]');
if (!fs.existsSync(SUBSCRIPTIONS)) fs.writeFileSync(SUBSCRIPTIONS, '[]');

// =================== ADMIN: API KEY CONFIG ===================
const EVENTS_FILE = path.join(DB_DIR, 'events.json');
if (!fs.existsSync(EVENTS_FILE)) fs.writeFileSync(EVENTS_FILE, '[]');

function logEvent(type, email, plan, amount) {
    try {
        const events = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
        events.push({ type, email, plan, amount, timestamp: new Date().toISOString() });
        fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
    } catch (e) {}
}

const API_KEY_FILE = path.join(DB_DIR, 'api-key.json');

// Helper: get API key from env or file
function getApiKey() {
    const envKey = process.env.GOOGLE_MAPS_API_KEY || '';
    let fileKey = '';
    try { fileKey = JSON.parse(fs.readFileSync(API_KEY_FILE, 'utf8')).key || ''; } catch (e) {}
    return envKey || fileKey;
}

app.get('/api/admin/key', (req, res) => {
    const key = getApiKey();
    res.json({ configured: !!key, key: key ? key.substring(0, 8) + '...' : '' });
});

app.post('/api/admin/key', (req, res) => {
    const { key } = req.body;
    if (!key || typeof key !== 'string' || key.length < 10) {
        return res.status(400).json({ error: 'API key inválida' });
    }
    try {
        fs.writeFileSync(API_KEY_FILE, JSON.stringify({ key, updatedAt: new Date().toISOString() }, null, 2));
        // Also set in process.env so scrapers pick it up immediately
        process.env.GOOGLE_MAPS_API_KEY = key;
        res.json({ success: true, message: 'API key guardada. El scraper la usará inmediatamente.' });
    } catch (err) {
        res.status(500).json({ error: 'Error al guardar: ' + err.message });
    }
});

app.get('/api/admin/status', (req, res) => {
    const key = getApiKey();
    res.json({
        apiKey: !!key,
        mercadopago: !!MP_ACCESS_TOKEN,
        nodeEnv: process.env.NODE_ENV || 'development',
        uptime: process.uptime()
    });
});

// =================== ADMIN: SUBSCRIBERS ===================
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/subscribers', (req, res) => {
    try {
        const subs = JSON.parse(fs.readFileSync(SUBSCRIPTIONS, 'utf8'));
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
    } catch (e) {
        res.json({ subscribers: [], total: 0, active: 0, cancelled: 0, totalRevenue: 0, mrr: 0 });
    }
});

app.get('/api/admin/events', (req, res) => {
    try {
        const events = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
        res.json({ events });
    } catch (e) {
        res.json({ events: [] });
    }
});

// =================== SUBSCRIPTION CHECK ===================
function hasActiveSubscription(email) {
    if (!email) return false;
    try {
        const subs = JSON.parse(fs.readFileSync(SUBSCRIPTIONS, 'utf8'));
        return subs.some(s => s.email === email && s.status === 'active');
    } catch (e) {
        return false;
    }
}

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

    // Rate limit check
    const ip = getClientIP(req);
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
            error: 'API key de Google no configurada. Andá a /setup para configurarla.',
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
app.post('/api/checkout', async (req, res) => {
    const { plan, billing } = req.body;

    if (!PRICING[plan]) return res.status(400).json({ error: 'Plan inválido' });

    const planData = PRICING[plan][billing];
    if (!planData) return res.status(400).json({ error: 'Billing inválido' });

    // If MercadoPago is configured
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
                    payer_email: '',
                    back_url: `${baseUrl}/exito?plan=${plan}`,
                    notification_url: `${baseUrl}/api/webhook`
                })
            });

            const data = await mpRes.json();
            if (data.init_point) {
                res.json({ init_point: data.init_point });
            } else {
                console.error('MP preapproval error:', data);
                res.json({ error: data.message || 'Error al crear suscripción' });
            }
        } catch (err) {
            res.json({ error: err.message });
        }
    } else {
        // Demo mode — redirect to success
        res.json({
            init_point: `${req.protocol}://${req.get('host')}/exito?plan=${plan}&billing=${billing}`
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
                const subs = JSON.parse(fs.readFileSync(SUBSCRIPTIONS, 'utf8'));
                const existing = subs.find(s => s.preapprovalId === payment.preapproval_id);
                if (existing) {
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
                fs.writeFileSync(SUBSCRIPTIONS, JSON.stringify(subs, null, 2));
                logEvent('approved', payment.payer?.email, payment.description, payment.transaction_amount);
                console.log('✅ Payment approved:', payment.payer?.email);

                // Email notification to admin
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

            const subs = JSON.parse(fs.readFileSync(SUBSCRIPTIONS, 'utf8'));
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
            } else if (preapproval.status === 'cancelled' || preapproval.status === 'ended') {
                if (existing) {
                    existing.status = 'cancelled';
                    existing.cancelledAt = new Date().toISOString();
                }
                logEvent('cancelled', preapproval.payer_email, preapproval.reason, preapproval.auto_recurring?.transaction_amount);
                console.log('❌ Subscription cancelled:', preapproval.payer_email);

                // Email notification to admin
                if (ADMIN_EMAIL) {
                    sendEmail(ADMIN_EMAIL, '🔴 Baja de suscripción LeadHunter',
                        `<h2>Suscripción cancelada</h2><p><b>Email:</b> ${preapproval.payer_email}</p><p><b>Plan:</b> ${preapproval.reason}</p><p><b>Motivo:</b> ${preapproval.status}</p>`);
                }
                // Email to user
                if (preapproval.payer_email) {
                    sendEmail(preapproval.payer_email, 'Tu suscripción LeadHunter fue cancelada',
                        `<h2>Tu suscripción fue cancelada</h2><p>Tu acceso a LeadHunter ha sido desactivado.</p><p>Si creés que esto es un error, contactanos a hola@leadhunter.com.ar</p>`);
                }
            } else if (preapproval.status === 'paused') {
                if (existing) {
                    existing.status = 'paused';
                }
                logEvent('paused', preapproval.payer_email, preapproval.reason, preapproval.auto_recurring?.transaction_amount);
            }

            fs.writeFileSync(SUBSCRIPTIONS, JSON.stringify(subs, null, 2));
        } catch (err) {
            console.error('Webhook preapproval error:', err.message);
        }
    }

    res.sendStatus(200);
});

// =================== USER SUBSCRIPTION CHECK ===================
app.get('/api/subscription/check', (req, res) => {
    const email = req.query.email;
    if (!email) return res.json({ active: false, error: 'Email requerido' });
    const active = hasActiveSubscription(email);
    res.json({ active, email });
});

// =================== SEARCH ENDPOINT ===================
app.post('/api/search', async (req, res) => {
    const { query, city, max = 20 } = req.body;
    if (!query) return res.status(400).json({ error: 'Query requerido' });

    // Rate limit check
    const ip = getClientIP(req);
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
            error: 'API key de Google no configurada. Andá a /setup para configurarla.',
            setupRequired: true
        });
    }
    process.env.GOOGLE_MAPS_API_KEY = getApiKey();

    // Timeout: max 25 seconds for the whole search
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Búsqueda tardó demasiado')), 25000));

    try {
        const searchPromise = scrapers.searchAll(query, city || '', max);
        const allLeads = await Promise.race([searchPromise, timeout]);
        incrementUsage(ip);

        // Save to all-leads
        let existingLeads = [];
        try { existingLeads = JSON.parse(fs.readFileSync(ALL_LEADS, 'utf8')); } catch(e) { existingLeads = []; }
        const existingNames = new Set(existingLeads.map(l => l.name));
        const newLeads = allLeads.filter(l => !existingNames.has(l.name) && l.name);
        existingLeads.push(...newLeads);
        try { fs.writeFileSync(ALL_LEADS, JSON.stringify(existingLeads, null, 2)); } catch(e) {}

        res.json({ leads: allLeads, newCount: newLeads.length, total: existingLeads.length, usage: { used: used + 1, limit: FREE_SEARCH_LIMIT, remaining: Math.max(0, FREE_SEARCH_LIMIT - used - 1) } });
    } catch (err) {
        console.error('Search error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// =================== LEADS ENDPOINTS ===================
app.get('/api/leads', (req, res) => {
    const leads = JSON.parse(fs.readFileSync(ALL_LEADS, 'utf8'));
    res.json({ leads, total: leads.length });
});

app.get('/api/leads/export/csv', (req, res) => {
    const leads = JSON.parse(fs.readFileSync(ALL_LEADS, 'utf8'));
    const headers = 'name;email;phone;website;rating;reviews;address;instagram;facebook;tiktok;source\n';
    const rows = leads.map(l =>
        [l.name, l.email, l.phone, l.website, l.rating, l.reviews, l.address, l.instagram, l.facebook, l.tiktok, l.source].join(';')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=leads.csv');
    res.send(headers + rows);
});

app.get('/api/leads/export/json', (req, res) => {
    const leads = JSON.parse(fs.readFileSync(ALL_LEADS, 'utf8'));
    res.setHeader('Content-Disposition', 'attachment; filename=leads.json');
    res.json(leads);
});

// =================== DASHBOARD ===================
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/stats', (req, res) => {
    const leads = JSON.parse(fs.readFileSync(ALL_LEADS, 'utf8'));
    const subs = JSON.parse(fs.readFileSync(SUBSCRIPTIONS, 'utf8'));

    // Stats
    const totalLeads = leads.length;
    const leadsWithEmail = leads.filter(l => l.email).length;
    const leadsWithPhone = leads.filter(l => l.phone).length;
    const leadsWithInstagram = leads.filter(l => l.instagram).length;
    const leadsWithFacebook = leads.filter(l => l.facebook).length;
    const leadsWithTikTok = leads.filter(l => l.tiktok).length;

    // By source
    const bySource = {};
    leads.forEach(l => { bySource[l.source] = (bySource[l.source] || 0) + 1; });

    // By city (from address)
    const byCity = {};
    leads.forEach(l => {
        const city = l.address?.split(',').pop()?.trim() || 'Desconocido';
        byCity[city] = (byCity[city] || 0) + 1;
    });

    res.json({
        totalLeads,
        leadsWithEmail,
        leadsWithPhone,
        leadsWithInstagram,
        leadsWithFacebook,
        leadsWithTikTok,
        bySource,
        byCity,
        subscriptions: subs.length,
        activeSubscriptions: subs.filter(s => s.status === 'active').length
    });
});

// =================== PRO FEATURES ===================
const dailyAuto = new proFeatures.DailyAutomation();
const leadAlerts = new proFeatures.LeadAlerts();

// Scheduled scrapes
app.get('/api/scheduled', (req, res) => {
    const jobs = dailyAuto.listJobs(req.query.userId || 'default');
    res.json({ jobs });
});

app.post('/api/scheduled', (req, res) => {
    const { query, city, maxLeads = 100, time = '09:00' } = req.body;
    const job = dailyAuto.scheduleDaily(req.body.userId || 'default', query, city, maxLeads, time);
    res.json({ job });
});

app.put('/api/scheduled/:id', (req, res) => {
    const job = dailyAuto.toggleJob(req.params.id, req.body.enabled);
    res.json({ job });
});

app.delete('/api/scheduled/:id', (req, res) => {
    dailyAuto.deleteJob(req.params.id);
    res.json({ success: true });
});

// Alerts
app.get('/api/alerts', (req, res) => {
    const alerts = leadAlerts.listAlerts(req.query.userId || 'default');
    res.json({ alerts });
});

app.post('/api/alerts', (req, res) => {
    const { query, city, email } = req.body;
    const alert = leadAlerts.createAlert(req.body.userId || 'default', query, city, email);
    res.json({ alert });
});

app.put('/api/alerts/:id', (req, res) => {
    const alert = leadAlerts.toggleAlert(req.params.id, req.body.enabled);
    res.json({ alert });
});

app.delete('/api/alerts/:id', (req, res) => {
    leadAlerts.deleteAlert(req.params.id);
    res.json({ success: true });
});

// Advanced export
app.get('/api/leads/export/excel', (req, res) => {
    const leads = JSON.parse(fs.readFileSync(ALL_LEADS, 'utf8'));
    const csv = proFeatures.exportToExcel(leads);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=leads-leadhunter.csv');
    res.send(csv);
});

app.get('/api/leads/export/hubspot', (req, res) => {
    const leads = JSON.parse(fs.readFileSync(ALL_LEADS, 'utf8'));
    res.json(proFeatures.exportToHubspot(leads));
});

app.get('/api/leads/export/pipedrive', (req, res) => {
    const leads = JSON.parse(fs.readFileSync(ALL_LEADS, 'utf8'));
    res.json(proFeatures.exportToPipedrive(leads));
});

// Advanced stats
app.get('/api/stats/advanced', (req, res) => {
    res.json(proFeatures.getAdvancedStats());
});

// =================== PAGES ===================
app.get('/setup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});
app.get('/exito', (req, res) => {
    const plan = req.query.plan || '';
    res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:100px;background:#0F0F23;color:white;">
            <h1>🎉 ¡Pago aprobado!</h1>
            <p>Tu suscripción a LeadHunter está activa.</p>
            <p style="color:#B2B2D0;">Plan: <strong>${plan}</strong></p>
            <p style="color:#B2B2D0;">En breve recibirás un email con tu acceso.</p>
            <p style="color:#B2B2D0;margin-top:24px;">Podés empezar a usar LeadHunter ahora mismo:</p>
            <a href="/dashboard" style="display:inline-block;margin-top:16px;padding:12px 32px;background:#6C5CE7;color:white;text-decoration:none;border-radius:8px;font-weight:600;">Ir al Dashboard →</a>
            <br><br>
            <a href="/" style="color:#6C5CE7;">Volver al inicio</a>
        </body></html>
    `);
});

app.get('/error', (req, res) => {
    res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:100px;background:#0F0F23;color:white;">
            <h1>❌ Pago no completado</h1>
            <p>Podés intentar de nuevo cuando quieras.</p>
            <a href="/" style="color:#6C5CE7;">Volver al inicio</a>
        </body></html>
    `);
});

// =================== HEALTH CHECK ===================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// =================== START ===================
app.listen(PORT, () => {
    console.log(`🎯 LeadHunter server running on http://localhost:${PORT}`);
    console.log(`   MercadoPago: ${MP_ACCESS_TOKEN ? '✅ Configurado' : '⚠️ Demo mode (sin MP_ACCESS_TOKEN)'}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});
