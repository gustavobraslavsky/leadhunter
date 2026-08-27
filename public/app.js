// LeadHunter — Frontend JS
const API = '';

// =================== USAGE TRACKER ===================
let searchUsed = 0;
let searchLimit = 3;
let searchRemaining = 3;

async function loadUsage() {
    try {
        const res = await fetch(`${API}/api/usage`);
        const data = await res.json();
        searchUsed = data.used;
        searchLimit = data.limit;
        searchRemaining = data.remaining;
        updateUsageUI();
    } catch (e) {}
}

function updateUsageUI() {
    document.querySelectorAll('.usage-badge').forEach(el => {
        if (searchRemaining <= 0) {
            el.innerHTML = '🔒 Sin búsquedas gratis hoy';
            el.style.background = 'rgba(255,107,107,0.15)';
            el.style.color = '#ff6b6b';
        } else {
            el.innerHTML = `🔍 ${searchRemaining} de ${searchLimit} búsquedas gratis hoy`;
            el.style.background = 'rgba(108,92,231,0.15)';
            el.style.color = '#6C5CE7';
        }
    });
    document.querySelectorAll('.demo-btn, .search-btn').forEach(btn => {
        if (searchRemaining <= 0) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        }
    });
}

document.addEventListener('DOMContentLoaded', loadUsage);

