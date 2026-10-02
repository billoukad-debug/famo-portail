"use strict";
// Beheer · Systeemstatus → « Testperiode afsluiten » (specs/021-testgegevens-opruimen) — actions de
// api/onboarding.js. Garde A-10 et session beheerder restent dans le point d'entrée ; ces actions écrivent
// elles-mêmes leur ligne de journal (comptes et plages, jamais de donnée personnelle) ; l'aperçu n'écrit rien.
//
//   testVoorbeeld   {voor?, behalve?, behoudKlanten?} → comptes, sans aucune écriture
//   testArchiveren  {voor?, behalve?, behoudKlanten?, verwacht} → Test + Test gemarkeerd op (réversible)
//   testTerugzetten {refs?}                          → retire la marque
//   testVerwijderen {confirm: "VERWIJDER TESTS", verwacht} → supprime les commandes archivées comme test,
//                   leurs fichiers et leurs mouvements de stock ; Stock jamais écrit ; back-up fraîche exigée
//   testNummering   {series: ["FA-AAAA"…], confirm: "HERSTART NUMMERING"} → compteur remis à 0 si plus
//                   aucun document numéroté de la série n'existe (test compris) ; back-up fraîche exigée
// « behoudKlanten » : ids de clients (fiches existantes) dont TOUTES les commandes sont vraies et restent
// hors du périmètre ; l'aperçu renvoie « kandidaten » (clients du périmètre, cochés ou non) pour les cases.
// Le périmètre est toujours recalculé ici (date de création < voor, moins « behalve » et les clients gardés) : le navigateur
// n'envoie jamais de liste d'ids ; « verwacht » (le nombre montré par l'aperçu) doit concorder.
const { at, atAll, atBatch, __auth, __journal, __bill, clean, getConfigRecord } = require("./common");
const __test = require("../testorders");
const __cn = require("../creditnota");
const __rev = require("../revision");
const ds = require("../datastore");

const ACTIONS = ["testVoorbeeld", "testArchiveren", "testTerugzetten", "testVerwijderen", "testNummering"];
const CONFIRM_PURGE = "VERWIJDER TESTS";
const CONFIRM_NUM = "HERSTART NUMMERING";
const BACKUP_MAX_MS = 30 * 60000;
const MOVES = "Mouvements de stock";
const BON = new Set(["Prête", "Sortie en livraison", "Facturée"]);
const natural = (a, b) => String(a).localeCompare(String(b), "nl", { numeric: true });

const sqlStore = () => (ds.state.backend !== "airtable" && ds.state.store ? ds.state.store : null);
const refOf = (r) => String((r.fields || {})["Référence"] || "");
const createdOf = (r) => r.createdTime || ((r.fields || {})["Date"] ? r.fields["Date"] + "T00:00:00.000Z" : "");
const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const range = (list) => !list.length ? "—" : list.length === 1 ? list[0] : list[0] + " … " + list[list.length - 1] + " (" + list.length + ")";

function parseVoor(v) {
  if (v === undefined || v === null || v === "") return { iso: new Date().toISOString() };
  const t = Date.parse(String(v).slice(0, 40));
  if (!Number.isFinite(t)) return { error: "Ongeldige datum en tijd." };
  if (t > Date.now() + 60000) return { error: "Kies een moment in het verleden (of nu): toekomstige bestellingen kunnen geen test zijn." };
  return { iso: new Date(t).toISOString() };
}
const clientOf = (r) => ((r.fields || {})["Client"] || [])[0] || "";
const klantList = (v) => (Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && /^rec[A-Za-z0-9]{14}$/.test(x)).slice(0, 200);
const refList = (v) => (Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/)).map((x) => clean(x, 40)).filter(Boolean).slice(0, 200);

