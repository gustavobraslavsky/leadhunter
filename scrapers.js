// LeadHunter — Scrapers con Google Places API + Website Enrichment
// =================================================================
// Busca negocios por rubro y ciudad con datos precisos.
// Google Places API: nombre, dirección, teléfono, website, rating
// Website scraping: email, Instagram, Facebook, TikTok

const https = require('https');
const http = require('http');

// =================== CONFIG ===================
function getApiKey() {
    const envKey = process.env.GOOGLE_MAPS_API_KEY || '';
    let fileKey = '';
    try { 
        const fs = require('fs');
        const path = require('path');
        fileKey = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'api-key.json'), 'utf8')).key || ''; 
    } catch (e) {}
    return envKey || fileKey;
}
const API_TIMEOUT = 10000;

// =================== UTILIDADES HTTP ===================
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
                    let loc = res.headers.location;
                    if (loc.startsWith('/')) {
                        const u = new URL(url);
                        loc = u.origin + loc;
                    }
                    fetchUrl(loc, timeout).then(resolve).catch(reject);
                    return;
                }
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        } catch (e) { reject(e); }
    });
}

function httpPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        try {
            const u = new URL(url);
            const postData = typeof body === 'string' ? body : JSON.stringify(body);
            const opts = {
                hostname: u.hostname,
                port: u.port || (u.protocol === 'https:' ? 443 : 80),
                path: u.pathname + u.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    ...headers
                },
                timeout: API_TIMEOUT
            };
            const protocol = u.protocol === 'https:' ? https : http;
            const req = protocol.request(opts, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => resolve({ status: res.statusCode, data }));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            req.write(postData);
            req.end();
        } catch (e) { reject(e); }
    });
}

