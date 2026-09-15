/* FAMO v2 — gedeelde laag: API, sessie, helpers, componenten, navigatie.
   Eén plaats om het uiterlijk en het gedrag van de drie portalen te veranderen. */
(function (global) {
  "use strict";
  const K = {};

  /* ---------- basis ---------- */
  K.esc = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  K.eur = v => "€ " + (Number(v) || 0).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  K.num = v => String(Number(v) || 0).replace(".", ",");
  K.qty = v => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toLocaleString("nl-BE", { maximumFractionDigits: 3 }); };
  const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"], MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  K.parseDate = v => { if (!v) return null; const d = new Date(String(v).includes("T") ? v : v + "T00:00:00"); return Number.isNaN(d.getTime()) ? null : d; };
  K.isoDay = d => { const x = d instanceof Date ? d : K.parseDate(d); if (!x) return ""; const m = String(x.getMonth() + 1).padStart(2, "0"), day = String(x.getDate()).padStart(2, "0"); return x.getFullYear() + "-" + m + "-" + day; };
  K.today = () => K.isoDay(new Date());
  K.addDays = (iso, n) => { const d = K.parseDate(iso) || new Date(); d.setDate(d.getDate() + n); return K.isoDay(d); };
  K.date = v => { const d = K.parseDate(v); if (!d) return "—"; return DAYS[d.getDay()] + " " + d.getDate() + "/" + String(d.getMonth() + 1).padStart(2, "0"); };
  K.dateLong = v => { const d = K.parseDate(v); if (!d) return "—"; return DAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); };
  K.time = v => { const d = K.parseDate(v); return d ? String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") : ""; };
  K.relDay = iso => { if (!iso) return "—"; const t = K.today(); if (iso === t) return "Vandaag"; if (iso === K.addDays(t, 1)) return "Morgen"; if (iso === K.addDays(t, -1)) return "Gisteren"; return K.date(iso); };
  K.initials = name => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
  K.uid = () => Math.random().toString(36).slice(2, 9);

  /* ---------- NL (interne waarden blijven Frans in Airtable) ---------- */
  K.NL = {
    status: { "Reçue": "Ontvangen", "Prête": "Klaar", "Sortie en livraison": "Onderweg", "Facturée": "Geleverd" },
    pay: { "En attente": "Openstaand", "Payé": "Betaald" },
    unit: { "caisse": "kassa", "carton": "doos", "pièce": "stuk", "piece": "stuk", "kg": "kg" },
    move: { "Correction inventaire": "Voorraadcorrectie", "Entrée stock": "Voorraadontvangst", "Retour client": "Klantretour", "Sortie livraison": "Levering" }
  };
  K.status = v => K.NL.status[v] || v || "Ontvangen";
  K.pay = v => K.NL.pay[v] || v || "Openstaand";
  K.unit = v => K.NL.unit[String(v || "").toLowerCase()] || v || "";
  K.move = v => K.NL.move[v] || v;
  K.STATUSES = ["Reçue", "Prête", "Sortie en livraison", "Facturée"];
  K.stKey = st => ({ "Reçue": "new", "Prête": "ready", "Sortie en livraison": "road", "Facturée": "done" })[st] || "new";
  K.stChip = (st, extra) => '<span class="chip st-' + K.stKey(st) + '"><i></i>' + K.esc(extra || K.status(st)) + '</span>';
  K.stCell = (st, label) => '<span class="cell-st c-' + K.stKey(st) + '">' + K.esc(label || K.status(st)) + '</span>';
  K.payCell = p => p === "Payé" ? '<span class="cell-st c-done">Betaald</span>' : '<span class="cell-st c-open">Openstaand</span>';
  // "Zalm × 2 kg [€16.00] (opm)" -> {name, qty, unit, price, comment}
  K.parseLines = txt => String(txt || "").split("\n").map(l => l.trim()).filter(Boolean).map(raw => {
    const m = raw.match(/^(.*?)\s*[×x]\s*([\d.,]+)\s*([^\[\(]*)(.*)$/);
    if (!m) return { name: raw, qty: 0, unit: "", price: null, comment: "" };
    const tail = m[4] || "", price = tail.match(/\[€\s*([\d.,]+)\]/), comment = tail.match(/\((.*?)\)/);
    return { name: m[1].trim(), qty: parseFloat(String(m[2]).replace(",", ".")) || 0, unit: m[3].trim(), price: price ? Number(price[1].replace(",", ".")) : null, comment: comment ? comment[1] : "" };
  });
  K.formatLine = l => `${l.name} × ${K.qty(l.qty).replace(",", ".")}${l.unit ? " " + l.unit : ""}${l.price != null ? " [€" + Number(l.price).toFixed(2) + "]" : ""}${l.comment ? " (" + l.comment + ")" : ""}`;
  K.linesSummary = txt => K.parseLines(txt).map(l => K.qty(l.qty) + "× " + l.name).join(" · ");
  K.dayOrder = o => o.dateLiv || o.date || "";
  K.isLate = o => o.statut !== "Facturée" && o.dateLiv && o.dateLiv < K.today();

  /* ---------- opslag ---------- */
  K.store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* privé venster */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  K.session = {
    get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  /* ---------- API ---------- */
  const ERR = { "Code invalide": "Ongeldige personeelscode", "POST only": "Alleen POST toegestaan" };
  K.errText = m => { if (m && typeof m === "object") m = m.message || m.error || JSON.stringify(m); const raw = String(m || "").trim(); if (!raw) return "Onbekende fout"; if (ERR[raw]) return ERR[raw]; return raw.replace(/\bcaisse\b/gi, "kassa").replace(/\bpièce\b/gi, "stuk"); };
  K.api = async function (url, opts) {
    const o = Object.assign({ credentials: "include" }, opts || {});
    if (o.json !== undefined) { o.method = o.method || "POST"; o.headers = Object.assign({ "Content-Type": "application/json" }, o.headers || {}); o.body = JSON.stringify(o.json); delete o.json; }
    let r;
    try { r = await fetch(url, o); } catch (e) { const err = new Error("Geen verbinding. Controleer het netwerk en probeer opnieuw."); err.network = true; throw err; }
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && !/\/api\/(catalogue|orders|order)$/.test(url)) {
      document.dispatchEvent(new CustomEvent("famo:session-expired", { detail: { url } }));
    }
    if (!r.ok) { const err = new Error(K.errText(d.error || "Verzoek mislukt")); err.status = r.status; err.payload = d; throw err; }
    return d;
  };

  /* ---------- personeel / beheer sessie (cookie) ---------- */
  K.staff = {
    role: null,
    async login(code, want) { const d = await K.api("/api/session", { json: { code: String(code || ""), want: want === "admin" ? "admin" : "staff" } }); K.staff.role = d.role || null; return d; },
    async check() { try { const d = await K.api("/api/session"); K.staff.role = d.role || null; return true; } catch (e) { K.staff.role = null; return false; } },
    async logout() { try { await fetch("/api/session", { method: "DELETE", credentials: "include" }); } catch (e) { /* ignore */ } K.staff.role = null; },
    isAdmin() { return K.staff.role === "admin"; }
  };
  K.RETURN = "famoReturnTo";
  K.saveReturn = () => K.session.set(K.RETURN, location.pathname + location.search + location.hash);
  K.takeReturn = fb => { const v = K.session.get(K.RETURN, null); K.session.del(K.RETURN); return v && v.startsWith("/") && !v.startsWith("//") ? v : (fb || null); };

  /* ---------- klant sessie (gebruikersnaam + wachtwoord, enkel in dit tabblad) ---------- */
  K.klant = {
    KEY: "famoKlant",
    get() { return K.session.get(K.klant.KEY, null); },
    set(v) { K.session.set(K.klant.KEY, v); },
    clear() { K.session.del(K.klant.KEY); },
    creds() { const c = K.klant.get(); return c ? { user: c.user, pw: c.pw } : null; }
  };

  /* ---------- iconen (één stijl, 24-grid, stroke) ---------- */
  const I = {
    orders: '<path d="M5 4h14v16H5z"/><path d="M9 9h6M9 13h6"/>',
    box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    stock: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    bell: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 20a2 2 0 004 0"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M12 17h.01"/>',
    table: '<path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14"/>',
    board: '<path d="M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z"/>',
    cal: '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
    group: '<path d="M4 6h16M4 12h10M4 18h6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><path d="M6 14h12v7H6z"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    map: '<path d="M12 21s-6-5.5-6-11a6 6 0 0112 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    fish: '<path d="M3 12c3-4 7-6 11-6 3 0 5 2 7 6-2 4-4 6-7 6-4 0-8-2-11-6z"/><path d="M3 12l-1-4M3 12l-1 4"/><circle cx="15" cy="11" r="1"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
    pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3M13 3h6v18h-6"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 9v5M12 17h.01"/>',
    refresh: '<path d="M4 4v6h6M20 20v-6h-6"/><path d="M20 10a8 8 0 00-14-4M4 14a8 8 0 0014 4"/>'
  };
  K.icon = (name, cls) => '<svg class="ico' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + (I[name] || I.doc) + '</svg>';

  /* ---------- componenten ---------- */
  const c = {};
  c.btn = (label, opts) => { const o = opts || {}; return '<button type="button" class="btn ' + (o.kind ? "btn-" + o.kind : "btn-o") + (o.sm ? " btn-sm" : "") + (o.block ? " btn-block" : "") + (o.cls ? " " + o.cls : "") + '"' + (o.id ? ' id="' + o.id + '"' : "") + (o.attrs || "") + (o.disabled ? " disabled" : "") + '>' + (o.icon ? K.icon(o.icon) : "") + K.esc(label) + '</button>'; };
  c.field = (label, inputHtml, opts) => { const o = opts || {}; return '<div class="field"' + (o.id ? ' id="' + o.id + '"' : "") + '><label' + (o.for ? ' for="' + o.for + '"' : "") + '>' + K.esc(label) + (o.req ? ' <span style="color:var(--danger)">*</span>' : "") + '</label>' + inputHtml + (o.hint ? '<span class="quiet" style="font-size:12px">' + K.esc(o.hint) + '</span>' : "") + '<span class="err" data-err></span></div>'; };
  c.input = (id, opts) => { const o = opts || {}; return '<input class="input" id="' + id + '" type="' + (o.type || "text") + '"' + (o.value != null ? ' value="' + K.esc(o.value) + '"' : "") + (o.placeholder ? ' placeholder="' + K.esc(o.placeholder) + '"' : "") + (o.attrs || "") + '>'; };
  c.empty = (title, text, action) => '<div class="state"><div class="ic">' + K.icon("orders") + '</div><b>' + K.esc(title) + '</b>' + (text ? '<p class="sub" style="max-width:320px;white-space:normal">' + K.esc(text) + '</p>' : "") + (action || "") + '</div>';
  c.error = (text, retry) => '<div class="notice err" role="alert"><i>!</i><div><b>Er ging iets mis.</b> ' + K.esc(text) + (retry ? ' <a href="#" data-retry>Opnieuw proberen</a>' : "") + '</div></div>';
  c.warn = html => '<div class="notice warn"><i>!</i><div>' + html + '</div></div>';
  c.ok = html => '<div class="notice ok"><i>✓</i><div>' + html + '</div></div>';
  c.skeleton = n => '<div style="display:flex;flex-direction:column;gap:10px">' + Array.from({ length: n || 3 }, () => '<div class="card card-b" style="display:flex;flex-direction:column;gap:8px"><div class="sk" style="width:40%"></div><div class="sk" style="width:70%"></div><div class="sk" style="width:55%"></div></div>').join("") + '</div>';
  c.kpi = (n, label, warn) => '<span class="kpi' + (warn ? " warn" : "") + '"><b>' + K.esc(n) + '</b> ' + K.esc(label) + '</span>';
  c.avatar = name => '<span class="avatar">' + K.esc(K.initials(name)) + '</span>';
  c.check = (on, attrs) => '<button type="button" class="check' + (on ? " on" : "") + '" ' + (attrs || "") + ' aria-pressed="' + (on ? "true" : "false") + '">' + K.icon("check") + '</button>';
  c.stepper = (id, value, opts) => { const o = opts || {}; return '<div class="stepper' + (Number(value) > 0 ? " on" : "") + '" data-stepper="' + id + '"><button type="button" data-dec aria-label="Minder">−</button><input type="number" inputmode="decimal" min="0" step="' + (o.step || 1) + '" value="' + K.esc(value) + '" aria-label="Aantal"><button type="button" data-inc aria-label="Meer">+</button></div>'; };
  K.c = c;

  /* ---------- toast / dialoog / paneel ---------- */
  function toasts() { let t = document.querySelector(".toasts"); if (!t) { t = document.createElement("div"); t.className = "toasts"; t.setAttribute("aria-live", "polite"); document.body.appendChild(t); } return t; }
  K.toast = (msg, opts) => { const o = opts || {}; const el = document.createElement("div"); el.className = "toast" + (o.kind ? " " + o.kind : ""); el.innerHTML = K.esc(msg) + (o.action ? '<button type="button">' + K.esc(o.action) + '</button>' : ""); if (o.action && o.onAction) el.querySelector("button").onclick = () => { o.onAction(); el.remove(); }; toasts().appendChild(el); setTimeout(() => el.remove(), o.ms || 4500); return el; };
  K.confirm = (opts) => new Promise(resolve => {
    const o = typeof opts === "string" ? { text: opts } : (opts || {});
    const d = document.createElement("div"); d.className = "dialog"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
    d.innerHTML = '<div class="box"><b style="font-size:15px">' + K.esc(o.title || "Bevestigen") + '</b><span class="muted">' + K.esc(o.text || "") + '</span><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px"><button type="button" class="btn btn-o btn-sm" data-no>' + K.esc(o.no || "Annuleren") + '</button><button type="button" class="btn btn-sm ' + (o.danger ? "btn-danger" : "btn-p") + '" data-yes>' + K.esc(o.yes || "OK") + '</button></div></div>';
    const done = v => { d.remove(); document.removeEventListener("keydown", key); resolve(v); };
    const key = e => { if (e.key === "Escape") done(false); };
    d.querySelector("[data-no]").onclick = () => done(false); d.querySelector("[data-yes]").onclick = () => done(true); d.onclick = e => { if (e.target === d) done(false); };
    document.addEventListener("keydown", key); document.body.appendChild(d); d.querySelector("[data-yes]").focus();
  });
  K.prompt = (opts) => new Promise(resolve => {
    const o = opts || {};
    const d = document.createElement("div"); d.className = "dialog"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
    d.innerHTML = '<div class="box"><b style="font-size:15px">' + K.esc(o.title || "") + '</b>' + (o.text ? '<span class="muted">' + K.esc(o.text) + '</span>' : "") + '<input class="input" id="kPrompt" value="' + K.esc(o.value || "") + '" placeholder="' + K.esc(o.placeholder || "") + '"><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn-o btn-sm" data-no>Annuleren</button><button type="button" class="btn btn-p btn-sm" data-yes>' + K.esc(o.yes || "OK") + '</button></div></div>';
    const inp = d.querySelector("#kPrompt");
    const done = v => { d.remove(); resolve(v); };
    d.querySelector("[data-no]").onclick = () => done(null); d.querySelector("[data-yes]").onclick = () => done(inp.value); inp.addEventListener("keydown", e => { if (e.key === "Enter") done(inp.value); if (e.key === "Escape") done(null); });
    document.body.appendChild(d); inp.focus();
  });
  K.panel = (opts) => {
    const o = opts || {};
    const s = document.createElement("div"); s.className = "scrim"; s.setAttribute("role", "dialog"); s.setAttribute("aria-modal", "true");
    s.innerHTML = '<div class="panel"' + (o.width ? ' style="width:min(' + o.width + ',100%)"' : "") + '><div class="panel-h"><div><h2 class="h2">' + K.esc(o.title || "") + '</h2>' + (o.sub ? '<p class="sub">' + K.esc(o.sub) + '</p>' : "") + '</div><button type="button" class="ibtn" data-close aria-label="Sluiten">' + K.icon("x") + '</button></div><div class="panel-b">' + (o.body || "") + '</div>' + (o.footer ? '<div class="panel-f">' + o.footer + '</div>' : "") + '</div>';
    const close = () => { s.remove(); document.removeEventListener("keydown", key); document.body.style.overflow = ""; if (o.onClose) o.onClose(); };
    const key = e => { if (e.key === "Escape") close(); };
    s.querySelector("[data-close]").onclick = close; s.onclick = e => { if (e.target === s) close(); };
    document.addEventListener("keydown", key); document.body.style.overflow = "hidden"; document.body.appendChild(s);
    const first = s.querySelector("input,select,textarea,button:not([data-close])"); if (first) try { first.focus(); } catch (e) { /* ignore */ }
    return { el: s, close, body: s.querySelector(".panel-b"), footer: s.querySelector(".panel-f") };
  };
  K.bind = (root, sel, ev, fn) => (root || document).querySelectorAll(sel).forEach(el => el.addEventListener(ev, fn));
  const delegated = new WeakMap();
  K.on = (root, ev, sel, fn) => {
    const host = root || document, key = ev + ":" + sel;
    let handlers = delegated.get(host); if (!handlers) { handlers = new Map(); delegated.set(host, handlers); }
    const previous = handlers.get(key); if (previous) host.removeEventListener(ev, previous);
    const handler = e => { const t = e.target.closest(sel); if (t && host.contains(t)) fn(e, t); };
    handlers.set(key, handler); host.addEventListener(ev, handler);
  };
  K.$ = (sel, root) => (root || document).querySelector(sel);
  K.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  K.setErr = (fieldId, msg) => { const f = document.getElementById(fieldId); if (!f) return; const e = f.querySelector("[data-err]"); if (e) e.textContent = msg || ""; const i = f.querySelector(".input"); if (i) { if (msg) i.setAttribute("aria-invalid", "true"); else i.removeAttribute("aria-invalid"); } };
  K.busy = (btn, on, label) => { if (!btn) return; if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = label || "Bezig…"; } else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; } };
  K.hashParams = () => { const h = location.hash.replace(/^#\/?/, ""); const [path, q] = h.split("?"); const p = {}; new URLSearchParams(q || "").forEach((v, k) => { p[k] = v; }); return { path: path || "", params: p }; };
  K.go = (path, params) => { const q = params ? "?" + new URLSearchParams(params).toString() : ""; location.hash = "#/" + path + q; };

  /* ---------- personeel/beheer shell ---------- */
  const NAV_DAILY = [["bestellingen.html", "Bestellingen", "orders"], ["entrepot.html", "Magazijn", "box"], ["leveringen.html", "Leveringen", "truck"]];
  const NAV_ADMIN = [["invoer.html", "Invoeren", "plus"], ["documenten.html", "Documenten", "doc"], ["beheer.html", "Beheer", "settings"]];
  const NAV_STAFF_MORE = [["documenten.html", "Documenten", "doc"]];
  K.shell = function (opts) {
    const o = opts || {};
    const here = (location.pathname.split("/").pop() || "").toLowerCase();
    const admin = K.staff.isAdmin();
    const portal = o.portal || (admin ? "beheer" : "personeel");
    document.body.classList.remove("portal-klant", "portal-personeel", "portal-beheer");
    document.body.classList.add("portal-" + portal);
    const link = ([href, label, icon]) => '<a class="nav' + (here === href ? " on" : "") + '" href="/' + href + '"' + (here === href ? ' aria-current="page"' : "") + '>' + K.icon(icon) + '<span>' + label + '</span></a>';
    const more = admin ? NAV_ADMIN : NAV_STAFF_MORE;
    const side = '<aside class="side" data-famo-nav><a class="brand" href="/bestellingen.html"><span class="logo">F</span><span><b>Famo Trading</b><small>' + (admin ? "Beheer" : "Teamportaal") + '</small></span></a>' +
      '<div class="navlbl">Dagelijks</div>' + NAV_DAILY.map(link).join("") +
      '<div class="navlbl">' + (admin ? "Beheer" : "Meer") + '</div>' + more.map(link).join("") +
      (admin ? '<a class="nav' + (here === "stock.html" ? " on" : "") + '" href="/stock.html">' + K.icon("stock") + '<span>Voorraad</span></a>' : "") +
      '<div class="spacer"></div><a class="nav" href="/" style="font-size:12.5px">' + K.icon("ext") + '<span>Klantportaal</span></a>' +
      '<div class="user">' + c.avatar(admin ? "Beheerder" : "Personeel") + '<div class="utxt" style="font-size:12.5px;min-width:0"><b style="font-weight:500">' + (admin ? "Beheerder" : "Personeel") + '</b><div><a href="#" data-logout class="quiet" style="font-size:11px">Uitloggen</a></div></div></div></aside>';
    const top = '<div class="topbar"><label class="search">' + K.icon("search") + '<input id="globalSearch" placeholder="' + K.esc(o.searchPlaceholder || "Zoek bestelling, klant of artikel…") + '" autocomplete="off"></label><span class="spacer"></span>' + (o.topRight || "") + '<a class="ibtn" href="/beheer.html#status" title="Systeemstatus" aria-label="Systeemstatus">' + K.icon("help") + '</a><span class="avatar" style="width:30px;height:30px;font-size:11px">' + (admin ? "MB" : "PM") + '</span></div>';
    const app = document.getElementById("app");
    app.innerHTML = '<div class="shell">' + side + '<div class="main">' + top + '<div id="page"></div></div></div>';
    K.on(app, "click", "[data-logout]", async e => { e.preventDefault(); await K.staff.logout(); location.href = "/personeel.html"; });
    return document.getElementById("page");
  };
  // Aanmeldpagina voor personeel/beheer op een pagina zelf (inline), met terugkeer.
  K.requireStaff = async function (opts) {
    const o = opts || {};
    const ok = await K.staff.check();
    if (!ok) { K.saveReturn(); location.replace(o.admin ? "/beheer-login.html" : "/personeel.html"); return false; }
    if (o.admin && !K.staff.isAdmin()) { K.saveReturn(); location.replace("/beheer-login.html?denied=1"); return false; }
    document.addEventListener("famo:session-expired", () => { K.saveReturn(); K.toast("Sessie verlopen. Meld u opnieuw aan.", { kind: "err" }); setTimeout(() => location.replace(o.admin ? "/beheer-login.html" : "/personeel.html"), 1200); }, { once: true });
    return true;
  };
  K.klantTabs = active => {
    const tabs = [["catalogus", "Catalogus", "list"], ["bestellingen", "Bestellingen", "orders"], ["favorieten", "Favorieten", "star"], ["account", "Account", "user"]];
    return '<nav class="mtabs">' + tabs.map(([k, l, i]) => '<a class="mtab' + (active === k ? " on" : "") + '" href="#/' + k + '"' + (active === k ? ' aria-current="page"' : "") + '>' + K.icon(i) + l + '</a>').join("") + '</nav>';
  };
  global.K = K;
})(window);