// Tout ce qu'il faut pour compter : commandes, mouvements de stock, clients, fichiers, journal (SQL seulement).
async function load() {
  const [cmd, mv, cl] = await Promise.all([atAll("Commandes"), atAll(encodeURIComponent(MOVES)), atAll("Clients")]);
  if (cmd.error) throw new Error("Commandes onleesbaar: " + (cmd.error.message || cmd.error.type));
  if (mv.error) throw new Error("Voorraadbewegingen onleesbaar: " + (mv.error.message || mv.error.type));
  const all = cmd.records || [], st = sqlStore();
  const files = st && st.filesOfRecords ? await st.filesOfRecords(all.map((r) => r.id)) : [];
  const journal = st ? (await st.list(__journal.TABLE)).filter((j) => (j.fields || {}).Object === "Commandes") : null;
  const names = new Map(((cl && cl.records) || []).map((r) => [r.id, String(r.fields["Nom"] || "")]));
  return { all, moves: mv.records || [], files, journal, names };
}

// Mouvements de stock liés : référence d'une commande visée, jamais une référence que porte aussi une commande gardée.
function linkedMoves(targets, ctx) {
  const ids = new Set(targets.map((r) => r.id));
  const kept = new Set(ctx.all.filter((r) => !ids.has(r.id)).map(refOf).filter(Boolean));
  const refs = new Set(targets.map(refOf).filter((x) => x && !kept.has(x)));
  return ctx.moves.filter((m) => refs.has(String((m.fields || {})["Référence commande"] || "")));
}
// Fichiers : pièces jointes des champs + fichiers famo_files rattachés à la commande (orphelins compris).
function filesOf(targets, ctx) {
  const ids = new Set(targets.map((r) => r.id)), out = new Set();
  targets.forEach((r) => Object.values(r.fields || {}).forEach((v) => { if (Array.isArray(v)) v.forEach((a) => { if (a && typeof a === "object" && typeof a.id === "string" && ("url" in a || "filename" in a)) out.add(a.id); }); }));
  ctx.files.forEach((f) => { if (ids.has(f.recordId)) out.add(f.id); });
  return out;
}

function countsOf(recs, ctx) {
  const refs = recs.map(refOf).filter(Boolean).sort(natural), ids = new Set(recs.map((r) => r.id));
  const perStatus = {}, perClient = new Map();
  recs.forEach((r) => {
    const s = r.fields["Statut"] || "Reçue"; perStatus[s] = (perStatus[s] || 0) + 1;
    const c = (r.fields["Client"] || [])[0] || ""; perClient.set(c, (perClient.get(c) || 0) + 1);
  });
  return {
    bestellingen: recs.length, perStatus,
    referenties: refs.length ? { eerste: refs[0], laatste: refs[refs.length - 1] } : null, refs: refs.slice(0, 500),
    facturen: recs.map((r) => r.fields["Factuurnummer"]).filter(Boolean).sort(natural),
    creditnotas: recs.flatMap((r) => __cn.list(r.fields).map((n) => n.nummer)).filter(Boolean).sort(natural),
    leveringsbonnen: recs.filter((r) => BON.has(r.fields["Statut"])).length,
    bestanden: filesOf(recs, ctx).size,
    voorraadbewegingen: linkedMoves(recs, ctx).length,
    klanten: Array.from(perClient, ([id, n]) => ({ naam: ctx.names.get(id) || (id ? "(onbekende klant)" : "(geen klant)"), bestellingen: n })).sort((a, b) => b.bestellingen - a.bestellingen || a.naam.localeCompare(b.naam, "nl")),
    journaal: ctx.journal ? ctx.journal.filter((j) => ids.has(j.fields.Record)).length : null
  };
}

// Séries de l'année (Bruxelles) : documents encore numérotés, test ou non, et valeur du compteur.
async function nummering(all) {
  const year = __auth.brusselsYear(), st = sqlStore(), out = [];
  for (const pfx of ["FA", "CN", "CMD"]) {
    const serie = pfx + "-" + year, re = new RegExp("^" + pfx + "-" + year + "-\\d+$");
    let test = 0, echt = 0;
    all.forEach((r) => {
      const f = r.fields || {};
      const nrs = pfx === "FA" ? [f["Factuurnummer"]] : pfx === "CN" ? __cn.list(f).map((n) => n.nummer) : [f["Référence"]];
      const n = nrs.filter((x) => re.test(String(x || ""))).length;
      if (__test.isTest(f)) test += n; else echt += n;
    });
    let teller = null;
    if (st) { const c = await st.get(__bill.COUNTERS, __bill.counterId(serie)); teller = c ? Number(c.fields.Waarde) || 0 : 0; }
    const reden = echt ? echt + " document(en) in " + serie + " die niet als test gearchiveerd zijn: de nummering loopt verder."
      : test ? test + " testbestelling(en) met een nummer in " + serie + ": eerst definitief verwijderen."
      : teller ? "" : "Niets te herstarten: de volgende is al " + serie + "-0001.";
    out.push({ serie, test, echt, teller, magHerstarten: !echt && !test, nodig: !echt && !test && !!teller, reden });
  }
  return out;
}

