// LeadHunter — Scrapers Multi-Fuente
// Instagram, Facebook, TikTok, LinkedIn, Páginas Amarillas, Google Maps

const https = require('https');
const http = require('http');
const { URL } = require('url');

// =================== UTILIDADES ===================
function fetchUrl(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const req = protocol.get(url, { timeout, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

function extractEmails(text) {
    if (!text) return [];
    const regex = /[a-zA-Z0-9._%+\-!#$&'*/=?^`{|}~]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const found = text.match(regex) || [];
    const blocked = /^(example|test|email|demo|prueba|sample|noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|webmaster|abuse|sentry|wixpress|sentry-next|ejemplo|sentry\.io)/i;
    const extBlocked = /\.(png|jpg|jpeg|gif|svg|webp|css|js|ico|woff|ttf)$/i;
    const imgBlocked = /nuvempago@|@sentry|@wixpress/i;
    return [...new Set(found)].filter(e => !blocked.test(e) && !extBlocked.test(e) && !imgBlocked.test(e));
}

function extractPhones(text) {
    if (!text) return [];
    const regex = /(?:\+54|0054|54)?[\s\-]?(?:11|221|223|225|341|351|343|381|387|299|291|298|379|370|388|362|376|383|261|297|380|264|385|381|220|226|227|228|229|236|237|249|260|263|266|280|290|293|294|296|336|340|342|345|347|348|349|352|353|354|356|358|364|371|372|373|374|375|377|378|382|384|386|391|392|394|397|398)[\s\-]?\d{3,4}[\s\-]?\d{4}/g;
    const found = text.match(regex) || [];
    return [...new Set(found.map(p => p.replace(/\s/g, '').trim()))];
}

function extractWhatsApp(text) {
    if (!text) return [];
    const regex = /(?:wa\.me|api\.whatsapp\.com\/send|whatsapp:\/?\/?\?)?(?:.*?(?:phone|tel)=?)?(\+?54\d{10,13})/gi;
    const found = text.match(regex) || [];
    return [...new Set(found)];
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
        if (page && !['sharer', 'share', 'login', 'groups', 'pages'].includes(page)) {
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

function extractLinkedIn(text) {
    if (!text) return [];
    const regex = /(?:linkedin\.com\/(?:company|in)\/)([a-zA-Z0-9._-]+)/g;
    const found = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        found.push(match[1]);
    }
    return [...new Set(found)];
}

// =================== GOOGLE MAPS SCRAPER ===================
async function scrapeGoogleMaps(query, maxResults = 20) {
    const puppeteer = require('puppeteer');
    
    // Detect environment: Docker/Linux vs Windows
    const isDocker = process.env.DOCKER || process.platform === 'linux';
    const launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    };
    
    // Only set executablePath on Windows (Docker uses bundled Chromium)
    if (!isDocker && process.platform === 'win32') {
        launchOptions.executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    }
    
    const browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const leads = [];
    try {
        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForSelector('[role="feed"]', { timeout: 15000 }).catch(() => {});

        // Scroll to load more results
        for (let i = 0; i < 5; i++) {
            await page.evaluate(() => {
                const feed = document.querySelector('[role="feed"]');
                if (feed) feed.scrollTop = feed.scrollHeight;
            });
            await new Promise(r => setTimeout(r, 1500));
        }

        const items = await page.$$('[role="feed"] > div > div > a[href*="/maps/place/"]');
        const toProcess = items.slice(0, maxResults);

        for (const item of toProcess) {
            try {
                await item.click();
                await new Promise(r => setTimeout(r, 2000));

                const panelHtml = await page.evaluate(() => {
                    const panel = document.querySelector('[role="main"]');
                    return panel ? panel.innerHTML : '';
                });

                const panelText = await page.evaluate(() => {
                    const panel = document.querySelector('[role="main"]');
                    return panel ? panel.innerText : '';
                });

                const name = await page.evaluate(() => {
                    const h1 = document.querySelector('h1');
                    return h1 ? h1.innerText.trim() : '';
                });

                const emails = extractEmails(panelHtml + ' ' + panelText);
                const phones = extractPhones(panelText);
                const instagram = extractInstagram(panelHtml);
                const facebook = extractFacebook(panelHtml);
                const tiktok = extractTikTok(panelHtml);

                // Extract rating
                const ratingMatch = panelText.match(/(\d+\.?\d*)\s*\(\s*(\d[\d,]*)\s*\)/);
                const rating = ratingMatch ? ratingMatch[1] : '';
                const reviews = ratingMatch ? ratingMatch[2].replace(',', '') : '';

                // Extract address
                const address = await page.evaluate(() => {
                    const items = document.querySelectorAll('[data-item-id="address"]');
                    return items.length > 0 ? items[0].innerText.trim() : '';
                });

                // Extract website
                const website = await page.evaluate(() => {
                    const link = document.querySelector('[data-item-id="authority"] a');
                    return link ? link.href : '';
                });

                // Extract phone from data
                const phone = await page.evaluate(() => {
                    const phoneEl = document.querySelector('[data-item-id*="phone"] .Io6YTe');
                    return phoneEl ? phoneEl.innerText.trim() : '';
                });

                if (name) {
                    leads.push({
                        name,
                        email: emails[0] || '',
                        phone: phone || (phones[0] || ''),
                        website,
                        rating,
                        reviews,
                        address,
                        instagram: instagram[0] ? `instagram.com/${instagram[0]}` : '',
                        facebook: facebook[0] ? `facebook.com/${facebook[0]}` : '',
                        tiktok: tiktok[0] ? `tiktok.com/@${tiktok[0]}` : '',
                        source: 'google_maps'
                    });
                }

                // Go back to results
                await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
                await new Promise(r => setTimeout(r, 1000));
            } catch (err) {
                continue;
            }
        }
    } catch (err) {
        console.error('Google Maps error:', err.message);
    }

    await browser.close();
    return leads;
}

// =================== PAGINAS AMARILLAS SCRAPER ===================
async function scrapePaginasAmarillas(query, city = 'buenos-aires', maxResults = 20) {
    const leads = [];
    try {
        const searchQuery = encodeURIComponent(query);
        const url = `https://www.paginasamarillas.com.ar/buscar/${searchQuery}/${city}`;
        const html = await fetchUrl(url);

        // Extract business listings
        const nameRegex = /<h2[^>]*class="[^"]*business-name[^"]*"[^>]*>(.*?)<\/h2>/gi;
        const phoneRegex = /tel:\s*([0-9\s\-()+]+)/gi;
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

        const names = [];
        let match;
        while ((match = nameRegex.exec(html)) !== null) {
            names.push(match[1].replace(/<[^>]+>/g, '').trim());
        }

        const phones = [];
        while ((match = phoneRegex.exec(html)) !== null) {
            phones.push(match[1].trim());
        }

        const emails = extractEmails(html);

        // Extract addresses
        const addressRegex = /<span[^>]*class="[^"]*card-address[^"]*"[^>]*>(.*?)<\/span>/gi;
        const addresses = [];
        while ((match = addressRegex.exec(html)) !== null) {
            addresses.push(match[1].replace(/<[^>]+>/g, '').trim());
        }

        for (let i = 0; i < Math.min(names.length, maxResults); i++) {
            leads.push({
                name: names[i] || '',
                email: emails[i] || '',
                phone: phones[i] || '',
                website: '',
                rating: '',
                reviews: '',
                address: addresses[i] || '',
                instagram: '',
                facebook: '',
                tiktok: '',
                source: 'paginas_amarillas'
            });
        }
    } catch (err) {
        console.error('Paginas Amarillas error:', err.message);
    }

    return leads;
}

// =================== INSTAGRAM DISCOVERY ===================
async function scrapeInstagramBio(username) {
    try {
        const url = `https://www.instagram.com/${username}/`;
        const html = await fetchUrl(url);

        const emails = extractEmails(html);
        const phones = extractPhones(html);
        const facebook = extractFacebook(html);
        const tiktok = extractTikTok(html);

        // Try to extract bio description
        const bioMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
        const bio = bioMatch ? bioMatch[1] : '';

        return {
            email: emails[0] || '',
            phone: phones[0] || '',
            facebook: facebook[0] ? `facebook.com/${facebook[0]}` : '',
            tiktok: tiktok[0] ? `tiktok.com/@${tiktok[0]}` : '',
            bio
        };
    } catch (err) {
        return { email: '', phone: '', bio: '' };
    }
}

// =================== FACEBOOK PAGE SCRAPER ===================
async function scrapeFacebookPage(pageName) {
    try {
        const url = `https://www.facebook.com/${pageName}/about`;
        const html = await fetchUrl(url);

        const emails = extractEmails(html);
        const phones = extractPhones(html);

        // Extract address
        const addressMatch = html.match(/"street":"([^"]+)"/);
        const cityMatch = html.match(/"city":"([^"]+)"/);
        const address = [addressMatch?.[1], cityMatch?.[1]].filter(Boolean).join(', ');

        return {
            email: emails[0] || '',
            phone: phones[0] || '',
            address
        };
    } catch (err) {
        return { email: '', phone: '', address: '' };
    }
}

// =================== TIKTOK PROFILE SCRAPER ===================
async function scrapeTikTokProfile(username) {
    try {
        const url = `https://www.tiktok.com/@${username}`;
        const html = await fetchUrl(url);

        const emails = extractEmails(html);

        // Extract bio
        const bioMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
        const bio = bioMatch ? bioMatch[1] : '';

        const phones = extractPhones(bio);

        return {
            email: emails[0] || '',
            phone: phones[0] || '',
            bio
        };
    } catch (err) {
        return { email: '', phone: '', bio: '' };
    }
}

// =================== WEBSITE SCRAPER (multi-page) ===================
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
                const html = await fetchUrl(url, 8000);
                
                const emails = extractEmails(html);
                const phones = extractPhones(html);
                const ig = extractInstagram(html);
                const fb = extractFacebook(html);

                allEmails = [...allEmails, ...emails];
                allPhones = [...allPhones, ...phones];
                if (ig.length && !instagram) instagram = `instagram.com/${ig[0]}`;
                if (fb.length && !facebook) facebook = `facebook.com/${fb[0]}`;

                if (allEmails.length > 0) break; // Found email, no need to check more pages
            } catch (err) {
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

// =================== ENRICH LEAD (visit website if missing data) ===================
async function enrichLead(lead) {
    if (lead.email && lead.instagram && lead.facebook) return lead; // Already rich

    const websiteToVisit = lead.website;
    if (websiteToVisit) {
        const websiteData = await scrapeWebsiteForContacts(websiteToVisit);
        if (!lead.email && websiteData.email) lead.email = websiteData.email;
        if (!lead.instagram && websiteData.instagram) lead.instagram = websiteData.instagram;
        if (!lead.facebook && websiteData.facebook) lead.facebook = websiteData.facebook;
        if (!lead.phone && websiteData.phones?.[0]) lead.phone = websiteData.phones[0];
    }

    return lead;
}

// =================== MULTI-SOURCE SEARCH ===================
async function searchAll(query, city = 'Buenos Aires', maxResults = 10) {
    const allLeads = [];

    // 1. Google Maps
    console.log(`🗺️  Scraping Google Maps: "${query} ${city}"...`);
    const mapsLeads = await scrapeGoogleMaps(`${query} ${city}`, maxResults);
    allLeads.push(...mapsLeads);

    // 2. Enrich leads with missing data
    console.log(`🔍 Enriching leads with website data...`);
    for (const lead of allLeads) {
        if (lead.website && (!lead.email || !lead.instagram)) {
            const enriched = await enrichLead(lead);
            Object.assign(lead, enriched);
        }
    }

    // 3. Filter leads with at least one contact method
    const validLeads = allLeads.filter(l =>
        l.email || l.phone || l.instagram || l.facebook || l.tiktok
    );

    console.log(`✅ Found ${validLeads.length} leads with contact data`);
    return validLeads;
}

// =================== EXPORT ===================
module.exports = {
    scrapeGoogleMaps,
    scrapePaginasAmarillas,
    scrapeInstagramBio,
    scrapeFacebookPage,
    scrapeTikTokProfile,
    scrapeWebsiteForContacts,
    enrichLead,
    searchAll,
    extractEmails,
    extractPhones,
    extractWhatsApp,
    extractInstagram,
    extractFacebook,
    extractTikTok,
    extractLinkedIn
};
