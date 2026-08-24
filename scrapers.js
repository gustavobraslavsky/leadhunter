// LeadHunter — Scrapers HTTP puro (sin Puppeteer)
// Usa __NEXT_DATA__ de Páginas Amarillas (JSON estructurado, rápido)
// + scraping de websites para enriquecer leads

const https = require('https');
const http = require('http');

// =================== UTILIDADES ===================
function fetchUrl(url, timeout = 8000) {
    return new Promise((resolve, reject) => {
        try {
            const protocol = url.startsWith('https') ? https : http;
            const req = protocol.get(url, {
                timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'es-AR,es;q=0.9,en;q=0.5'
                }
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    fetchUrl(res.headers.location, timeout).then(resolve).catch(reject);
                    return;
                }
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        } catch (e) {
            reject(e);
        }
    });
}

function extractEmails(text) {
    if (!text) return [];
    const regex = /[a-zA-Z0-9._%+\-!#$&'*/=?^`{|}~]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const found = text.match(regex) || [];
    const blocked = /^(example|test|email|demo|prueba|sample|noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|webmaster|abuse|sentry|wixpress|sentry-next|ejemplo|sentry\.io|nuvempago)/i;
    const extBlocked = /\.(png|jpg|jpeg|gif|svg|webp|css|js|ico|woff|ttf|mp3|mp4)$/i;
    return [...new Set(found)].filter(e => !blocked.test(e) && !extBlocked.test(e) && e.length < 80);
}

function extractPhones(text) {
    if (!text) return [];
    const regex = /(?:\+54|0054)?[\s\-]?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{4}/g;
    const found = text.match(regex) || [];
    return [...new Set(found.map(p => p.replace(/\s/g, '').trim()).filter(p => p.length >= 8 && p.length <= 15))];
}

function extractInstagram(text) {
    if (!text) return [];
    const regex = /(?:instagram\.com\/|@)([a-zA-Z0-9._]+)/g;
    const found = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        const username = match[1].replace(/\/$/, '');
        if (username && !username.includes('.') && username.length > 2 && username.length < 30) {
            found.push(username);
        }
    }
    return [...new Set(found)];
}

function extractFacebook(text) {
    if (!text) return [];
    const regex = /(?:facebook\.com\/|fb\.com\/)([a-zA-Z0-9._]+)/g;
    const found = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        const page = match[1].replace(/\/.*$/, '');
        if (page && !['sharer', 'share', 'login', 'groups', 'pages', 'events'].includes(page)) {
            found.push(page);
        }
    }
    return [...new Set(found)];
}

function extractTikTok(text) {
    if (!text) return [];
    const regex = /(?:tiktok\.com\/@)([a-zA-Z0-9._]+)/g;
    const found = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        found.push(match[1]);
    }
    return [...new Set(found)];
}

// =================== PAGINAS AMARILLAS (JSON __NEXT_DATA__) ===================
async function scrapePaginasAmarillas(query, city = '', maxResults = 15) {
    const leads = [];
    try {
        const searchQuery = encodeURIComponent(query);
        const citySlug = city.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
        const url = `https://www.paginasamarillas.com.ar/buscar/${searchQuery}${citySlug ? '/' + citySlug : ''}`;

        const html = await fetchUrl(url, 10000);

        // Extract structured data from __NEXT_DATA__
        const ndMatch = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (!ndMatch) return leads;

        const nd = JSON.parse(ndMatch[1]);
        const results = nd.props?.pageProps?.results || [];

        for (const r of results.slice(0, maxResults)) {
            const email = (r.emails || [])[0] || '';
            const phone = r.mainPhone?.phoneToShow || r.mainPhone?.number || '';
            const website = (r.contactMap?.WEB || [])[0] || '';
            const whatsapp = (r.mainAddress?.contactMap?.WHATSAPP || r.contactMap?.WHATSAPP || [])[0] || '';

            let address = '';
            if (r.mainAddress) {
                const parts = [r.mainAddress.streetName, r.mainAddress.streetNumber].filter(Boolean);
                address = parts.join(' ') + (r.mainAddress.localityToShow ? ', ' + r.mainAddress.localityToShow : '');
            }

            leads.push({
                name: r.name || '',
                email,
                phone,
                whatsapp,
                website,
                rating: '',
                reviews: '',
                address,
                instagram: '',
                facebook: '',
                tiktok: '',
                source: 'paginas_amarillas'
            });
        }
    } catch (err) {
        console.error('Páginas Amarillas error:', err.message);
    }
    return leads;
}