async function backupState() {
  const st = sqlStore();
  if (!st) return { serverCheck: false, laatste: null, vers: false };
  const last = (await st.snapshots("export"))[0] || null;
  const age = last ? Date.now() - Date.parse(last.createdTime) : Infinity;
  return { serverCheck: true, laatste: last ? last.createdTime : null, vers: age >= 0 && age <= BACKUP_MAX_MS, maxMinuten: BACKUP_MAX_MS / 60000 };
}
async function needBackup(res) {
  const b = await backupState();
  if (!b.serverCheck || b.vers) return false;
  res.status(409).json({ error: "Maak eerst een back-up (knop « Back-up maken »): de laatste is " + (b.laatste ? "ouder dan 30 minuten." : "er niet."), needBackup: true });
  return true;
}

const log = (req, actie, referentie, wijzigingen, reden) => __journal.log({ wie: __auth.actorOf(req), rol: __auth.roleOf(req), actie, object: "Commandes", record: "", referentie: String(referentie || "").slice(0, 120), wijzigingen, reden: reden || "" });
const scopeReden = (voor, behalve, klanten) => "aangemaakt vóór " + voor + (behalve.length ? "; behalve " + behalve.slice(0, 10).join(", ") + (behalve.length > 10 ? " …" : "") : "") +
  (klanten ? "; behalve " + klanten + (klanten === 1 ? " klant" : " klanten") + " (echte bestellingen)" : "");
const summaryRows = (c) => [
  { veld: "Bestellingen", voor: "", na: String(c.bestellingen) },
  { veld: "Facturen (FA)", voor: "", na: range(c.facturen) },
  { veld: "Creditnota's (CN)", voor: "", na: range(c.creditnotas) },
  { veld: "Voorraadbewegingen", voor: "", na: String(c.voorraadbewegingen) },
  { veld: "Bestanden", voor: "", na: String(c.bestanden) }
];

