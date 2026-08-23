// LeadHunter — Server con scraping + MercadoPago + Dashboard + Pro
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const scrapers = require('./scrapers');
const { DailyAutomation, LeadAlerts, exportToExcel, exportToHubspot, exportToPipedrive, getAdvancedStats } = require('./pro-features');

const app = express();
const PORT = process.env.PORT || 3003;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// =================== DEMO ENDPOINT ===================
app.post('/api/demo', async (req, res) => {
    const { rubro, ciudad, max = 5 } = req.body;
    if (!rubro || !ciudad) return res.json({ leads: [] });

    try {
        const leads = await scrapers.searchAll(rubro, ciudad, Math.max(max, 10));
        // Return ALL leads, even without email - user wants to see everything
        res.json({ leads: leads.slice(0, max) });
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
            const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    items: [{
                        id: plan,
                        title: `LeadHunter ${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
                        quantity: 1,
                        unit_price: planData.price,
                        currency_id: 'ARS'
                    }],
                    payer: { email: '' },
                    back_urls: {
                        success: `${req.protocol}://${req.get('host')}/exito`,
                        failure: `${req.protocol}://${req.get('host')}/error`,
                        pending: `${req.protocol}://${req.get('host')}/pendiente`
                    },
                    auto_return: 'approved',
                    notification_url: `${req.protocol}://${req.get('host')}/api/webhook`
                })
            });

            const data = await mpRes.json();
            res.json({ init_point: data.init_point || data.sandbox_init_point });
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

    if (type === 'payment' && data?.id) {
        try {
            const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
                headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
            });
            const payment = await mpRes.json();

            if (payment.status === 'approved') {
                const subs = JSON.parse(fs.readFileSync(SUBSCRIPTIONS, 'utf8'));
                subs.push({
                    email: payment.payer?.email || '',
                    plan: payment.metadata?.plan || 'unknown',
                    billing: payment.metadata?.billing || 'mensual',
                    status: 'active',
                    paymentId: payment.id,
                    createdAt: new Date().toISOString()
                });
                fs.writeFileSync(SUBSCRIPTIONS, JSON.stringify(subs, null, 2));
            }
        } catch (err) {
            console.error('Webhook error:', err.message);
        }
    }

    res.sendStatus(200);
});

// =================== SEARCH ENDPOINT ===================
app.post('/api/search', async (req, res) => {
    const { query, city, max = 20, sources = ['google_maps'] } = req.body;
    if (!query) return res.status(400).json({ error: 'Query requerido' });

    try {
        let allLeads = [];

        if (sources.includes('google_maps')) {
            const mapsLeads = await scrapers.scrapeGoogleMaps(`${query} ${city || ''}`, max);
            allLeads.push(...mapsLeads);
        }

        // Enrich with website data
        for (const lead of allLeads) {
            if (lead.website && (!lead.email || !lead.instagram)) {
                const enriched = await scrapers.enrichLead(lead);
                Object.assign(lead, enriched);
            }
        }

        // Save to all-leads
        const existingLeads = JSON.parse(fs.readFileSync(ALL_LEADS, 'utf8'));
        const existingNames = new Set(existingLeads.map(l => l.name));
        const newLeads = allLeads.filter(l => !existingNames.has(l.name));
        existingLeads.push(...newLeads);
        fs.writeFileSync(ALL_LEADS, JSON.stringify(existingLeads, null, 2));

        // Return ALL leads (with or without email)
        res.json({ leads: allLeads, newCount: newLeads.length, total: existingLeads.length });
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
const dailyAuto = new DailyAutomation();
const leadAlerts = new LeadAlerts();

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
    const csv = exportToExcel(leads);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=leads-leadhunter.csv');
    res.send(csv);
});

app.get('/api/leads/export/hubspot', (req, res) => {
    const leads = JSON.parse(fs.readFileSync(ALL_LEADS, 'utf8'));
    res.json(exportToHubspot(leads));
});

app.get('/api/leads/export/pipedrive', (req, res) => {
    const leads = JSON.parse(fs.readFileSync(ALL_LEADS, 'utf8'));
    res.json(exportToPipedrive(leads));
});

// Advanced stats
app.get('/api/stats/advanced', (req, res) => {
    res.json(getAdvancedStats());
});

// =================== PAGES ===================
app.get('/exito', (req, res) => {
    res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:100px;background:#0F0F23;color:white;">
            <h1>🎉 ¡Pago aprobado!</h1>
            <p>Tu suscripción a LeadHunter está activa.</p>
            <p style="color:#B2B2D0;">En breve recibirás un email con tu acceso.</p>
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
