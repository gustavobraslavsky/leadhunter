// LeadHunter — Funciones Pro
// Scraping ilimitado, automatización diaria, integración CRM, alertas

const fs = require('fs');
const path = require('path');
const scrapers = require('./scrapers');

const DB_DIR = path.join(__dirname, 'data');
const SCHEDULED = path.join(DB_DIR, 'scheduled-scrapes.json');
const ALERTS = path.join(DB_DIR, 'alerts.json');

if (!fs.existsSync(SCHEDULED)) fs.writeFileSync(SCHEDULED, '[]');
if (!fs.existsSync(ALERTS)) fs.writeFileSync(ALERTS, '[]');

// =================== AUTOMATIZACIÓN DIARIA ===================
class DailyAutomation {
    constructor() {
        this.jobs = this.loadJobs();
    }

    loadJobs() {
        try {
            return JSON.parse(fs.readFileSync(SCHEDULED, 'utf8'));
        } catch {
            return [];
        }
    }

    saveJobs() {
        fs.writeFileSync(SCHEDULED, JSON.stringify(this.jobs, null, 2));
    }

    // Programar scraping diario
    scheduleDaily(userId, query, city, maxLeads = 100, time = '09:00') {
        const job = {
            id: Date.now().toString(36),
            userId,
            query,
            city,
            maxLeads,
            time,
            enabled: true,
            lastRun: null,
            createdAt: new Date().toISOString()
        };

        this.jobs.push(job);
        this.saveJobs();
        return job;
    }

    // Ejecutar jobs pendientes
    async runPendingJobs() {
        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        for (const job of this.jobs) {
            if (!job.enabled) continue;

            const lastRunDate = job.lastRun ? new Date(job.lastRun).toDateString() : '';
            const today = now.toDateString();

            if (lastRunDate === today) continue; // Already ran today
            if (job.time !== currentTime) continue; // Not time yet

            console.log(`🤖 Running scheduled scrape: ${job.query} ${job.city}`);
            try {
                const leads = await scrapers.searchAll(job.query, job.city, job.maxLeads);
                job.lastRun = now.toISOString();
                job.lastCount = leads.length;
                this.saveJobs();

                // Save leads
                const allLeadsPath = path.join(DB_DIR, 'all-leads.json');
                const existing = JSON.parse(fs.readFileSync(allLeadsPath, 'utf8'));
                const existingNames = new Set(existing.map(l => l.name));
                const newLeads = leads.filter(l => !existingNames.has(l.name));
                existing.push(...newLeads);
                fs.writeFileSync(allLeadsPath, JSON.stringify(existing, null, 2));

                console.log(`✅ Scheduled scrape complete: ${newLeads.length} new leads`);
            } catch (err) {
                console.error(`❌ Scheduled scrape failed:`, err.message);
            }
        }
    }

    listJobs(userId) {
        return this.jobs.filter(j => j.userId === userId);
    }

    toggleJob(jobId, enabled) {
        const job = this.jobs.find(j => j.id === jobId);
        if (job) {
            job.enabled = enabled;
            this.saveJobs();
        }
        return job;
    }

    deleteJob(jobId) {
        this.jobs = this.jobs.filter(j => j.id !== jobId);
        this.saveJobs();
    }
}

// =================== ALERTAS DE NUEVOS LEADS ===================
class LeadAlerts {
    constructor() {
        this.alerts = this.loadAlerts();
    }

    loadAlerts() {
        try {
            return JSON.parse(fs.readFileSync(ALERTS, 'utf8'));
        } catch {
            return [];
        }
    }

    saveAlerts() {
        fs.writeFileSync(ALERTS, JSON.stringify(this.alerts, null, 2));
    }

    // Crear alerta por rubro/ciudad
    createAlert(userId, query, city, email) {
        const alert = {
            id: Date.now().toString(36),
            userId,
            query,
            city,
            email,
            enabled: true,
            lastCheck: null,
            leadsFound: 0,
            createdAt: new Date().toISOString()
        };

        this.alerts.push(alert);
        this.saveAlerts();
        return alert;
    }