async function run({ req, res, body, action }) {
  // ---- Voorbeeld : lecture seule ----
  if (action === "testVoorbeeld" || action === "testArchiveren") {
    const v = parseVoor(body.voor);
    if (v.error) return res.status(400).json({ error: v.error });
    const behalve = refList(body.behalve), skip = new Set(behalve);
    const ctx = await load();
    const tests = ctx.all.filter((r) => __test.isTest(r.fields));
    const candidates = ctx.all.filter((r) => !__test.isTest(r.fields) && createdOf(r) < v.iso && !skip.has(refOf(r)));
    const behoud = klantList(body.behoudKlanten).filter((id, i, l) => ctx.names.has(id) && l.indexOf(id) === i), keep = new Set(behoud);
    const scope = candidates.filter((r) => !keep.has(clientOf(r)));
    if (action === "testVoorbeeld") {
      const conf = await getConfigRecord();
      const per = new Map();
      candidates.forEach((r) => { const c = clientOf(r); if (c) per.set(c, (per.get(c) || 0) + 1); });
      const kandidaten = Array.from(per, ([id, n]) => ({ id, naam: ctx.names.get(id) || "(onbekende klant)", bestellingen: n, behouden: keep.has(id) }))
        .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
      return res.status(200).json({ ok: true, voor: v.iso, behalve, behoudKlanten: behoud, kandidaten, scope: countsOf(scope, ctx), buiten: { bestellingen: ctx.all.length - tests.length - scope.length },
        gearchiveerd: countsOf(tests, ctx), nummering: await nummering(ctx.all), backup: await backupState(),
        facturatie: __bill.modeOf(conf && !conf.error ? conf.fields : {}), bevestig: { verwijderen: CONFIRM_PURGE, nummering: CONFIRM_NUM } });
    }
    if (!scope.length) return res.status(400).json({ error: "Geen bestellingen in deze selectie." });
    if (Number(body.verwacht) !== scope.length) return res.status(409).json({ error: "De selectie is veranderd sinds het voorbeeld (nu " + scope.length + " bestellingen). Maak opnieuw een voorbeeld.", nu: scope.length });
    const now = new Date().toISOString(), c = countsOf(scope, ctx);
    const w = await atBatch("Commandes", "PATCH", scope.map((r) => ({ id: r.id, fields: { [__test.FIELD]: true, [__test.AT]: now } })), false);
    await __rev.bump();
    if (w.error) {
      await log(req, "Testperiode: gearchiveerd (onvolledig)", "", [{ veld: "Bestellingen", voor: "", na: w.done.length + " van " + scope.length }], scopeReden(v.iso, behalve, behoud.length));
      return res.status(500).json({ error: "Archiveren onvolledig: " + w.done.length + " van " + scope.length + " gemarkeerd. Probeer opnieuw (een nieuw voorbeeld toont wat overblijft).", gearchiveerd: w.done.length });
    }
    await log(req, "Testperiode: gearchiveerd", c.referenties ? c.referenties.eerste + " … " + c.referenties.laatste : "", summaryRows(c), scopeReden(v.iso, behalve, behoud.length));
    return res.status(200).json({ ok: true, gearchiveerd: scope.length, referenties: c.referenties });
  }

  if (action === "testTerugzetten") {
    const only = new Set(refList(body.refs));
    const ctx = await load();
    const tests = ctx.all.filter((r) => __test.isTest(r.fields) && (!only.size || only.has(refOf(r))));
    if (!tests.length) return res.status(400).json({ error: "Geen gearchiveerde testbestellingen" + (only.size ? " met deze referentie." : ".") });
    const w = await atBatch("Commandes", "PATCH", tests.map((r) => ({ id: r.id, fields: { [__test.FIELD]: false, [__test.AT]: null } })), false);
    await __rev.bump();
    const c = countsOf(tests, ctx);
    await log(req, "Testperiode: teruggezet" + (w.error ? " (onvolledig)" : ""), c.referenties ? c.referenties.eerste + " … " + c.referenties.laatste : "", [{ veld: "Bestellingen", voor: "", na: (w.error ? w.done.length + " van " : "") + tests.length }]);
    if (w.error) return res.status(500).json({ error: "Terugzetten onvolledig: " + w.done.length + " van " + tests.length + ". Probeer opnieuw.", teruggezet: w.done.length });
    return res.status(200).json({ ok: true, teruggezet: tests.length });
  }

  if (action === "testVerwijderen") {
    if (String(body.confirm || "").trim() !== CONFIRM_PURGE) return res.status(400).json({ error: "Typ " + CONFIRM_PURGE + " om te bevestigen." });
    const ctx = await load();
    const tests = ctx.all.filter((r) => __test.isTest(r.fields));
    if (!tests.length) return res.status(400).json({ error: "Er zijn geen gearchiveerde testbestellingen. Archiveer ze eerst (stap 2)." });
    if (await needBackup(res)) return;
    if (Number(body.verwacht) !== tests.length) return res.status(409).json({ error: "Het aantal testbestellingen is veranderd (nu " + tests.length + "). Maak opnieuw een voorbeeld.", nu: tests.length });
    const c = countsOf(tests, ctx), st = sqlStore();
    const moves = linkedMoves(tests, ctx);
    const byRecord = new Map();
    ctx.files.forEach((f) => { if (!byRecord.has(f.recordId)) byRecord.set(f.recordId, []); byRecord.get(f.recordId).push(f.id); });
    const done = { bestellingen: 0, voorraadbewegingen: 0, bestanden: c.bestanden };
    let fout = "";
    // Mouvements d'abord : après un échec partiel, une commande test encore présente retrouve les siens.
    for (const part of chunks(moves.map((m) => m.id), 10)) {
      const d = await at(encodeURIComponent(MOVES) + "?" + part.map((id) => "records[]=" + encodeURIComponent(id)).join("&"), { method: "DELETE" });
      if (d.error) { fout = "voorraadbewegingen"; break; }
      done.voorraadbewegingen += part.length;
    }
    if (!fout) {
      for (const part of chunks(tests.map((r) => r.id), 10)) {
        const d = await at("Commandes?" + part.map((id) => "records[]=" + encodeURIComponent(id)).join("&"), { method: "DELETE" });
        if (d.error) { fout = "bestellingen"; break; }
        done.bestellingen += part.length;
        // Fichiers restants de ces commandes (orphelins ; les pièces jointes citées sont déjà effacées par le moteur).
        const left = part.flatMap((id) => byRecord.get(id) || []);
        if (st && left.length) await st.removeFiles(left);
      }
    }
    await __rev.bump();
    const rows = summaryRows(c).map((x) => ({ veld: x.veld, voor: x.na, na: "verwijderd" }));
    rows.push({ veld: "Voorraad (aantallen)", voor: "", na: "ongewijzigd" });
    if (fout) rows.push({ veld: "Onvolledig", voor: "", na: done.bestellingen + " van " + tests.length + " bestellingen, " + done.voorraadbewegingen + " van " + moves.length + " bewegingen" });
    await log(req, "Testperiode: definitief verwijderd" + (fout ? " (onvolledig)" : ""), c.referenties ? c.referenties.eerste + " … " + c.referenties.laatste : "", rows, "Back-up vooraf gemaakt; auditregels blijven bewaard");
    if (fout) return res.status(500).json({ error: "Verwijderen onvolledig (" + fout + "): " + done.bestellingen + " van " + tests.length + " bestellingen weg. Probeer opnieuw: wat weg is, blijft weg.", verwijderd: done });
    return res.status(200).json({ ok: true, verwijderd: done, nummering: await nummering(ctx.all.filter((r) => !__test.isTest(r.fields))) });
  }

  if (action === "testNummering") {
    if (String(body.confirm || "").trim() !== CONFIRM_NUM) return res.status(400).json({ error: "Typ " + CONFIRM_NUM + " om te bevestigen." });
    const year = __auth.brusselsYear();
    const series = Array.from(new Set((Array.isArray(body.series) ? body.series : []).map((s) => String(s || "").trim())));
    if (!series.length || series.some((s) => !["FA-" + year, "CN-" + year, "CMD-" + year].includes(s))) return res.status(400).json({ error: "Onbekende reeks: enkel FA-, CN- of CMD-" + year + "." });
    const ctx = await load();
    const status = await nummering(ctx.all);
    for (const s of series) { const n = status.find((x) => x.serie === s); if (!n.magHerstarten) return res.status(409).json({ error: s + ": " + n.reden }); }
    if (await needBackup(res)) return;
    const st = sqlStore(), herstart = [];
    for (const s of series) {
      if (!st) { herstart.push({ serie: s, voor: null, na: 0 }); continue; } // Airtable : max + 1 sur les données restantes
      const cur = await st.get(__bill.COUNTERS, __bill.counterId(s));
      if (!cur || !(Number(cur.fields.Waarde) > 0)) { herstart.push({ serie: s, voor: cur ? Number(cur.fields.Waarde) || 0 : null, na: 0 }); continue; }
      // Écriture conditionnelle : un numéro réservé entre-temps fait échouer, rien n'est remis.
      if (!(await st.update(__bill.COUNTERS, cur.id, Object.assign({}, cur.fields, { Waarde: 0 }), cur.version))) return res.status(409).json({ error: s + ": er werd net een nummer toegekend. Maak opnieuw een voorbeeld." });
      herstart.push({ serie: s, voor: Number(cur.fields.Waarde) || 0, na: 0 });
    }
    await log(req, "Testperiode: nummering herstart", series.join(", "), herstart.map((h) => ({ veld: h.serie, voor: h.voor == null ? "" : String(h.voor), na: "0 (volgende: " + h.serie + "-0001)" })), "Enkel toegestaan: geen enkel document van deze reeks bestaat nog; navragen bij de boekhouder");
    return res.status(200).json({ ok: true, herstart });
  }
  return res.status(400).json({ error: "Onbekende actie" });
}

module.exports = { ACTIONS, run, CONFIRM_PURGE, CONFIRM_NUM };
