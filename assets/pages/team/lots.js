// Loten & traceerbaarheid (audit C-13 ; règl. CE 178/2002 art. 18, règl. UE 1379/2013 art. 35).
// Een stap terug : leverancier en ontvangst van elk lot. Een stap vooruit : bij het klaarzetten wordt
// het lot per artikel gekozen (Artikelen valideren) ; « Wie kreeg dit lot? » geeft bij een terugroeping
// in één klik de klanten, leverdagen en contactgegevens.
(async function () {
  if (!(await K.requireStaff())) return;
  const page = K.shell({ portal: "beheer" });
  let lots = [], methodes = [], all = false, q = "";
  async function load() { const d = await K.api("/api/lots" + (all ? "?all=1" : "")); lots = d.lots || []; methodes = d.methodes || []; }
  const row = l => '<tr><td class="mono"><b>' + K.esc(l.lotnummer) + '</b>' + (l.actief ? "" : ' <span class="tag">inactief</span>') + '</td><td>' + K.esc(l.produit) + (l.wetenschappelijkeNaam ? '<div class="quiet fs-12"><i>' + K.esc(l.wetenschappelijkeNaam) + '</i></div>' : "") + '</td><td>' + K.esc(l.leverancier || "—") + '</td><td class="mono">' + K.esc(l.ontvangenOp ? K.date(l.ontvangenOp) : "—") + '</td><td>' + K.esc([l.vangstgebied, l.productiemethode, l.vistuig, l.ontdooid ? "ontdooid" : ""].filter(Boolean).join(" · ") || "—") + '</td><td class="mono">' + K.esc(l.tht ? K.date(l.tht) : "—") + '</td><td><div class="d-flex gap-6 f-wrap jc-end"><button type="button" class="btn btn-o btn-sm" data-trace="' + K.esc(l.id) + '">Wie kreeg dit lot?</button><button type="button" class="btn btn-ghost btn-sm" data-edit="' + K.esc(l.id) + '" aria-label="Lot ' + K.esc(l.lotnummer) + ' bewerken">Bewerken</button></div></td></tr>';
  function render() {
    const t = q.toLowerCase(), list = lots.filter(l => !t || (l.lotnummer + " " + l.produit + " " + l.leverancier).toLowerCase().includes(t));
    page.innerHTML = '<div class="page-h"><div><h1 class="h1">Loten &amp; traceerbaarheid</h1><p class="sub">' + lots.length + ' ' + (all ? (lots.length === 1 ? "lot" : "loten") : (lots.length === 1 ? "actief lot" : "actieve loten")) + ' · leverancier, vangstgebied en THT per lot ; bij het klaarzetten kiest u het lot per artikel</p></div><span class="spacer"></span><a class="btn btn-o btn-sm" href="/team/voorraad">Voorraad</a><button type="button" class="btn btn-p btn-sm" id="newLot">Nieuw lot</button></div>' +
      '<div class="tools"><label class="search maxw-320">' + K.icon("search") + '<input id="q" aria-label="Zoeken" placeholder="Lotnummer, product of leverancier…" value="' + K.esc(q) + '"></label><label class="d-iflex gap-8 ai-c fs-13">' + K.c.check(all, 'id="all" aria-label="Ook inactieve loten"') + 'Ook inactieve loten</label>' +
      '<span class="spacer"></span><label class="search maxw-260">' + K.icon("search") + '<input id="traceQ" aria-label="Lotnummer terugroepen" placeholder="Terugroeping: lotnummer…"></label><button type="button" class="btn btn-o btn-sm" id="traceGo">Zoek klanten</button></div>' +
      '<div class="content"><div class="grp"><div class="tblwrap"><table class="tbl"><caption class="sr-only">Loten</caption><thead><tr><th scope="col">Lot</th><th scope="col">Product</th><th scope="col">Leverancier</th><th scope="col">Ontvangen</th><th scope="col">Herkomst</th><th scope="col">THT</th><th scope="col"></th></tr></thead><tbody>' +
      (list.length ? list.map(row).join("") : '<tr><td colspan="7">' + K.c.empty(lots.length ? "Niets gevonden" : "Nog geen loten", lots.length ? "Probeer een ander woord." : "Registreer elk binnenkomend lot: leverancier, vangstgebied, THT. Bij het klaarzetten kiest u dan het lot per artikel.") + '</td></tr>') +
      '</tbody></table></div></div></div>';
    const qi = page.querySelector("#q"); qi.addEventListener("input", K.debounce(() => { q = qi.value; const pos = qi.selectionStart; render(); const n = page.querySelector("#q"); n.focus(); n.setSelectionRange(pos, pos); }, 150));
    const a = page.querySelector("#all"); a.onclick = async () => { all = !all; await load(); render(); };
    page.querySelector("#newLot").onclick = () => edit(null);
    const go = () => { const v = page.querySelector("#traceQ").value.trim(); if (v) trace(v); };
    page.querySelector("#traceGo").onclick = go;
    page.querySelector("#traceQ").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  }
  K.on(page, "click", "[data-trace]", (e, t) => trace(t.dataset.trace));
  K.on(page, "click", "[data-edit]", (e, t) => edit(lots.find(l => l.id === t.dataset.edit)));
  async function trace(key) {
    let d; try { d = await K.api("/api/lots?trace=" + encodeURIComponent(key)); } catch (err) { K.toast(err.message, { kind: "err" }); return; }
    const l = d.lot, rows = d.leveringen || [];
    const csv = [["Lot", "Product", "Klant", "Telefoon", "E-mail", "Levering", "Bestelling", "Status", "Lijn"]].concat(rows.map(r => [l.lotnummer, r.artikel, r.klant, r.telefoon, r.email, K.isoDay(r.leverdatum), r.ref, r.statut, r.lijn]));
    const p = K.panel({ title: "Lot " + l.lotnummer + " · " + l.produit, sub: rows.length + " levering" + (rows.length === 1 ? "" : "en") + " · leverancier " + (l.leverancier || "—") + (l.ontvangenOp ? " · ontvangen " + K.date(l.ontvangenOp) : ""), body:
      (rows.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th scope="col">Klant</th><th scope="col">Contact</th><th scope="col">Levering</th><th scope="col">Bestelling</th></tr></thead><tbody>' + rows.map(r => '<tr><td><b>' + K.esc(r.klant) + '</b><div class="quiet fs-12">' + K.esc(r.lijn) + '</div></td><td>' + K.esc([r.telefoon, r.email].filter(Boolean).join(" · ") || "—") + '</td><td class="mono">' + K.esc(r.leverdatum ? K.date(K.isoDay(r.leverdatum)) : "—") + '</td><td class="mono"><a href="/team/bestelling?id=' + encodeURIComponent(r.id) + '">' + K.esc(r.ref) + '</a></td></tr>').join("") + '</tbody></table></div>' : K.c.empty("Nog niet geleverd", "Geen enkele bestelling bevat dit lot.")),
      footer: rows.length ? '<button type="button" class="btn btn-o" id="traceCsv">Lijst als CSV</button>' : "" });
    const b = p.el.querySelector("#traceCsv"); if (b) b.onclick = () => S.csvDownload(csv, "terugroeping-lot-" + String(l.lotnummer).replace(/[^\w.-]+/g, "-") + ".csv");
  }
  function edit(l) {
    const v = Object.assign({ lotnummer: "", produit: "", leverancier: "", ontvangenOp: K.today(), wetenschappelijkeNaam: "", vangstgebied: "", vistuig: "", productiemethode: "", ontdooid: false, tht: "", hoeveelheid: "", actief: true, nota: "" }, l || {});
    const f = (label, id, val, extra) => K.c.field(label, K.c.input(id, Object.assign({ value: val == null ? "" : val }, extra || {})), { id: "f_" + id });
    const prods = Array.from(new Set(lots.map(x => x.produit).filter(Boolean))).sort();
    const p = K.panel({ title: l ? "Lot " + l.lotnummer : "Nieuw lot", sub: "Etiket van de leverancier overnemen (verordening 1379/2013, art. 35)", body:
      '<div class="grid-2">' + f("Lotnummer", "lotnummer", v.lotnummer) + f("Product (zoals in de catalogus)", "produit", v.produit, { attrs: ' list="prodList"' }) + '</div><datalist id="prodList">' + prods.map(x => '<option value="' + K.esc(x) + '">').join("") + '</datalist>' +
      '<div class="grid-2">' + f("Leverancier", "leverancier", v.leverancier) + f("Ontvangen op", "ontvangenOp", v.ontvangenOp, { type: "date" }) + '</div>' +
      '<div class="grid-2">' + f("Wetenschappelijke naam", "wetenschappelijkeNaam", v.wetenschappelijkeNaam, { placeholder: "bv. Solea solea" }) + f("Vangstgebied (FAO) of land van kweek", "vangstgebied", v.vangstgebied, { placeholder: "bv. FAO 27 IV Noordzee" }) + '</div>' +
      '<div class="grid-2">' + K.c.field("Productiemethode", '<select class="input" id="productiemethode"><option value="">—</option>' + methodes.map(m => '<option' + (m === v.productiemethode ? " selected" : "") + '>' + K.esc(m) + '</option>').join("") + '</select>', { id: "f_productiemethode" }) + f("Vistuig", "vistuig", v.vistuig, { placeholder: "bv. boomkorren" }) + '</div>' +
      '<div class="grid-2">' + f("THT / uiterste consumptiedatum", "tht", v.tht, { type: "date" }) + f("Hoeveelheid (optioneel)", "hoeveelheid", v.hoeveelheid, { attrs: ' inputmode="decimal"' }) + '</div>' +
      // Prix d'achat (H-05) : beheerder seul ; sert à la marge et à la valeur du stock (Beheer → Rapportage).
      (K.staff.isAdmin() ? f("Aankoopprijs per eenheid, excl. btw (optioneel)", "aankoopprijs", v.aankoopprijs == null ? "" : String(v.aankoopprijs).replace(".", ","), { attrs: ' inputmode="decimal"' }) : "") +
      '<label class="row-10 fs-13">' + K.c.check(!!v.ontdooid, 'id="ontdooid" aria-label="Ontdooid"') + 'Ontdooid (vermelding verplicht)</label>' +
      '<label class="row-10 fs-13">' + K.c.check(v.actief !== false, 'id="actief" aria-label="Actief"') + 'Actief (kiesbaar bij het klaarzetten)</label>' +
      f("Nota", "nota", v.nota) + '<div id="lErr"></div>',
      footer: '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="lSave">Opslaan</button>' });
    ["ontdooid", "actief"].forEach(id => { const c = p.el.querySelector("#" + id); c.onclick = () => K.setOn(c, !c.classList.contains("on")); });
    // Nieuw lot van een bekend product : herkomst van het vorige lot overnemen (zelfde leverancier/soort).
    const pi = p.el.querySelector("#produit"); if (!l) pi.addEventListener("change", () => { const prev = lots.find(x => x.produit.toLowerCase() === pi.value.trim().toLowerCase()); if (!prev) return; ["leverancier", "wetenschappelijkeNaam", "vangstgebied", "vistuig"].forEach(k => { const i = p.el.querySelector("#" + k); if (!i.value) i.value = prev[k] || ""; }); const m = p.el.querySelector("#productiemethode"); if (!m.value) m.value = prev.productiemethode || ""; });
    p.el.querySelector("[data-cancel]").onclick = p.close;
    p.el.querySelector("#lSave").onclick = async () => {
      const val = id => p.el.querySelector("#" + id).value.trim(), on = id => p.el.querySelector("#" + id).classList.contains("on");
      const body = { id: l ? l.id : undefined, lotnummer: val("lotnummer"), produit: val("produit"), leverancier: val("leverancier"), ontvangenOp: val("ontvangenOp"), wetenschappelijkeNaam: val("wetenschappelijkeNaam"), vangstgebied: val("vangstgebied"), vistuig: val("vistuig"), productiemethode: val("productiemethode"), tht: val("tht"), hoeveelheid: val("hoeveelheid"), ontdooid: on("ontdooid"), actief: on("actief"), nota: val("nota") };
      if (p.el.querySelector("#aankoopprijs")) body.aankoopprijs = val("aankoopprijs");
      const b = p.el.querySelector("#lSave"); K.busy(b, true, "Opslaan…");
      try { await K.api("/api/lots", { json: body }); p.close(); K.toast("Lot " + body.lotnummer + " opgeslagen"); await load(); render(); }
      catch (err) { p.el.querySelector("#lErr").innerHTML = K.c.error(err.message); K.busy(b, false); }
    };
  }
  page.innerHTML = '<div class="page-h"><h1 class="h1">Loten &amp; traceerbaarheid</h1></div><div class="content">' + K.c.skeleton(3) + '</div>';
  try { await load(); render(); } catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content pt-20">' + K.c.error(err.message) + '</div>'; }
})();
