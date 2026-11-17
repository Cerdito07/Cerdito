/*
 * Avisos de visitas de Alejandro.
 * IP y datos técnicos: aviso inicial; analítica de interacción: solo con permiso;
 * geolocalización del dispositivo: solo pulsando el botón y aprobando el navegador.
 * IMPORTANTE: esta versión estática conserva el webhook del proyecto original en
 * keys.js, pero este secreto es visible en el navegador. Para producción usar backend.
 */
(() => {
    'use strict';

    const settings = typeof config !== 'undefined' ? config : (window.config || {});
    const notice = document.getElementById('visit-privacy-notice');
    const acceptButton = document.getElementById('allow-analytics');
    const rejectButton = document.getElementById('reject-analytics');
    const gpsButton = document.getElementById('share-location');
    const status = document.getElementById('visit-status');
    const permissionButtons = document.getElementById('analytics-actions');

    const state = {
        started: Date.now(),
        ip: null,
        geoOne: null,
        geoTwo: null,
        count: null,
        analytics: false,
        consentResolved: false,
        gps: null,
        battery: null,
        clicks: [],
        clickCount: 0,
        maxScroll: 0,
        sent: false,
        messageEditUrl: null,
        updatePending: false,
        updateRunning: false,
        updateTimer: null,
        lastUpdated: 0,
        webhookReady: false,
        failure: null,
        analyticsFollowupSent: false,
        gpsFollowupSent: false,
        analyticsTimer: null,
        visitId: (typeof crypto !== 'undefined' && crypto.getRandomValues)
            ? Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('')
            : String(Date.now()).slice(-8)
    };

    const available = (value, fallback = 'No disponible') =>
        value === undefined || value === null || value === '' ? fallback : String(value);

    const clean = (value, limit = 180) => available(value)
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/@everyone|@here/gi, value => '@\u200b' + value.slice(1))
        .replace(/<@/g, '<@\u200b')
        .slice(0, limit);

    const add = (name, value, inline = true) => ({
        name: clean(name, 90), value: clean(value, 250), inline
    });
    const yesNo = value => value === true ? 'Sí' : value === false ? 'No' : 'No disponible';
    const n = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const coord = value => value === null || value === undefined || value === '' || n(Number(value)) === null ? null : Number(value).toFixed(3);

    const match = rule => {
        try { return window.matchMedia(rule).matches; } catch (_) { return null; }
    };

    const timeoutJson = async (url, ms = 6000) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ms);
        try {
            const result = await fetch(url, {
                method: 'GET', signal: controller.signal, cache: 'no-store',
                credentials: 'omit', referrerPolicy: 'no-referrer'
            });
            if (!result.ok) throw new Error(`HTTP ${result.status}`);
            return await result.json();
        } finally { clearTimeout(timeout); }
    };

    // Evita almacenar URLs externas completas: podrían incluir identificadores privados.
    const referral = () => {
        if (!document.referrer) return 'Directo o referencia oculta';
        try { return new URL(document.referrer).hostname || 'Desconocido'; }
        catch (_) { return 'No disponible'; }
    };

    const campaign = () => {
        const params = new URLSearchParams(location.search);
        const allowed = ['utm_source', 'utm_medium', 'utm_campaign'];
        const parts = allowed.filter(k => params.get(k)).map(k => `${k}: ${clean(params.get(k), 60)}`);
        return parts.length ? parts.join(' · ') : 'Sin parámetros UTM';
    };

    function basicSystem() {
        const ua = navigator.userAgent || '';
        const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS / iPadOS'
            : /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
            : /Linux/i.test(ua) ? 'Linux' : 'No identificado';
        const browser = /Edg\//i.test(ua) ? 'Microsoft Edge' : /OPR\//i.test(ua) ? 'Opera'
            : /Firefox\//i.test(ua) ? 'Firefox' : /Chrome\//i.test(ua) ? 'Chrome / Chromium'
            : /Safari\//i.test(ua) ? 'Safari' : 'No identificado';
        const category = /iPad|Tablet/i.test(ua) ? 'Tablet'
            : /Mobi|Android|iPhone|iPod/i.test(ua) ? 'Móvil' : 'Ordenador / otro';
        return { os, browser, category };
    }

    function botSignals() {
        const agent = navigator.userAgent || '';
        const hints = [];
        if (navigator.webdriver === true) hints.push('Navegación automatizada');
        if (/bot|crawler|spider|headless/i.test(agent)) hints.push('Agente de usuario automatizado');
        return hints.length ? hints.join(' / ') : 'Sin señales obvias (no concluyente)';
    }

    function mapLink(lat, lon, zoom) {
        const latitude = lat === null || lat === undefined || lat === '' ? null : n(Number(lat));
        const longitude = lon === null || lon === undefined || lon === '' ? null : n(Number(lon));
        if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
        const a = latitude.toFixed(4), b = longitude.toFixed(4);
        return `https://www.openstreetmap.org/?mlat=${a}&mlon=${b}#map=${zoom}/${a}/${b}`;
    }

    function primaryLocationFields() {
        const first = state.geoOne;
        const second = state.geoTwo;
        const fallback = first || second || {};
        const country = first?.country || second?.country_name;
        const city = first?.city || second?.city;
        const region = first?.region || second?.region;
        const postcode = first?.postal || second?.postal;
        const latitude = first?.latitude ?? second?.latitude;
        const longitude = first?.longitude ?? second?.longitude;
        const approximateMap = mapLink(latitude, longitude, 10);
        const rawOneCity = (first?.city || '').trim().toLowerCase();
        const rawTwoCity = (second?.city || '').trim().toLowerCase();
        const comparison = rawOneCity && rawTwoCity
            ? rawOneCity === rawTwoCity
                ? 'Ambas fuentes coinciden en la ciudad (no garantiza exactitud)'
                : `Las fuentes discrepan: ${first.city} / ${second.city}`
            : second || first ? 'Solo hay una fuente con ciudad verificable' : 'Fuentes no disponibles';
        return [
            add('🌍 IP pública', state.ip || 'No disponible'),
            add('🌐 Tipo de IP', first?.type || 'No disponible'),
            add('🌎 Continente', first?.continent || second?.continent_code),
            add('🏳️ País (aproximado)', country),
            add('📍 Región (aproximada)', region),
            add('🏙️ Ciudad (aproximada)', city),
            add('📮 Código postal estimado', postcode),
            add('🧭 Coordenadas IP estimadas', coord(latitude) !== null && coord(longitude) !== null
                ? `${coord(latitude)}, ${coord(longitude)} (centro estimado, NO domicilio)` : 'No disponibles', false),
            add('🗺️ Mapa IP (aproximado)', approximateMap || 'No disponible', false),
            add('📊 Comparación de proveedores', comparison, false),
            add('📡 Proveedor de red (ISP)', first?.connection?.isp || second?.org),
            add('🏢 Organización de red', first?.connection?.org || second?.org),
            add('🔢 ASN', first?.connection?.asn || second?.asn),
            add('🕒 Zona horaria por IP', first?.timezone?.id || second?.timezone),
            add('🛡️ VPN / proxy / Tor', 'No verificable con estas fuentes gratuitas', false)
        ];
    }

    function technicalFields() {
        const device = basicSystem();
        const battery = state.battery;
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        return [
            add('🖥️ Navegador (User-Agent)', navigator.userAgent, false),
            add('🧭 Navegador interpretado', device.browser),
            add('💿 Sistema operativo estimado', device.os),
            add('📱 Tipo de dispositivo', device.category),
            add('💻 Plataforma', navigator.userAgentData?.platform || navigator.platform),
            add('🌐 Idioma', navigator.language),
            add('🗣️ Idiomas configurados', navigator.languages?.join(', '), false),
            add('🕒 Zona horaria del dispositivo', Intl.DateTimeFormat().resolvedOptions().timeZone),
            add('📅 Fecha local', new Date().toLocaleString()),
            add('📺 Pantalla', `${screen.width} × ${screen.height}`),
            add('🪟 Ventana', `${innerWidth} × ${innerHeight}`),
            add('🔍 Densidad / profundidad', `${window.devicePixelRatio || 1} DPR · ${screen.colorDepth || '—'} bits`),
            add('🔄 Orientación', screen.orientation?.type || (innerWidth > innerHeight ? 'Horizontal' : 'Vertical')),
            add('🧠 Núcleos CPU estimados', navigator.hardwareConcurrency),
            add('🧮 RAM estimada', navigator.deviceMemory ? `${navigator.deviceMemory} GB` : null),
            add('👆 Puntos táctiles', navigator.maxTouchPoints),
            add('📶 Conectado', yesNo(navigator.onLine)),
            add('🕵️ Posible automatización', botSignals(), false),
            add('🔗 Referencia (dominio)', referral(), false),
            add('📄 Página visitada', location.pathname || '/'),
            add('🌗 Tema oscuro preferido', yesNo(match('(prefers-color-scheme: dark)'))),
            add('♿ Movimiento reducido', yesNo(match('(prefers-reduced-motion: reduce)'))),
            add('🎨 Mayor contraste', yesNo(match('(prefers-contrast: more)'))),
            add('🍪 Cookies habilitadas', yesNo(navigator.cookieEnabled)),
            add('🔐 Privacidad DNT / GPC', `DNT: ${available(navigator.doNotTrack)} · GPC: ${yesNo(navigator.globalPrivacyControl)}`, false)
        ];
    }

    function extraFields() {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        const battery = state.battery;
        const duration = Math.max(0, Math.round((Date.now() - state.started) / 1000));
        const clickText = state.clicks.length ? state.clicks.slice(-8).join(' · ') : 'Aún sin interacción registrada';
        let gpsText = 'No compartida; solo se pide con autorización explícita';
        if (state.gps) {
            const lat = state.gps.latitude;
            const lon = state.gps.longitude;
            gpsText = `${lat.toFixed(5)}, ${lon.toFixed(5)} · precisión declarada ±${Math.round(state.gps.accuracy)} m`;
        }
        return [
            add('📊 Analítica de navegación', state.analytics ? 'Autorizada por el visitante' : 'No autorizada; sin seguimiento de clics', false),
            add('🔗 Campaña de acceso', state.analytics ? campaign() : 'No consultada sin consentimiento', false),
            add('⏱️ Tiempo en la página', state.analytics ? `${duration} s (hasta última actualización)` : 'No registrado'),
            add('🖱️ Interacciones / clics', state.analytics ? state.clickCount : 'No registrado'),
            add('🔘 Enlaces y botones', state.analytics ? clickText : 'No registrado', false),
            add('📜 Máximo de página recorrido', state.analytics ? `${state.maxScroll}%` : 'No registrado'),
            add('👁️ Visibilidad de pestaña', state.analytics ? document.visibilityState : 'No registrada'),
            add('📡 Calidad de conexión', state.analytics && conn ? `${available(conn.effectiveType)} · ${available(conn.downlink)} Mbps · RTT ${available(conn.rtt)} ms` : 'No disponible / sin consentimiento', false),
            add('🪫 Ahorro de datos', state.analytics ? yesNo(conn?.saveData) : 'No consultado'),
            add('🔋 Batería', state.analytics && battery ? `${Math.round(battery.level * 100)}% · Cargando: ${yesNo(battery.charging)}` : 'No disponible / sin consentimiento', false),
            add('📲 Modo app instalada', state.analytics ? yesNo(match('(display-mode: standalone)')) : 'No consultado'),
            add('📍 GPS (opcional)', gpsText, false),
            ...(state.gps ? [add('🗺️ Mapa GPS (autorizado)', mapLink(state.gps.latitude, state.gps.longitude, 16), false)] : [])
        ];
    }

    function buildPayload() {
        // Discord: 25 campos por embed, 6000 caracteres entre todos los embeds.
        const a = primaryLocationFields();
        const b = technicalFields();
        const c = extraFields();
        // Mantener cada bloque por debajo de 25 campos (técnicos se dividen).
        const embeds = [
            { title: '🐷 Nuevo visitante · Alejandro — IP y ubicación estimada', color: 0xffb3e6, fields: a },
            { title: '🖥️ Dispositivo y navegador (1/2)', color: 0xc46dcb, fields: b.slice(0, 16) },
            { title: '🔎 Dispositivo y navegación (2/2)', color: 0xc46dcb, fields: b.slice(16) },
            { title: '📈 Analítica voluntaria y GPS autorizado', color: 0x8c75e5, fields: c,
                footer: { text: `Alejandro · Visitas: ${state.count ?? 'sin datos'} · Ref. visita: ${state.visitId}` },
                timestamp: new Date().toISOString() }
        ];
        // Discord limita la suma de caracteres de todos los embeds a 6000.
        // Si el navegador devuelve textos largos se recortan en orden inverso.
        const size = () => embeds.reduce((count, e) => count + (e.title?.length || 0) +
            (e.footer?.text?.length || 0) + e.fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0), 0);
        while (size() > 5700) {
            const field = embeds.flatMap(e => e.fields).filter(f => f.value.length > 65)
                .sort((x, y) => y.value.length - x.value.length)[0];
            if (!field) break;
            field.value = field.value.slice(0, Math.max(55, field.value.length - 80)) + '…';
        }
        return {
            content: '<@583908818367414272>',
            allowed_mentions: { parse: [], users: ['583908818367414272'] },
            embeds
        };
    }

    async function getVisitCount() {
        const bin = settings?.binId;
        const apiKey = settings?.apiKey;
        if (!bin || !apiKey) return;
        const url = `https://api.jsonbin.io/v3/b/${encodeURIComponent(bin)}`;
        const headers = { 'Content-Type': 'application/json', 'X-Master-Key': apiKey };
        try {
            const response = await fetch(url + '/latest', { headers, cache: 'no-store' });
            if (!response.ok) throw new Error(`JSONBin ${response.status}`);
            const data = await response.json();
            state.count = (Number(data?.record?.visits) || 0) + 1;
            const updated = await fetch(url, {
                method: 'PUT', headers, body: JSON.stringify({ visits: state.count })
            });
            if (!updated.ok) console.warn('No se pudo actualizar el contador.');
        } catch (error) {
            console.warn('Contador de visitas no disponible:', error.message);
        }
    }

    async function getIpAndLocation() {
        // Llamadas simultáneas para no retrasar el primer aviso si un proveedor falla.
        // Cada proveedor recibe la IP del visitante directamente desde su navegador.
        const lookups = [
            timeoutJson('https://ipwho.is/', 3200).then(data => {
                if (data?.success && data.ip) {
                    state.geoOne = data;
                    state.ip = state.ip || data.ip;
                }
            }).catch(error => console.warn('IPWho.is:', error.message)),
            timeoutJson('https://ipapi.co/json/', 3200).then(data => {
                if (data?.ip && !data.error) {
                    state.geoTwo = data;
                    state.ip = state.ip || data.ip;
                }
            }).catch(error => console.warn('ipapi.co:', error.message)),
            timeoutJson('https://api.ipify.org?format=json', 3200).then(data => {
                if (data?.ip) state.ip = state.ip || data.ip;
            }).catch(error => console.warn('ipify:', error.message))
        ];
        await Promise.allSettled(lookups);
    }

    function discordAddress() {
        const raw = settings?.webhookUrl;
        if (!raw) return null;
        try {
            const url = new URL(raw);
            if (url.protocol !== 'https:' || !/^(discord|discordapp)\.com$/.test(url.hostname) ||
                !/^\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(url.pathname)) {
                console.warn('Dirección del webhook no válida.');
                return null;
            }
            return url.toString();
        } catch (_) { return null; }
    }

    async function postToDiscord(payload, preferBeacon = false) {
        const webhook = discordAddress();
        if (!webhook) {
            console.warn('Webhook ausente o inválido en keys.js.');
            return false;
        }
        // Discord admite multipart/form-data con payload_json. Esta solicitud
        // simple, no-cors, evita los errores de preflight de las webs estáticas.
        // La respuesta es opaca: NO se puede verificar la entrega ni editar mensajes.
        const form = new FormData();
        form.append('payload_json', JSON.stringify(payload));
        if (preferBeacon && typeof navigator.sendBeacon === 'function') {
            try { if (navigator.sendBeacon(webhook, form)) return true; }
            catch (_) { /* intentar fetch */ }
        }
        try {
            await fetch(webhook, { method: 'POST', mode: 'no-cors', body: form, keepalive: true });
            return true; // enviado por el navegador; no implica confirmado por Discord
        } catch (error) {
            console.warn('El navegador no pudo enviar el aviso a Discord:', error);
            return false;
        }
    }

    async function sendInitial(preferBeacon = false) {
        if (state.sent) return;
        state.sent = true; // evitar envíos duplicados mientras se procesa
        const dispatched = await postToDiscord(buildPayload(), preferBeacon);
        if (!dispatched) {
            state.sent = false;
            state.failure = 'La solicitud de aviso no pudo salir del navegador.';
        } else {
            state.failure = null;
            if (state.analytics) scheduleAnalytics();
            if (state.gps && !state.gpsFollowupSent) void sendGpsSupplement();
        }
    }

    function followupEmbed(type, fields) {
        return {
            content: '',
            allowed_mentions: { parse: [] },
            embeds: [{
                title: type,
                color: 0xb679cf,
                description: `Datos opcionales de la visita ${state.visitId} (relacionar con el aviso inicial).`,
                fields: fields.slice(0, 25),
                timestamp: new Date().toISOString()
            }]
        };
    }

    async function sendGpsSupplement(preferBeacon = false) {
        if (!state.gps || !state.sent || state.gpsFollowupSent) return;
        state.gpsFollowupSent = true;
        const fields = [
            add('📍 GPS autorizado', `${state.gps.latitude.toFixed(5)}, ${state.gps.longitude.toFixed(5)}`, false),
            add('📏 Precisión informada', `±${Math.round(state.gps.accuracy)} m`),
            add('🗺️ Mapa GPS', mapLink(state.gps.latitude, state.gps.longitude, 16), false)
        ];
        if (!await postToDiscord(followupEmbed('📍 Ubicación compartida voluntariamente', fields), preferBeacon))
            state.gpsFollowupSent = false;
    }

    async function sendAnalyticsSupplement(preferBeacon = false) {
        if (!state.sent || !state.analytics || state.analyticsFollowupSent) return;
        state.analyticsFollowupSent = true;
        if (state.analyticsTimer) { clearTimeout(state.analyticsTimer); state.analyticsTimer = null; }
        const fields = extraFields().filter(f => !/GPS|Mapa GPS/.test(f.name));
        if (!await postToDiscord(followupEmbed('📈 Estadísticas autorizadas de la visita', fields), preferBeacon))
            state.analyticsFollowupSent = false;
    }

    function scheduleAnalytics() {
        if (!state.analytics || state.analyticsFollowupSent || state.analyticsTimer) return;
        // Evitar enviar las estadísticas de inmediato, antes de que exista actividad.
        state.analyticsTimer = setTimeout(() => {
            state.analyticsTimer = null;
            void sendAnalyticsSupplement();
        }, 15000);
    }

    function requestUpdate(force = false) {
        if (!state.sent) return;
        if (state.gps && !state.gpsFollowupSent) void sendGpsSupplement();
        if (state.analytics) scheduleAnalytics();
    }

    function updateStatus(message) { if (status) status.textContent = message; }
    const changeButton = document.getElementById('change-analytics');
    const savedConsentKey = 'alejandro-estadisticas-v1';
    function writeConsent(value) {
        try { localStorage.setItem(savedConsentKey, value); } catch (_) { /* navegación privada */ }
    }
    function readConsent() {
        try { return localStorage.getItem(savedConsentKey); } catch (_) { return null; }
    }
    function setConsent(allowed, store = true) {
        state.consentResolved = true;
        state.analytics = allowed;
        if (permissionButtons) permissionButtons.hidden = true;
        if (store) writeConsent(allowed ? 'allow' : 'reject');
        if (allowed) {
            updateStatus('Estadísticas permitidas. Puedes cambiar esta elección cuando quieras.');
            if (typeof navigator.getBattery === 'function') {
                navigator.getBattery().then(battery => {
                    if (state.analytics) state.battery = { level: battery.level, charging: battery.charging };
                }).catch(() => {});
            }
            scheduleAnalytics();
        } else {
            state.battery = null;
            if (state.analyticsTimer) clearTimeout(state.analyticsTimer);
            state.analyticsTimer = null;
            updateStatus('Estadísticas rechazadas. No se registrarán tus clics ni desplazamientos.');
        }
    }
    if (acceptButton) acceptButton.addEventListener('click', () => setConsent(true));
    if (rejectButton) rejectButton.addEventListener('click', () => setConsent(false));
    if (changeButton) changeButton.addEventListener('click', () => {
        if (permissionButtons) permissionButtons.hidden = false;
        updateStatus('Elige si permites estadísticas de navegación.');
    });
    const previous = readConsent();
    if (previous === 'allow' || previous === 'reject') setConsent(previous === 'allow', false);

    if (gpsButton) gpsButton.addEventListener('click', () => {
        if (!navigator.geolocation || !window.isSecureContext) {
            updateStatus('La ubicación requiere HTTPS (o localhost) y un navegador compatible.');
            return;
        }
        gpsButton.disabled = true;
        updateStatus('El navegador pedirá tu autorización. No se comparte nada sin ella.');
        navigator.geolocation.getCurrentPosition(
            position => {
                state.gps = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy
                };
                updateStatus('Ubicación autorizada. Se enviará un aviso adicional a Discord.');
                gpsButton.disabled = false;
                requestUpdate(true);
            },
            error => {
                updateStatus(error.code === 1 ? 'Has rechazado compartir tu ubicación.'
                    : 'No se ha podido obtener tu ubicación.');
                gpsButton.disabled = false;
            },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
    });

    document.addEventListener('click', event => {
        if (!state.analytics || (notice && notice.contains(event.target))) return;
        const item = event.target.closest?.('a, button');
        if (!item) return;
        const label = (item.textContent || item.getAttribute('aria-label') || item.tagName)
            .replace(/\s+/g, ' ').trim().slice(0, 42);
        state.clickCount++;
        state.clicks.push(label || 'Elemento sin título');
        if (state.clicks.length > 40) state.clicks.shift();
    });

    window.addEventListener('scroll', () => {
        if (!state.analytics) return;
        const total = Math.max(1, document.documentElement.scrollHeight - innerHeight);
        const pct = Math.min(100, Math.round(window.scrollY / total * 100));
        if (pct > state.maxScroll) state.maxScroll = pct;
    }, { passive: true });

    // No se registran movimientos de ratón, pulsaciones de teclado ni datos de formularios.
    function beforeLeave() {
        if (!state.sent) void sendInitial(true);
        if (state.analytics) void sendAnalyticsSupplement(true);
        if (state.gps) void sendGpsSupplement(true);
    }
    window.addEventListener('pagehide', beforeLeave);

    // El envío no depende del contador; los proveedores de IP tienen plazo corto.
    // Si las peticiones tardan, a los 4 s se manda el aviso con los datos disponibles.
    const ipTask = getIpAndLocation();
    void getVisitCount();
    void Promise.race([ipTask, new Promise(resolve => setTimeout(resolve, 4000))])
        .then(() => sendInitial())
        .catch(error => console.warn('No se pudo preparar el aviso:', error));
})();