// =================== EXTRACT UTILITIES ===================
function extractEmails(text) {
    if (!text) return [];
    const regex = /[a-zA-Z0-9._%+\-!#$&'*/=?^`{|}~]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const found = text.match(regex) || [];
    const blocked = /^(example|test|email|demo|prueba|sample|noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|webmaster|abuse|sentry|wixpress|sentry-next|ejemplo|nuvempago|next\.js)/i;
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
    const regex = /instagram\.com\/([a-zA-Z0-9._]+)/g;
    const found = [];
    let match;
    const skip = ['media','p','reel','stories','explorer','accounts','direct','login','signup','about','press','blog','legal','privacy','terms'];
    while ((match = regex.exec(text)) !== null) {
        const username = match[1].replace(/\/$/, '');
        if (username && !username.includes('.') && username.length > 2 && username.length < 30 && !skip.includes(username.toLowerCase())) {
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

function extractWhatsApp(text) {
    if (!text) return [];
    const regex = /(?:wa\.me|api\.whatsapp\.com|whatsapp\.com\/send)[^"'\s]*/gi;
    const found = text.match(regex) || [];
    return [...new Set(found)];
}

// =================== GOOGLE PLACES API ===================
async function searchGooglePlaces(query, city, maxResults = 20) {
    const GOOGLE_API_KEY = getApiKey();
    if (!GOOGLE_API_KEY) {
        console.log('⚠️ No GOOGLE_MAPS_API_KEY configured — using fallback');
        return [];
    }

    const leads = [];
    const searchText = city ? `${query} en ${city}, Argentina` : `${query}, Argentina`;
    const url = `https://places.googleapis.com/v1/places:searchText`;

    try {
        const response = await httpPost(url, {
            textQuery: searchText,
            languageCode: 'es',
            regionCode: 'ar',
            maxResultCount: Math.min(maxResults, 20),
            locationBias: city ? undefined : undefined
        }, {
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.types,places.primaryType'
        });

        if (response.status !== 200) {
            console.error('Google Places API error:', response.status, response.data?.substring(0, 200));
            return [];
        }

        const data = JSON.parse(response.data);
        const places = data.places || [];

        for (const p of places) {
            leads.push({
                name: p.displayName?.text || '',
                email: '',
                phone: p.nationalPhoneNumber || '',
                website: p.websiteUri || '',
                address: p.formattedAddress || '',
                rating: p.rating || '',
                reviews: p.userRatingCount || '',
                category: (p.primaryType || '').replace(/_/g, ' '),
                instagram: '',
                facebook: '',
                tiktok: '',
                whatsapp: '',
                source: 'google_places',
                placeId: p.id || ''
            });
        }

        console.log(`📍 Google Places: ${leads.length} resultados para "${searchText}"`);
    } catch (err) {
        console.error('Google Places error:', err.message);
    }

    return leads;
}

// =================== WEBSITE SCRAPER (Email enrichment) ===================
async function scrapeWebsiteForContacts(websiteUrl) {
    if (!websiteUrl) return { email: '', phones: [], instagram: '', facebook: '', tiktok: '', whatsapp: '' };

    try {
        const base = websiteUrl.replace(/\/$/, '');
        const pagesToCheck = ['', '/contacto', '/contact'];
        let allEmails = [];
        let allPhones = [];
        let instagram = '';
        let facebook = '';
        let tiktok = '';
        let whatsapp = '';

        for (const page of pagesToCheck) {
            try {
                const url = base + page;
                const html = await fetchUrl(url, 5000);
                const emails = extractEmails(html);
                const phones = extractPhones(html);
                const ig = extractInstagram(html);
                const fb = extractFacebook(html);
                const tt = extractTikTok(html);
                const wa = extractWhatsApp(html);

                allEmails = [...allEmails, ...emails];
                allPhones = [...allPhones, ...phones];
                if (ig.length && !instagram) instagram = ig[0];
                if (fb.length && !facebook) facebook = fb[0];
                if (tt.length && !tiktok) tiktok = tt[0];
                if (wa.length && !whatsapp) whatsapp = wa[0];

                if (allEmails.length > 0) break;
            } catch (e) {
                continue;
            }
        }

        return {
            email: allEmails[0] || '',
            phones: [...new Set(allPhones)].slice(0, 3),
            instagram,
            facebook,
            tiktok,
            whatsapp
        };
    } catch (err) {
        return { email: '', phones: [], instagram: '', facebook: '', tiktok: '', whatsapp: '' };
    }
}

// =================== ENRICH LEAD ===================
async function enrichLead(lead) {
    if (lead.email && lead.instagram && lead.facebook) return lead;

    if (lead.website) {
        try {
            const websiteData = await scrapeWebsiteForContacts(lead.website);
            if (!lead.email && websiteData.email) lead.email = websiteData.email;
            if (!lead.instagram && websiteData.instagram) lead.instagram = `instagram.com/${websiteData.instagram}`;
            if (!lead.facebook && websiteData.facebook) lead.facebook = `facebook.com/${websiteData.facebook}`;
            if (!lead.tiktok && websiteData.tiktok) lead.tiktok = `tiktok.com/@${websiteData.tiktok}`;
            if (!lead.whatsapp && websiteData.whatsapp) lead.whatsapp = websiteData.whatsapp;
            if (!lead.phone && websiteData.phones?.[0]) lead.phone = websiteData.phones[0];
        } catch (e) { /* ignore */ }
    }
    return lead;
}

// =================== FALLBACK: PA (sin filtro de rubro) ===================
async function scrapePaginasAmarillasFallback(query, city = '', maxResults = 10) {
    const leads = [];
    try {
        const searchQuery = encodeURIComponent(query);
        const citySlug = city.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
        const url = `https://www.paginasamarillas.com.ar/buscar/${searchQuery}${citySlug ? '/' + citySlug : ''}`;

        const html = await fetchUrl(url, 10000);
        const ndMatch = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (!ndMatch) return leads;

        const nd = JSON.parse(ndMatch[1]);
        const results = nd.props?.pageProps?.results || [];

        for (const r of results.slice(0, maxResults)) {
            const email = (r.emails || [])[0] || '';
            const phone = r.mainPhone?.phoneToShow || r.mainPhone?.number || '';
            const website = (r.contactMap?.WEB || [])[0] || '';

            let address = '';
            if (r.mainAddress) {
                const parts = [r.mainAddress.streetName, r.mainAddress.streetNumber].filter(Boolean);
                address = parts.join(' ') + (r.mainAddress.localityToShow ? ', ' + r.mainAddress.localityToShow : '');
            }

            leads.push({
                name: r.name || '',
                email,
                phone,
                website,
                address,
                rating: '',
                reviews: '',
                category: query,
                instagram: '',
                facebook: '',
                tiktok: '',
                whatsapp: '',
                source: 'paginas_amarillas'
            });
        }
    } catch (err) {
        console.error('PA fallback error:', err.message);
    }
    return leads;
}

// =================== MAIN SEARCH ===================
async function searchAll(query, city = '', maxResults = 20) {
    const allLeads = [];
    const startTime = Date.now();

    // 1. Google Places API (primary — filters by category)
    if (getApiKey()) {
        console.log(`🔍 Buscando "${query}" en "${city || 'Argentina'}" con Google Places API...`);
        try {
            const gpLeads = await searchGooglePlaces(query, city, maxResults);
            allLeads.push(...gpLeads);
        } catch (err) {
            console.error('Google Places error:', err.message);
        }
    }

    // 2. If no Google key, try PA fallback (only when Google is unavailable)
    if (allLeads.length === 0) {
        console.log(`📒 Sin Google API, intentando PA como fallback...`);
        try {
            const paLeads = await scrapePaginasAmarillasFallback(query, city, maxResults);
            allLeads.push(...paLeads);
        } catch (err) {
            console.error('PA fallback error:', err.message);
        }
    }

    // 3. Enrich leads with website data (only those with website but no email)
    const leadsToEnrich = allLeads.filter(l => l.website && !l.email);
    if (leadsToEnrich.length > 0 && (Date.now() - startTime) < 20000) {
        console.log(`🔍 Enriqueciendo ${leadsToEnrich.length} leads desde websites...`);
        for (const lead of leadsToEnrich.slice(0, 10)) {
            try {
                const enriched = await enrichLead(lead);
                Object.assign(lead, enriched);
            } catch (e) { /* ignore */ }
        }
    }

    // 4. Deduplicate by name
    const seen = new Set();
    const uniqueLeads = allLeads.filter(l => {
        const key = (l.name || '').toLowerCase().trim();
        if (seen.has(key) || !key) return false;
        seen.add(key);
        return true;
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const withEmail = uniqueLeads.filter(l => l.email).length;
    const withPhone = uniqueLeads.filter(l => l.phone).length;
    console.log(`✅ ${uniqueLeads.length} leads (${withEmail} con email, ${withPhone} con teléfono) en ${elapsed}s`);

    return uniqueLeads;
}

// =================== EXPORT ===================
module.exports = {
    searchAll,
    searchGooglePlaces,
    scrapeWebsiteForContacts,
    enrichLead,
    scrapePaginasAmarillasFallback,
    extractEmails,
    extractPhones,
    extractInstagram,
    extractFacebook,
    extractTikTok
};