// =================== WEBSITE SCRAPER (rápido, para enriquecer) ===================
async function scrapeWebsiteForContacts(websiteUrl) {
    if (!websiteUrl) return { email: '', phones: [], instagram: '', facebook: '' };

    try {
        const base = websiteUrl.replace(/\/$/, '');
        const pagesToCheck = ['', '/contacto', '/contact', '/nosotros', '/about', '/about-us', '/contactanos'];
        let allEmails = [];
        let allPhones = [];
        let instagram = '';
        let facebook = '';

        for (const page of pagesToCheck) {
            try {
                const url = base + page;
                const html = await fetchUrl(url, 5000);
                const emails = extractEmails(html);
                const phones = extractPhones(html);
                const ig = extractInstagram(html);
                const fb = extractFacebook(html);

                allEmails = [...allEmails, ...emails];
                allPhones = [...allPhones, ...phones];
                if (ig.length && !instagram) instagram = `instagram.com/${ig[0]}`;
                if (fb.length && !facebook) facebook = `facebook.com/${fb[0]}`;

                if (allEmails.length > 0) break;
            } catch (e) {
                continue;
            }
        }

        return {
            email: allEmails[0] || '',
            phones: [...new Set(allPhones)].slice(0, 3),
            instagram,
            facebook
        };
    } catch (err) {
        return { email: '', phones: [], instagram: '', facebook: '' };
    }
}

// =================== ENRICH LEAD ===================
async function enrichLead(lead) {
    if (lead.email && lead.instagram && lead.facebook) return lead;

    if (lead.website) {
        try {
            const websiteData = await scrapeWebsiteForContacts(lead.website);
            if (!lead.email && websiteData.email) lead.email = websiteData.email;
            if (!lead.instagram && websiteData.instagram) lead.instagram = websiteData.instagram;
            if (!lead.facebook && websiteData.facebook) lead.facebook = websiteData.facebook;
            if (!lead.phone && websiteData.phones?.[0]) lead.phone = websiteData.phones[0];
        } catch (e) { /* ignore */ }
    }
    return lead;
}

// =================== BÚSQUEDA RÁPIDA MULTI-FUENTE ===================
async function searchAll(query, city = '', maxResults = 15) {
    const allLeads = [];
    const startTime = Date.now();

    // 1. Páginas Amarillas (rápido, JSON directo)
    console.log(`📒 Scraping Páginas Amarillas: "${query} ${city}"...`);
    try {
        const paLeads = await scrapePaginasAmarillas(query, city, maxResults);
        allLeads.push(...paLeads);
        console.log(`   Páginas Amarillas: ${paLeads.length} leads`);
    } catch (err) {
        console.error('   PA error:', err.message);
    }

    // 2. Enriquecer leads con datos de websites (solo los que tienen website pero sin email)
    const leadsToEnrich = allLeads.filter(l => l.website && !l.email);
    if (leadsToEnrich.length > 0 && (Date.now() - startTime) < 12000) {
        console.log(`🔍 Enriching ${leadsToEnrich.length} leads from websites...`);
        for (const lead of leadsToEnrich.slice(0, 5)) {
            try {
                const enriched = await enrichLead(lead);
                Object.assign(lead, enriched);
            } catch (e) { /* ignore */ }
        }
    }

    // 3. Deduplicar por nombre
    const seen = new Set();
    const uniqueLeads = allLeads.filter(l => {
        const key = l.name.toLowerCase().trim();
        if (seen.has(key) || !key) return false;
        seen.add(key);
        return true;
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Found ${uniqueLeads.length} unique leads (${uniqueLeads.filter(l=>l.email).length} with email) in ${elapsed}s`);
    return uniqueLeads;
}

// =================== EXPORT ===================
module.exports = {
    scrapePaginasAmarillas,
    scrapeWebsiteForContacts,
    enrichLead,
    searchAll,
    extractEmails,
    extractPhones,
    extractInstagram,
    extractFacebook,
    extractTikTok
};
