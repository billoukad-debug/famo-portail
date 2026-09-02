/* Famo Kade — gedeelde hulpjes voor de drie apps. Geen framework, geen build. */
(function () {
  "use strict";
  const K = {};

  // ---- API ----------------------------------------------------------------------
  K.api = async function (path, opts) {
    const o = opts || {};
    const init = { method: o.method || (o.body ? "POST" : "GET"), credentials: "same-origin", headers: { "X-Requested-With": "famo-kade" } };
    if (o.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(o.body); }
    let res, data;
    try { res = await fetch("/api/" + path, init); } catch (e) { throw K.err("Geen verbinding. Controleer uw internet en probeer opnieuw.", 0); }
    const text = await res.text();
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { error: "Onverwacht antwoord van de server." }; }
    if (!res.ok) {
      if (res.status === 503 && data.notConfigured) K.showSetup(data.missing || []);
      throw K.err(data.error || ("Fout " + res.status), res.status, data);
    }
    return data;
  };
  K.err = function (message, status, data) { const e = new Error(message); e.status = status; e.data = data; return e; };

  // ---- Opmaak -------------------------------------------------------------------
  K.esc = function (v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); };
  K.num = function (n, d) {
    const x = Number(n) || 0;
    const [i, f] = Math.abs(x).toFixed(d).split(".");
    return (x < 0 ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (f ? "," + f : "");
  };
  K.eur = function (cents) { return "€ " + K.num((Number(cents) || 0) / 100, 2); };
  K.qty = function (q) { const n = Number(q) || 0; return Number.isInteger(n) ? String(n) : K.num(n, 3).replace(/0+$/, "").replace(/,$/, ""); };
  const DAYS = ["", "ma", "di", "wo", "do", "vr", "za", "zo"], DAYS_L = ["", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
  const MONTHS = ["", "jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"], MONTHS_L = ["", "januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  K.weekday = function (iso) { const d = new Date(iso + "T12:00:00Z").getUTCDay(); return d === 0 ? 7 : d; };
  K.dateShort = function (iso) { if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—"; const [y, m, d] = iso.slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
  K.dateNl = function (iso, long) { if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—"; const s = iso.slice(0, 10); const [y, m, d] = s.split("-").map(Number); const wd = K.weekday(s); return (long ? DAYS_L[wd] : DAYS[wd]) + " " + d + " " + (long ? MONTHS_L[m] : MONTHS[m]) + (long ? " " + y : ""); };
  K.dateTime = function (ts) { if (!ts) return "—"; const d = new Date(ts); if (isNaN(d)) return String(ts); const p = new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d); return p.replace(", ", " om ").replace(" ", " ").replace(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/, "$1/$2/$3 om $4:$5"); };
  K.time = function (ts) { if (!ts) return ""; const d = new Date(ts); if (isNaN(d)) return ""; return new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit" }).format(d); };
  K.todayISO = function () { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); return p; };
  K.addDays = function (iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  K.relDay = function (iso) { const t = K.todayISO(); if (iso === t) return "Vandaag"; if (iso === K.addDays(t, 1)) return "Morgen"; if (iso === K.addDays(t, -1)) return "Gisteren"; return K.dateNl(iso); };
  K.unit = function (u, q) { const m = { kg: "kg", "pièce": "stuk", piece: "stuk", caisse: "doos", stuk: "stuk", doos: "doos" }; const l = m[String(u || "").toLowerCase()] || u || ""; if (Number(q) === 1 || !q) return l; if (l === "stuk") return "stuks"; if (l === "doos") return "dozen"; return l; };
  K.mapsUrl = function (address) { return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(String(address || "").replace(/\n/g, ", ")); };
  K.plural = function (n, one, many) { return n + " " + (Number(n) === 1 ? one : many); };
  K.inputNum = function (cents) { return (Number(cents || 0) / 100).toFixed(2).replace(".", ","); };
  K.parseNum = function (str) { const s = String(str == null ? "" : str).trim().replace(/\s|€/g, ""); if (!s) return NaN; const norm = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s; return Number(norm); };
  K.chip = function (key, label) { return '<span class="chip chip-' + K.esc(key) + '">' + K.esc(label) + "</span>"; };
  K.timeline = function (idx) {
    const steps = ["Ontvangen", "Klaar", "Onderweg", "Geleverd"];
    return '<div class="timeline">' + steps.map((s, i) => '<div class="step ' + (i < idx ? "done" : i === idx ? "now" : "") + '">' + s + "</div>").join("") + "</div>";
  };

  // ---- DOM --------------------------------------------------------------------------
  K.$ = function (sel, root) { return (root || document).querySelector(sel); };
  K.$$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };
  K.el = function (html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  K.on = function (root, event, sel, fn) { root.addEventListener(event, (e) => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); }); };
  K.debounce = function (fn, ms) { let t; return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(null, a), ms || 200); }; };
  K.busy = async function (btn, fn) {
    if (!btn) return fn();
    btn.classList.add("busy"); btn.disabled = true;
    try { return await fn(); } finally { btn.classList.remove("busy"); btn.disabled = false; }
  };
  K.icon = function (name) {
    const I = {
      cart: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.5L21 8H7"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
      list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="4" cy="18" r="1.2"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
      box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
      truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
      phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
      check: '<path d="m5 12 5 5L20 7"/>',
      x: '<path d="M6 6l12 12M18 6 6 18"/>',
      print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
      back: '<path d="M15 5l-7 7 7 7"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      home: '<path d="M3 11 12 3l9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
      refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
      mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
      doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>',
      warn: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (I[name] || "") + "</svg>";
  };

  // ---- Meldingen ------------------------------------------------------------------
  K.toast = function (msg, kind, ms) {
    let box = K.$(".toasts");
    if (!box) { box = K.el('<div class="toasts" aria-live="polite"></div>'); document.body.appendChild(box); }
    const t = K.el('<div class="toast ' + (kind || "") + '">' + K.esc(msg) + "</div>");
    box.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); }, ms || (kind === "bad" ? 5000 : 2800));
  };

  // ---- Bladen (sheet) ---------------------------------------------------------------
  const sheets = [];
  K.sheet = function (opts) {
    const o = opts || {};
    const back = K.el('<div class="sheet-back' + (o.center ? " center" : "") + '" role="dialog" aria-modal="true"><div class="sheet' + (o.wide ? " wide" : "") + '">' +
      '<div class="sheet-head"><h2>' + K.esc(o.title || "") + '</h2><button class="iconbtn" data-close aria-label="Sluiten">' + K.icon("x") + "</button></div>" +
      '<div class="sheet-body"></div>' + (o.footer !== false ? '<div class="sheet-foot"></div>' : "") + "</div></div>");
    const body = K.$(".sheet-body", back), foot = K.$(".sheet-foot", back);
    if (typeof o.body === "string") body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    if (foot) { if (typeof o.footer === "string") foot.innerHTML = o.footer; else if (o.footer) foot.appendChild(o.footer); else foot.remove(); }
    const close = () => { back.remove(); sheets.splice(sheets.indexOf(api), 1); if (o.onClose) o.onClose(); document.body.style.overflow = sheets.length ? "hidden" : ""; };
    back.addEventListener("click", (e) => { if (e.target === back || e.target.closest("[data-close]")) close(); });
    const esc = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); } };
    document.addEventListener("keydown", esc);
    document.body.appendChild(back);
    document.body.style.overflow = "hidden";
    const api = { el: back, body, foot, close };
    sheets.push(api);
    const first = K.$("input,select,textarea,button:not([data-close])", body);
    if (first && o.focus !== false) setTimeout(() => first.focus(), 50);
    return api;
  };
  K.confirm = function (o) {
    return new Promise((resolve) => {
      const s = K.sheet({
        title: o.title || "Bent u zeker?", center: true,
        body: '<p>' + K.esc(o.text || "") + "</p>",
        footer: '<div class="row" style="justify-content:flex-end"><button class="btn btn-outline" data-no>' + K.esc(o.no || "Annuleren") + '</button><button class="btn ' + (o.danger ? "btn-danger" : "btn-accent") + '" data-yes>' + K.esc(o.yes || "Bevestigen") + "</button></div>",
        onClose: () => resolve(false)
      });
      K.$("[data-no]", s.el).onclick = () => s.close();
      K.$("[data-yes]", s.el).onclick = () => { const c = s.close; s.close = () => {}; c(); resolve(true); };
    });
  };
  K.prompt = function (o) {
    return new Promise((resolve) => {
      const s = K.sheet({
        title: o.title || "", center: true,
        body: '<div class="field"><label>' + K.esc(o.label || "") + '</label><' + (o.multiline ? 'textarea class="textarea"' : 'input class="input" type="' + (o.type || "text") + '"') + ' data-v placeholder="' + K.esc(o.placeholder || "") + '">' + (o.multiline ? K.esc(o.value || "") : "") + (o.multiline ? "</textarea>" : "") + "</div>" + (o.help ? '<div class="help" style="margin-top:6px">' + K.esc(o.help) + "</div>" : ""),
        footer: '<div class="row" style="justify-content:flex-end"><button class="btn btn-outline" data-no>Annuleren</button><button class="btn btn-accent" data-yes>' + K.esc(o.yes || "Bevestigen") + "</button></div>",
        onClose: () => resolve(null)
      });
      const inp = K.$("[data-v]", s.el);
      if (!o.multiline && o.value) inp.value = o.value;
      K.$("[data-no]", s.el).onclick = () => s.close();
      const ok = () => { const v = inp.value; const c = s.close; s.close = () => {}; c(); resolve(v); };
      K.$("[data-yes]", s.el).onclick = ok;
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !o.multiline) ok(); });
    });
  };

  // ---- Opslag (best-effort) ------------------------------------------------------------
  K.store = {
    get(k, d) { try { const v = localStorage.getItem("kade:" + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem("kade:" + k, JSON.stringify(v)); } catch (_) { /* privémodus */ } },
    del(k) { try { localStorage.removeItem("kade:" + k); } catch (_) { /* niets */ } }
  };
  K.qs = function () { const o = {}; new URLSearchParams(location.search).forEach((v, k) => { o[k] = v; }); return o; };

  // ---- Niet geconfigureerd ------------------------------------------------------------
  K.showSetup = function (missing) {
    if (K.$(".setup")) return;
    const m = (missing || []).map((k) => "<li><code>" + K.esc(k) + "</code></li>").join("");
    document.body.innerHTML = '<div class="main"><div class="setup card"><h1>Portaal nog niet geconfigureerd</h1>' +
      '<p class="muted">Het portaal draait, maar de geheime sleutels ontbreken nog op Vercel. Niets wordt getoond tot ze ingesteld zijn.</p>' +
      '<h3>Ontbrekende omgevingsvariabelen</h3><ul>' + m + "</ul>" +
      '<h3>Zo lost u dit op (2 minuten)</h3><ol class="steps"><li>Open <b>vercel.com</b> → project <b>famo-portail</b> → Settings → Environment Variables.</li><li>Kopieer de waarden van <code>AIRTABLE_TOKEN</code>, <code>ADMIN_CODE</code>, <code>STAFF_CODE</code>, <code>RESEND_API_KEY</code> (en <code>MAIL_FROM</code> als die er staat).</li><li>Open het project van dit portaal → Settings → Environment Variables → voeg dezelfde namen en waarden toe (Production).</li><li>Deployments → laatste deployment → <b>Redeploy</b>. Daarna werkt alles meteen.</li></ol>' +
      '<hr style="border:0;border-top:1px solid var(--line);margin:16px 0"><p class="small muted"><b>FR</b> — Le portail est déployé mais les clés secrètes manquent sur Vercel. Copiez les variables ci-dessus depuis le projet <b>famo-portail</b> vers ce projet (Settings → Environment Variables), puis <b>Redeploy</b>.</p></div></div>';
  };

  window.K = K;
})();