// =================== DEMO ===================
async function runDemo() {
    const rubro = document.getElementById('demo-rubro').value.trim();
    const ciudad = document.getElementById('demo-ciudad').value.trim();
    if (!rubro || !ciudad) return alert('Completá rubro y ciudad');

    const results = document.getElementById('demo-results');
    results.style.display = 'block';
    results.innerHTML = '<div class="demo-loading"><div class="spinner"></div><p>Scrapeando Google Maps y websites...</p></div>';

    try {
        const res = await fetch(`${API}/api/demo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rubro, ciudad, max: 5 })
        });
        const data = await res.json();

        if (data.error === 'limit_reached') {
            results.innerHTML = `
                <div style="text-align:center;padding:40px 24px;background:rgba(255,107,107,0.08);border-radius:12px;border:1px solid rgba(255,107,107,0.2);">
                    <div style="font-size:2.5rem;margin-bottom:16px;">🔒</div>
                    <h3 style="color:#ff6b6b;margin-bottom:8px;">Límite gratis alcanzado</h3>
                    <p style="color:var(--text-muted);margin-bottom:20px;">Hoy ya hiciste las ${data.limit} búsquedas gratis. Mañana tenés ${data.limit} más.</p>
                    <p style="color:var(--text-muted);margin-bottom:24px;">¿Necesitás más? Upgrade y buscá leads ilimitados.</p>
                    <a href="#pricing" class="btn btn-primary" style="font-size:1rem;padding:12px 32px;">Ver planes y precios →</a>
                </div>
            `;
            return;
        }

        if (data.usage) {
            searchUsed = data.usage.used;
            searchRemaining = data.usage.remaining;
            searchLimit = data.usage.limit;
            updateUsageUI();
        }

        if (data.setupRequired) {
            results.innerHTML = `
                <div style="text-align:center;padding:32px;background:rgba(255,107,107,0.1);border-radius:12px;border:1px solid rgba(255,107,107,0.3);">
                    <h3 style="color:#ff6b6b;margin-bottom:12px;">⚙️ Configuración requerida</h3>
                    <p style="color:var(--text-muted);margin-bottom:16px;">El servidor necesita una API key de Google Places.</p>
                    <p style="color:var(--text-muted);font-size:0.85rem;">Pedile al administrador que agregue <code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;">GOOGLE_MAPS_API_KEY</code> en Render.</p>
                </div>
            `;
            return;
        }
        if (!data.leads || data.leads.length === 0) {
            results.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px;">No se encontraron leads. Probá con otro rubro o ciudad.</p>';
            return;
        }

        results.innerHTML = data.leads.map(l => `
            <div class="lead-card">
                <div>
                    <div class="lead-name">${l.name || 'Sin nombre'}</div>
                    <div class="lead-contact" style="font-size:0.85rem;line-height:1.6;">
                        ${l.email ? '📧 ' + l.email + '<br>' : ''}
                        ${l.phone ? '📱 ' + l.phone + '<br>' : ''}
                        ${l.instagram ? '📸 ' + l.instagram + '<br>' : ''}
                        ${l.facebook ? '👤 ' + l.facebook + '<br>' : ''}
                        ${l.tiktok ? '🎵 ' + l.tiktok + '<br>' : ''}
                        ${l.website ? '🌐 ' + l.website + '<br>' : ''}
                        ${l.address ? '📍 ' + l.address : ''}
                    </div>
                </div>
                <div class="lead-rating">${l.rating ? '⭐ ' + l.rating : ''} ${l.source ? '<span style="font-size:0.7rem;color:var(--text-muted);">(' + l.source + ')</span>' : ''}</div>
            </div>
        `).join('');

        results.innerHTML += `
            <div style="text-align:center;padding:16px;margin-top:16px;background:rgba(108,92,231,0.1);border-radius:12px;">
                <p style="margin-bottom:12px;color:var(--text-muted);">Encontramos <strong style="color:#6C5CE7;">${data.leads.length} leads</strong> con datos de contacto</p>
                <a href="#pricing" class="btn btn-primary" style="font-size:0.9rem;padding:10px 24px;">Empezar a buscar leads →</a>
            </div>
        `;
    } catch (err) {
        results.innerHTML = '<p style="text-align:center;color:#ff6b6b;padding:32px;">Error al buscar leads. Intentá de nuevo.</p>';
    }
}

// =================== BILLING TOGGLE ===================
let isAnnual = false;

function toggleBilling() {
    isAnnual = document.getElementById('billing-toggle').checked;
    
    document.getElementById('toggle-mensual').classList.toggle('active', !isAnnual);
    document.getElementById('toggle-anual').classList.toggle('active', isAnnual);

    document.querySelectorAll('.amount').forEach(el => {
        const mensual = parseInt(el.dataset.mensual);
        const anual = parseInt(el.dataset.anual);
        el.textContent = (isAnnual ? anual : mensual).toLocaleString('es-AR');
    });

    const plans = {
        basico: { mensual: 4970, anual: 3970 },
        pro: { mensual: 14900, anual: 11900 },
        enterprise: { mensual: 29900, anual: 23900 }
    };

    ['basico', 'pro', 'enterprise'].forEach(plan => {
        const el = document.getElementById(`billing-${plan}`);
        if (el) {
            const price = isAnnual ? plans[plan].anual : plans[plan].mensual;
            el.textContent = `${isAnnual ? 'Anual' : 'Mensual'} — $${price.toLocaleString('es-AR')}/mes`;
        }
    });
}

// =================== EMAIL MODAL ===================
let pendingPlan = null;
let pendingBilling = null;

function showEmailModal(plan) {
    pendingPlan = plan;
    pendingBilling = isAnnual ? 'anual' : 'mensual';

    const planNames = { basico: 'Básico', pro: 'Pro', enterprise: 'Enterprise' };
    const prices = {
        basico: { mensual: 4970, anual: 3970 },
        pro: { mensual: 14900, anual: 11900 },
        enterprise: { mensual: 29900, anual: 23900 }
    };
    const price = prices[plan][pendingBilling];

    // Remove existing modal
    const existing = document.getElementById('email-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'email-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;';
    modal.innerHTML = `
        <div style="background:#1A1A3E;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:40px;max-width:440px;width:90%;text-align:center;">
            <h2 style="margin-bottom:8px;color:white;">Plan ${planNames[plan]}</h2>
            <p style="color:#B2B2D0;margin-bottom:24px;">$${price.toLocaleString('es-AR')}/${pendingBilling === 'anual' ? 'mes (anual)' : 'mes'}</p>
            <p style="color:var(--text-muted);margin-bottom:16px;font-size:0.9rem;">Ingrecá tu email para continuar con el pago</p>
            <input type="email" id="checkout-email" placeholder="tu@email.com" style="width:100%;padding:14px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.05);color:white;font-size:1rem;margin-bottom:16px;box-sizing:border-box;" />
            <button onclick="processCheckout()" style="width:100%;padding:14px;border-radius:8px;border:none;background:#6C5CE7;color:white;font-weight:700;font-size:1rem;cursor:pointer;">Ir a pagar →</button>
            <p onclick="closeEmailModal()" style="color:var(--text-muted);margin-top:16px;cursor:pointer;font-size:0.85rem;">Cancelar</p>
            <p id="checkout-error" style="color:#ff6b6b;margin-top:12px;display:none;font-size:0.85rem;"></p>
        </div>
    `;
    document.body.appendChild(modal);

    // Enter key
    document.getElementById('checkout-email').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') processCheckout();
    });
    document.getElementById('checkout-email').focus();
}

function closeEmailModal() {
    const modal = document.getElementById('email-modal');
    if (modal) modal.remove();
    pendingPlan = null;
    pendingBilling = null;
}

async function processCheckout() {
    const email = document.getElementById('checkout-email').value.trim();
    const errorEl = document.getElementById('checkout-error');

    if (!email || !email.includes('@')) {
        errorEl.textContent = 'Ingresá un email válido';
        errorEl.style.display = 'block';
        return;
    }

    errorEl.style.display = 'none';
    const btn = document.querySelector('#email-modal button');
    btn.disabled = true;
    btn.textContent = '⏳ Procesando...';

    try {
        const res = await fetch(`${API}/api/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan: pendingPlan, billing: pendingBilling, email })
        });
        const data = await res.json();

        if (data.init_point) {
            window.location.href = data.init_point;
        } else if (data.error) {
            errorEl.textContent = data.error;
            errorEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Ir a pagar →';
        }
    } catch (err) {
        errorEl.textContent = 'Error al procesar. Intentá de nuevo.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Ir a pagar →';
    }
}

// =================== CHECKOUT (wrapper) ===================
function checkout(plan) {
    showEmailModal(plan);
}

// =================== SCROLL SMOOTH ===================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelector(this.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth' });
    });
});
