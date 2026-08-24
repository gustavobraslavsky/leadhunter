// LeadHunter — Frontend JS
const API = '';

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

        if (data.setupRequired) {
            results.innerHTML = `
                <div style="text-align:center;padding:32px;background:rgba(255,107,107,0.1);border-radius:12px;border:1px solid rgba(255,107,107,0.3);">
                    <h3 style="color:var(--danger);margin-bottom:12px;">⚙️ Configuración requerida</h3>
                    <p style="color:var(--text-muted);margin-bottom:16px;">El servidor necesita una API key de Google Places para buscar negocios por rubro.</p>
                    <p style="color:var(--text-muted);font-size:0.85rem;">Pedile al administrador que agregue <code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;">GOOGLE_MAPS_API_KEY</code> en las variables de entorno de Render.</p>
                </div>
            `;
            return;
        }
        if (!data.leads || data.leads.length === 0) {
            results.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px;">No se encontraron leads en esta búsqueda. Probá con otro rubro o ciudad (ej: odontólogos Córdoba, hoteles Bariloche, restaurantes Rosario).</p>';
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

        // Add CTA
        results.innerHTML += `
            <div style="text-align:center;padding:16px;margin-top:16px;background:rgba(108,92,231,0.1);border-radius:12px;">
                <p style="margin-bottom:12px;color:var(--text-muted);">Encontramos <strong style="color:var(--accent);">${data.leads.length} leads</strong> con datos de contacto</p>
                <a href="#pricing" class="btn btn-primary" style="font-size:0.9rem;padding:10px 24px;">Empezar a buscar leads →</a>
            </div>
        `;
    } catch (err) {
        results.innerHTML = '<p style="text-align:center;color:var(--danger);padding:32px;">Error al buscar leads. Intentá de nuevo.</p>';
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

// =================== CHECKOUT ===================
async function checkout(plan) {
    const billing = isAnnual ? 'anual' : 'mensual';

    try {
        const res = await fetch(`${API}/api/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan, billing })
        });
        const data = await res.json();

        if (data.init_point) {
            window.location.href = data.init_point;
        } else if (data.error) {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        alert('Error al procesar el pago. Intentá de nuevo.');
    }
}

// =================== SCROLL SMOOTH ===================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelector(this.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth' });
    });
});