    // Verificar nuevas alertas
    async checkAlerts() {
        for (const alert of this.alerts) {
            if (!alert.enabled) continue;

            console.log(`🔔 Checking alert: ${alert.query} ${alert.city}`);
            try {
                const leads = await scrapers.searchAll(alert.query, alert.city, 10);
                const newLeads = leads.filter(l => l.email); // Only leads with email

                if (newLeads.length > 0) {
                    alert.lastCheck = new Date().toISOString();
                    alert.leadsFound += newLeads.length;
                    this.saveAlerts();

                    console.log(`📬 Alert: ${newLeads.length} new leads with email for "${alert.query}"`);
                    // In production, send email notification here
                }
            } catch (err) {
                console.error(`Alert check failed:`, err.message);
            }
        }
    }

    listAlerts(userId) {
        return this.alerts.filter(a => a.userId === userId);
    }

    toggleAlert(alertId, enabled) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.enabled = enabled;
            this.saveAlerts();
        }
        return alert;
    }

    deleteAlert(alertId) {
        this.alerts = this.alerts.filter(a => a.id !== alertId);
        this.saveAlerts();
    }
}

// =================== EXPORTACIONES AVANZADAS ===================
function exportToExcel(leads) {
    // Simple CSV with Excel-compatible formatting
    const headers = [
        'Nombre', 'Email', 'Teléfono', 'WhatsApp', 'Website',
        'Instagram', 'Facebook', 'TikTok', 'LinkedIn',
        'Rating', 'Reseñas', 'Dirección', 'Fuente', 'Fecha'
    ];

    const rows = leads.map(l => [
        l.name || '',
        l.email || '',
        l.phone || '',
        l.whatsapp || '',
        l.website || '',
        l.instagram || '',
        l.facebook || '',
        l.tiktok || '',
        l.linkedin || '',
        l.rating || '',
        l.reviews || '',
        l.address || '',
        l.source || '',
        l.scrapedAt || new Date().toISOString()
    ]);

    const csv = [
        headers.join(';'),
        ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))
    ].join('\n');

    return csv;
}

// CRM Export formats
function exportToHubspot(leads) {
    return leads.map(l => ({
        email: l.email,
        phone: l.phone,
        company: l.name,
        website: l.website,
        address: l.address,
        industry: l.source
    }));
}

function exportToPipedrive(leads) {
    return leads.map(l => ({
        title: l.name,
        email: l.email,
        phone: l.phone,
        address: l.address,
        notes: `Fuente: ${l.source} | Rating: ${l.rating}`
    }));
}

// =================== ESTADÍSTICAS AVANZADAS ===================
function getAdvancedStats() {
    const allLeadsPath = path.join(DB_DIR, 'all-leads.json');
    const leads = JSON.parse(fs.readFileSync(allLeadsPath, 'utf8'));

    const stats = {
        total: leads.length,
        withEmail: leads.filter(l => l.email).length,
        withPhone: leads.filter(l => l.phone).length,
        withInstagram: leads.filter(l => l.instagram).length,
        withFacebook: leads.filter(l => l.facebook).length,
        withTikTok: leads.filter(l => l.tiktok).length,
        withLinkedIn: leads.filter(l => l.linkedin).length,

        // Contact coverage
        contactCoverage: {
            email: leads.length > 0 ? ((leads.filter(l => l.email).length / leads.length) * 100).toFixed(1) + '%' : '0%',
            phone: leads.length > 0 ? ((leads.filter(l => l.phone).length / leads.length) * 100).toFixed(1) + '%' : '0%',
            social: leads.length > 0 ? ((leads.filter(l => l.instagram || l.facebook || l.tiktok).length / leads.length) * 100).toFixed(1) + '%' : '0%'
        },

        // By source
        bySource: {},
        byCity: {},
        byDay: {}
    };

    leads.forEach(l => {
        stats.bySource[l.source] = (stats.bySource[l.source] || 0) + 1;
        const city = l.address?.split(',').pop()?.trim() || 'Desconocido';
        stats.byCity[city] = (stats.byCity[city] || 0) + 1;
    });

    return stats;
}

// =================== EXPORT ===================
module.exports = {
    DailyAutomation,
    LeadAlerts,
    exportToExcel,
    exportToHubspot,
    exportToPipedrive,
    getAdvancedStats
};
