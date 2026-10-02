/* global module, self */
// Rapportage (specs/022-rapportage) : agrégation PURE, sans DOM. Chargé tel quel par la page
// (window.FamoRapport, beheer/rapportage.html) et par les tests Node (require("../assets/rapport.js")).
//
// Règles (inchangées depuis l'ancienne vue Beheer → Rapportage) :
//   - date d'une facture = « Facturée le » (jour à Bruxelles), sinon leverdatum, sinon besteldatum ;
//   - chaque creditnota est déduite à SA date (sinon celle de la facture) ;
//   - omzet = Total HTVA des factures − montants des creditnota's ;
//   - btw par taux avec FamoVat (assets/vat.js) : taux figés de la facture, sinon taux du produit, sinon standard ;
//     facture sans ligne chiffrée = total au taux du régime (0 %) ou standard ;
//   - les commandes test sont déjà retirées par le serveur (api/rapportage.js, lib/testorders.js).
// Les fonctions du navigateur sont passées en « deps » (une seule définition) :
//   { parseLines: K.parseLines, isoDay: K.isoDay, vat: FamoVat, catLabel: K.cat, familyOf: K.familyKey, today }.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FamoRapport = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const MAAND_KORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const r2 = (n) => { const v = Number(n) || 0; const s = v < 0 ? -1 : 1; return s * Math.round(Math.abs(v) * 100 + 1e-6) / 100; };
  const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
  const pad = (n) => String(n).padStart(2, "0");
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m : 1–12
  const isIso = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || "")); return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= lastDay(Number(m[1]), Number(m[2])); };
  const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
  // Décale de n mois en gardant le jour (borné à la fin du mois : 31/03 − 1 mois = 28/02).
  const addMonths = (iso, n) => { const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1 + n, d = Number(iso.slice(8, 10)); const Y = y + Math.floor(m / 12), M = ((m % 12) + 12) % 12 + 1; return Y + "-" + pad(M) + "-" + pad(Math.min(d, lastDay(Y, M))); };
  const isMonthStart = (iso) => iso.slice(8) === "01";
  const isMonthEnd = (iso) => Number(iso.slice(8)) === lastDay(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));
  const fmt = (iso) => iso ? iso.slice(8) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "";
  const maandNaam = (key, kort) => { const m = Number(String(key).slice(5, 7)) - 1; return (kort ? MAAND_KORT : MAANDEN)[m] + " " + String(key).slice(0, 4); };

  /* ---------- périodes ---------- */
  // État (paramètres d'URL) → { kind, van, tot, key, label }. Valeur illisible → période en cours du même type
  // (vrij illisible → année en cours).
  function periode(s, today) {
    const st = s || {}, t = isIso(today) ? today : new Date().toISOString().slice(0, 10);
    const Y = Number(t.slice(0, 4)), M = Number(t.slice(5, 7));
    const kind = ["jaar", "kwartaal", "maand", "vrij"].includes(st.periode) ? st.periode : "jaar";
    if (kind === "kwartaal") {
      const m = /^(\d{4})-Q([1-4])$/.exec(String(st.kwartaal || "")), y = m ? Number(m[1]) : Y, q = m ? Number(m[2]) : Math.ceil(M / 3);
      return { kind, van: y + "-" + pad(q * 3 - 2) + "-01", tot: y + "-" + pad(q * 3) + "-" + pad(lastDay(y, q * 3)), key: y + "-Q" + q, label: "K" + q + " " + y };
    }
    if (kind === "maand") {
      const m = /^(\d{4})-(\d{2})$/.exec(String(st.maand || "")), ok = m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
      const y = ok ? Number(m[1]) : Y, mm = ok ? Number(m[2]) : M, key = y + "-" + pad(mm);
      return { kind, van: key + "-01", tot: key + "-" + pad(lastDay(y, mm)), key, label: maandNaam(key) };
    }
    if (kind === "vrij" && isIso(st.van) && isIso(st.tot) && st.van <= st.tot) return { kind, van: st.van, tot: st.tot, key: st.van + "_" + st.tot, label: fmt(st.van) + " – " + fmt(st.tot) };
    const y = kind === "jaar" && /^\d{4}$/.test(String(st.jaar || "")) ? Number(st.jaar) : Y;
    return { kind: "jaar", van: y + "-01-01", tot: y + "-12-31", key: String(y), label: String(y) };
  }
  // Période de comparaison : « vorige » (défaut) = même nombre de mois entiers juste avant, sinon même nombre de
  // jours ; « jaar » = mêmes dates un an plus tôt (29/02 → 28/02) ; « geen » = aucune.
  function vergelijk(p, cmp) {
    if (!p || cmp === "geen") return null;
    if (cmp === "jaar") return { kind: "jaar", van: addMonths(p.van, -12), tot: addMonths(p.tot, -12), label: "zelfde periode vorig jaar" };
    let van, tot = addDays(p.van, -1);
    if (isMonthStart(p.van) && isMonthEnd(p.tot)) {
      const n = (Number(p.tot.slice(0, 4)) - Number(p.van.slice(0, 4))) * 12 + Number(p.tot.slice(5, 7)) - Number(p.van.slice(5, 7)) + 1;
      van = addMonths(p.van, -n);
    } else van = addDays(p.van, -(daysBetween(p.van, p.tot) + 1));
    return { kind: "vorige", van, tot, label: "vorige periode (" + fmt(van) + " – " + fmt(tot) + ")" };
  }
  // Mois couverts (« AAAA-MM ») de van à tot inclus.
  function maanden(van, tot) {
    const out = []; let k = van.slice(0, 7); const end = tot.slice(0, 7);
    for (let i = 0; k <= end && i < 600; i++) { out.push(k); k = addMonths(k + "-01", 1).slice(0, 7); }
    return out;
  }

  /* ---------- données ---------- */
  const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();
  const words = (q) => norm(q).split(/\s+/).filter(Boolean);
  function prepare(data, deps) {
    const d = data || {}, isoDay = deps.isoDay, parse = deps.parseLines, vat = deps.vat;
    const catOf = new Map((d.producten || []).map((p) => [norm(p.nom), p]));
    const catLabel = deps.catLabel || ((v) => String(v || "").trim() || "Algemeen");
    const famOf = deps.familyOf || ((n) => norm(n).split(/\s+/)[0] || "");
    const stdRate = vat.validRate((d.config || {}).btwTarief, vat.DEFAULT_RATE);
    const btwPer = d.btwPerProduct || {};
    const lineInfo = (l) => {
      const key = norm(l.name), p = catOf.get(key);
      return { name: l.name, key, unit: l.unit || (p && p.unit) || "", qty: Number(l.qty) || 0, price: l.price, cat: p ? catLabel(p.cat) : "Niet in catalogus", fam: famOf(l.name) || key };
    };
    const orders = (d.orders || []).map((o) => {
      const dag = o.factureeLe ? isoDay(o.factureeLe) : (o.dateLiv || o.date || "");
      const lines = parse(o.lignes).map(lineInfo);
      const cns = (o.creditnotas || []).map((n) => ({ nummer: n.nummer || "", montant: Number(n.montant) || 0, dag: isoDay(n.le || o.factureeLe || ""), lines: parse(n.lignes).map(lineInfo) }));
      const hay = norm([o.ref, o.factuurnummer, o.client, o.lignes].concat(cns.map((n) => n.nummer)).join(" "));
      return { o, dag, lines, cns, hay };
    });
    return { orders, stdRate, btwPer, termijn: Number((d.config || {}).betaaltermijnDagen) > 0 ? Number((d.config || {}).betaaltermijnDagen) : 14, klanten: d.klanten || [], vat, catLabel };
  }
  // Filtres : de commande (klant, betaling, regime, q) et de ligne (categorie, familie, product).
  function scope(f) {
    const st = f || {}, q = words(st.q);
    const lineFilter = !!(st.categorie || st.familie || st.product);
    const orderOk = (x) => (!st.klant || x.o.clientId === st.klant)
      && (!st.betaling || (st.betaling === "betaald" ? x.o.paiement === "Payé" : x.o.paiement !== "Payé"))
      && (!st.regime || (x.o.btwRegime || "Normal") === st.regime)
      && q.every((w) => x.hay.includes(w));
    const lineOk = (l) => (!st.categorie || l.cat === st.categorie) && (!st.familie || l.fam === st.familie) && (!st.product || l.key === norm(st.product));
    return { lineFilter, orderOk, lineOk };
  }
  const lineAmount = (l) => (l.price == null ? 0 : r2((Number(l.qty) || 0) * Number(l.price)));
  // Faits de la période : factures (+) et creditnota's (−), avec les lignes qui comptent.
  function faits(ctx, sc, van, tot) {
    const out = [];
    ctx.orders.forEach((x) => {
      if (!sc.orderOk(x)) return;
      if (x.o.statut === "Facturée" && x.dag && x.dag >= van && x.dag <= tot) {
        const lines = sc.lineFilter ? x.lines.filter(sc.lineOk) : x.lines;
        if (!sc.lineFilter || lines.length) out.push({ type: "factuur", x, dag: x.dag, nummer: x.o.factuurnummer || x.o.ref, lines, sign: 1, bedrag: sc.lineFilter ? r2(lines.reduce((s, l) => s + lineAmount(l), 0)) : r2(Number(x.o.total) || 0) });
      }
      x.cns.forEach((n) => {
        if (!n.dag || n.dag < van || n.dag > tot) return;
        const lines = sc.lineFilter ? n.lines.filter(sc.lineOk) : n.lines;
        if (sc.lineFilter && !lines.length) return;
        out.push({ type: "creditnota", x, dag: n.dag, nummer: n.nummer, lines, sign: -1, bedrag: -(sc.lineFilter ? r2(lines.reduce((s, l) => s + lineAmount(l), 0)) : r2(n.montant)) });
      });
    });
    return out;
  }
  // TVA d'un fait : même règle que les documents (FamoVat.totals par facture ou note, signe −1 pour une note).
  function btwOf(ctx, f) {
    const vat = ctx.vat, o = f.x.o, map = o.btwFrozen || ctx.btwPer;
    const priced = f.lines.filter((l) => l.price != null).map((l) => ({ name: l.name, qty: l.qty, price: l.price }));
    if (priced.length) return vat.totals(priced, (n) => vat.rateFrom(map, n, ctx.stdRate), f.sign).groups;
    const r0 = vat.regime(o.btwRegime).zero ? 0 : ctx.stdRate, base = f.bedrag;
    return [{ rate: r0, base, tva: r2(base * r0 / 100) }];
  }
  function kpiOf(ctx, list) {
    const fact = list.filter((f) => f.type === "factuur"), cn = list.filter((f) => f.type === "creditnota");
    const bruto = r2(fact.reduce((s, f) => s + f.bedrag, 0)), credit = r2(-cn.reduce((s, f) => s + f.bedrag, 0));
    let btw = 0; list.forEach((f) => btwOf(ctx, f).forEach((g) => { btw += g.tva; }));
    return { omzet: r2(bruto - credit), bruto, credit, facturen: fact.length, creditnotas: cn.length, gemiddeld: fact.length ? r2(bruto / fact.length) : 0, klanten: new Set(fact.map((f) => f.x.o.clientId || f.x.o.client)).size, btw: r2(btw) };
  }
  const share = (rows, total) => rows.map((r) => Object.assign(r, { aandeel: total ? r.omzet / total * 100 : 0 }));
  const deltaOf = (a, b) => (b == null ? null : { abs: r2(a - b), pct: b ? Math.round((a - b) / Math.abs(b) * 1000) / 10 : null });

  /* ---------- rapport ---------- */
  function rapport(data, state, deps) {
    const st = state || {}, ctx = prepare(data, deps), sc = scope(st), today = deps.today || new Date().toISOString().slice(0, 10);
    const p = periode(st, today), cmp = vergelijk(p, st.vergelijk), jaar = vergelijk(p, "jaar");
    const cur = faits(ctx, sc, p.van, p.tot);
    const kpi = kpiOf(ctx, cur), kpiVorig = cmp ? kpiOf(ctx, faits(ctx, sc, cmp.van, cmp.tot)) : null;
    // Openstaand : factures non payées de TOUTES les années (comme avant), mêmes filtres de commande ; avec un filtre
    // de ligne, seulement les factures qui contiennent une telle ligne (montant entier : c'est ce qui est dû).
    const inclOf = (x, lines, sign, bedrag) => { const groups = btwOf(ctx, { x, lines, sign, bedrag }); return r2(groups.reduce((s, g) => s + g.base + g.tva, 0)); };
    const open = ctx.orders.filter((x) => x.o.statut === "Facturée" && x.o.paiement !== "Payé" && sc.orderOk(x) && (!sc.lineFilter || x.lines.some(sc.lineOk)))
      .map((x) => { const vervalt = x.dag ? addDays(x.dag, ctx.termijn) : ""; return { id: x.o.id, type: "factuur", nummer: x.o.factuurnummer || x.o.ref, ref: x.o.ref, dag: x.dag, client: x.o.client, clientId: x.o.clientId, bedrag: r2(Number(x.o.total) || 0), incl: inclOf(x, x.lines, 1, r2(Number(x.o.total) || 0)), paiement: x.o.paiement, vervalt, telaat: !!vervalt && vervalt < today }; });
    kpi.openstaand = r2(open.reduce((s, r) => s + r.bedrag, 0)); kpi.openN = open.length; kpi.vervallenN = open.filter((r) => r.telaat).length;
    const delta = {}; ["omzet", "facturen", "gemiddeld", "klanten", "btw", "credit"].forEach((k) => { delta[k] = kpiVorig ? deltaOf(kpi[k], kpiVorig[k]) : null; });
    // Mois (zéros compris) + même mois un an plus tôt.
    const prevYear = faits(ctx, sc, jaar.van, jaar.tot);
    const mm = new Map(maanden(p.van, p.tot).map((k) => [k, { key: k, label: maandNaam(k), kort: maandNaam(k, true), n: 0, omzet: 0, vorigJaar: 0 }]));
    cur.forEach((f) => { const g = mm.get(f.dag.slice(0, 7)); if (!g) return; g.omzet = r2(g.omzet + f.bedrag); if (f.type === "factuur") g.n++; });
    prevYear.forEach((f) => { const k = addMonths(f.dag.slice(0, 7) + "-01", 12).slice(0, 7), g = mm.get(k); if (g) g.vorigJaar = r2(g.vorigJaar + f.bedrag); });
    // Klanten.
    const km = new Map();
    cur.forEach((f) => { const id = f.x.o.clientId || f.x.o.client, g = km.get(id) || { id: f.x.o.clientId, naam: f.x.o.client || "—", n: 0, omzet: 0 }; g.omzet = r2(g.omzet + f.bedrag); if (f.type === "factuur") g.n++; km.set(id, g); });
    // Producten, categorieën, families (lignes ; notes en moins).
    const pm = new Map(), cm = new Map(), fm = new Map();
    const add = (m, key, naam, amount) => { const g = m.get(key) || { key, naam, omzet: 0 }; g.omzet = r2(g.omzet + amount); m.set(key, g); };
    cur.forEach((f) => f.lines.forEach((l) => {
      const g = pm.get(l.key) || { key: l.key, naam: l.name, unit: l.unit, cat: l.cat, fam: l.fam, qty: 0, omzet: 0, noPrice: 0, n: 0 };
      const a = f.sign * lineAmount(l);
      g.qty = r3(g.qty + f.sign * l.qty); g.omzet = r2(g.omzet + a); if (l.price == null) g.noPrice++; if (f.type === "factuur") g.n++;
      pm.set(l.key, g); add(cm, l.cat, l.cat, a); add(fm, l.fam, l.fam.charAt(0).toUpperCase() + l.fam.slice(1), a);
    }));
    const byOmzet = (a, b) => b.omzet - a.omzet || String(a.naam).localeCompare(String(b.naam), "nl");
    // Btw per tarief.
    const vm = new Map();
    cur.forEach((f) => btwOf(ctx, f).forEach((g) => { const v = vm.get(g.rate) || { rate: g.rate, base: 0, tva: 0 }; v.base = r2(v.base + g.base); v.tva = r2(v.tva + g.tva); vm.set(g.rate, v); }));
    // Factures et notes de la période (liste).
    const facturen = cur.map((f) => ({ id: f.x.o.id, type: f.type, nummer: f.nummer, ref: f.x.o.ref, dag: f.dag, client: f.x.o.client, clientId: f.x.o.clientId, bedrag: f.bedrag, incl: inclOf(f.x, f.lines, f.sign, f.bedrag), paiement: f.x.o.paiement })).sort((a, b) => b.dag.localeCompare(a.dag));
    // Options des filtres (toutes les données, pas seulement la période).
    const prodOpts = new Map(), regimes = new Set(), catSet = new Set(), famSet = new Map();
    ctx.orders.forEach((x) => { regimes.add(x.o.btwRegime || "Normal"); x.lines.forEach((l) => { if (!prodOpts.has(l.key)) prodOpts.set(l.key, { key: l.key, naam: l.name }); catSet.add(l.cat); famSet.set(l.fam, l.fam.charAt(0).toUpperCase() + l.fam.slice(1)); }); });
    const known = new Set(ctx.orders.map((x) => x.o.clientId));
    const nl = (a, b) => String(a).localeCompare(String(b), "nl", { numeric: true });
    return {
      periode: p, vergelijking: cmp, vorigJaar: jaar, kpi, kpiVorig, delta,
      maanden: Array.from(mm.values()),
      klanten: share(Array.from(km.values()).sort(byOmzet), kpi.omzet),
      producten: share(Array.from(pm.values()).sort(byOmzet), kpi.omzet),
      categorieen: share(Array.from(cm.values()).sort(byOmzet), kpi.omzet),
      families: share(Array.from(fm.values()).sort(byOmzet), kpi.omzet),
      btw: Array.from(vm.values()).sort((a, b) => a.rate - b.rate).map((v) => Object.assign(v, { incl: r2(v.base + v.tva) })),
      facturen, open: open.sort((a, b) => a.dag.localeCompare(b.dag)),
      opties: {
        klanten: ctx.klanten.filter((k) => known.has(k.id)).map((k) => ({ id: k.id, naam: k.nom })).sort((a, b) => nl(a.naam, b.naam)),
        producten: Array.from(prodOpts.values()).sort((a, b) => nl(a.naam, b.naam)),
        categorieen: Array.from(catSet).sort(nl), families: Array.from(famSet, ([key, naam]) => ({ key, naam })).sort((a, b) => nl(a.naam, b.naam)),
        regimes: Array.from(regimes).sort(nl)
      }
    };
  }

  /* ---------- tri ---------- */
  const COLL = typeof Intl !== "undefined" && Intl.Collator ? new Intl.Collator("nl", { numeric: true, sensitivity: "base" }) : null;
  // Copie triée : nombres comme nombres, textes en ordre naturel (8/12 avant 16/20), vides en dernier dans les deux sens.
  function sortRows(rows, key, dir) {
    const m = dir === "desc" ? -1 : 1, empty = (v) => v == null || v === "" || (typeof v === "number" && !Number.isFinite(v));
    return (rows || []).slice().sort((a, b) => {
      const x = a[key], y = b[key];
      if (empty(x) || empty(y)) return empty(x) && empty(y) ? 0 : empty(x) ? 1 : -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * m;
      return (COLL ? COLL.compare(String(x), String(y)) : String(x).localeCompare(String(y))) * m;
    });
  }

  /* ---------- CSV (Excel nl-BE : ; et virgule décimale, comme les exports existants) ---------- */
  // Une cellule qui commence par = + - @ (formule) reçoit une apostrophe ; un nombre pur (-12,50) reste un nombre.
  const csvCell = (v) => { let s = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = "'" + s; return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csvNum = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? "" : r2(v).toFixed(2).replace(".", ","));
  const csvQty = (v) => (v == null || !Number.isFinite(Number(v)) ? "" : String(r3(v)).replace(".", ","));
  const csv = (rows) => "﻿" + (rows || []).map((r) => r.map(csvCell).join(";")).join("\r\n");

  return { periode, vergelijk, maanden, rapport, sortRows, csv, csvCell, csvNum, csvQty, maandNaam, fmt, addDays, MAANDEN };
});
