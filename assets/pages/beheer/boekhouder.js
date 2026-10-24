/* Export boekhouder (specs/034-vague-3-facturation) — beheerder seul.
   Une période → les factures et notes de crédit de la période (numéro, klant, datum, bedrag, betaald, verzending),
   l'UBL de chacune (route existante /api/export?format=ubl), le CSV récapitulatif (/api/export?format=csv) et, en clair,
   les documents dont l'UBL serait refusé (ubl.problems du serveur). Rien n'est envoyé d'ici : le beheerder télécharge,
   bezorgt aan de boekhouder, en noteert ensuite « Naar boekhouder gestuurd op … » (lib/verzending.js, journal).
   Période dans l'URL (/beheer/boekhouder?van=…&tot=…) ; par défaut le mois précédent. */
(async function () {
  if (!(await K.requireStaff({ admin: true }))) return;
  const page = K.shell({ portal: "beheer" });
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const pad = n => String(n).padStart(2, "0");
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
  const month = (y, m) => { const d = new Date(Date.UTC(y, m - 1, 1)); const yy = d.getUTCFullYear(), mm = d.getUTCMonth() + 1; return { van: yy + "-" + pad(mm) + "-01", tot: yy + "-" + pad(mm) + "-" + pad(lastDay(yy, mm)) }; };
  const today = K.today(), ty = Number(today.slice(0, 4)), tm = Number(today.slice(5, 7));
  const PRESETS = [["vorige", "Vorige maand", month(ty, tm - 1)], ["deze", "Deze maand", month(ty, tm)],
    ["kwartaal", "Vorig kwartaal", (() => { const q = Math.floor((tm - 1) / 3); const a = month(ty, q * 3 - 2), b = month(ty, q * 3); return { van: a.van, tot: b.tot }; })()],
    ["jaar", "Dit jaar", { van: ty + "-01-01", tot: ty + "-12-31" }]];
  const readState = () => { const p = new URLSearchParams(location.search), van = p.get("van") || "", tot = p.get("tot") || ""; return DAY.test(van) && DAY.test(tot) ? { van, tot } : PRESETS[0][2]; };
  let st = readState(), data = null, err = "";

  const go = s => { st = s; try { history.replaceState(null, "", location.pathname + "?van=" + s.van + "&tot=" + s.tot); } catch (e) { /* ignore */ } load(); };
  const q = () => "van=" + encodeURIComponent(st.van) + "&tot=" + encodeURIComponent(st.tot);
  async function load() {
    err = ""; data = null; draw();
    try { data = await K.api("/api/export?format=lijst&" + q()); } catch (e) { if (e.status === 401) return; err = e.message; }
    draw();
  }
  const verzTxt = e => (window.S && S.verzTxt ? S.verzTxt(e) : "");
  const isSent = d => !!(d.verzending && (d.verzending.boekhouder || d.verzending.peppol));
  function draw() {
    const docs = (data && data.documenten) || [], bad = docs.filter(d => d.problemen.length), open = docs.filter(d => !isSent(d));
    const sum = k => docs.reduce((t, d) => t + (Number(d[k]) || 0), 0);
    const preset = PRESETS.find(p => p[2].van === st.van && p[2].tot === st.tot);
    const modeNote = !data ? "" : data.facturatie === "portaal"
      ? '<p class="quiet fs-125">Facturatie: <b>het portaal</b> maakt de facturen. Bezorg de boekhouder de UBL-bestanden (Peppol) en de CSV.</p>'
      : '<p class="quiet fs-125">Facturatie: <b>de boekhouder</b> maakt de facturen; de documenten van het portaal zijn pro forma. Deze lijst en de CSV helpen hem bij het inboeken. Of hij de UBL-bestanden kan inlezen, vraagt u best eerst na.</p>';
    page.innerHTML = '<div class="page-h"><div><h1 class="h1">Export boekhouder</h1><p class="sub">Facturen en creditnota\'s per periode, om aan de boekhouder te bezorgen</p></div><span class="spacer"></span>' +
      '<a class="btn btn-ghost btn-sm" href="/beheer">' + K.icon("back") + ' Beheer</a><a class="btn btn-o btn-sm" href="/team/documenten">Documenten</a></div>' +
      '<div class="content pt-16 stack-12">' +
      '<section class="card card-b stack-12" aria-labelledby="bkPer"><h2 class="h2" id="bkPer">Periode</h2>' +
        '<div class="d-flex gap-8 f-wrap" role="group" aria-label="Snelle keuze">' + PRESETS.map(([k, l]) => '<button type="button" class="btn btn-sm ' + (preset && preset[0] === k ? "btn-p" : "btn-o") + '" data-preset="' + k + '" aria-pressed="' + (preset && preset[0] === k ? "true" : "false") + '">' + l + '</button>').join("") + '</div>' +
        '<div class="d-flex gap-12 f-wrap ai-end"><div class="field" id="fBkVan"><label for="bkVan">Van</label><input type="date" class="input" id="bkVan" value="' + K.esc(st.van) + '"></div><div class="field" id="fBkTot"><label for="bkTot">Tot en met</label><input type="date" class="input" id="bkTot" value="' + K.esc(st.tot) + '"></div><button type="button" class="btn btn-o" id="bkGo">Tonen</button></div>' +
        modeNote + '</section>' +
      (err ? K.c.error(err, true) : !data ? K.c.skeleton(3) :
        '<div class="kpis"><div class="kp"><small>Documenten</small><b>' + docs.length + '</b><em>' + K.plural(docs.filter(d => d.soort === "factuur").length, "factuur", "facturen") + ' · ' + K.plural(docs.filter(d => d.soort === "creditnota").length, "creditnota", "creditnota's") + '</em></div>' +
        '<div class="kp"><small>Totaal excl. btw</small><b class="mono">' + K.eur(sum("excl")) + '</b><em>btw ' + K.eur(sum("btw")) + '</em></div>' +
        '<div class="kp"><small>Totaal incl. btw</small><b class="mono">' + K.eur(sum("incl")) + '</b><em>creditnota\'s afgetrokken</em></div>' +
        '<div class="kp"><small>Nog niet naar de boekhouder</small><b>' + open.length + '</b><em>' + (bad.length ? K.plural(bad.length, "UBL onvolledig", "UBL onvolledig") : "alle UBL volledig") + '</em></div></div>' +
        (bad.length ? K.c.warn('<b>' + K.plural(bad.length, "document heeft", "documenten hebben") + ' een onvolledig UBL-bestand.</b> De boekhouder of Peppol zou het weigeren. Vul de ontbrekende gegevens aan (meestal het btw-nummer of het adres van de klant in Beheer → Klanten) en kijk opnieuw.<ul class="pl-18 mt-6 d-grid gap-4">' + bad.map(d => '<li><b class="mono">' + K.esc(d.nummer) + '</b> (' + K.esc(d.klant) + '): ' + K.esc(d.problemen.join("; ")) + '</li>').join("") + '</ul>') : "") +
        '<div class="card"><div class="card-h"><h2 class="h2">' + K.esc(K.date(st.van) + " – " + K.date(st.tot)) + '</h2><span class="spacer"></span>' +
          (docs.length ? '<a class="btn btn-o btn-sm" href="/api/export?format=csv&' + q() + '" download>' + K.icon("doc") + 'CSV downloaden</a>' + (docs.length > bad.length ? '<button type="button" class="btn btn-o btn-sm" id="bkUbl">' + K.icon("doc") + 'Alle UBL (' + (docs.length - bad.length) + ')</button>' : "") + (open.length ? '<button type="button" class="btn btn-p btn-sm" id="bkMark">Gestuurd vandaag (' + open.length + ')</button>' : "") : "") + '</div>' +
          (docs.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Document</th><th>Klant</th><th>Datum</th><th class="num">Incl. btw</th><th>Betaald</th><th>Boekhouder · Peppol</th><th>UBL</th></tr></thead><tbody>' +
            docs.map(d => '<tr><td><b class="mono">' + K.esc(d.nummer) + '</b><div class="quiet fs-11">' + (d.soort === "creditnota" ? "Creditnota op " + K.esc(d.factuur) : "Factuur") + ' · <a href="/team/bestelling?id=' + encodeURIComponent(d.orderId) + '">' + K.esc(d.ref) + '</a></div></td>' +
              '<td>' + K.esc(d.klant) + (d.klantBtw ? '<div class="quiet fs-11 mono">' + K.esc(d.klantBtw) + '</div>' : "") + '</td><td>' + K.esc(K.date(d.datum)) + '</td><td class="num mono">' + K.eur(d.incl) + '</td>' +
              '<td>' + (d.betaald === null ? '<span class="quiet">—</span>' : d.betaald ? '<span class="cell-st c-done">Betaald</span>' : '<span class="cell-st c-open">Openstaand</span>') + '</td>' +
              '<td><span class="fs-12">' + K.esc(verzTxt(d.verzending) || "Nog niet") + '</span> <button type="button" class="linkbtn" data-verz="' + K.esc(d.nummer) + '" aria-label="Verzending ' + K.esc(d.nummer) + ' aanpassen">Aanpassen</button></td>' +
              '<td>' + (d.problemen.length ? '<span class="tag t-danger bc-danger" title="' + K.esc(d.problemen.join("; ")) + '">Onvolledig</span>' : '<button type="button" class="btn btn-o btn-sm" data-ubl="' + K.esc(d.nummer) + '">UBL</button>') + '</td></tr>').join("") +
            '</tbody></table></div>' : '<div class="card-b">' + K.c.empty("Geen facturen in deze periode", "Kies een andere periode.") + '</div>') + '</div>' +
        '<p class="quiet fs-125">Het portaal verstuurt zelf niets naar de boekhouder of via Peppol. Na het bezorgen noteert u hier „gestuurd”: dat komt in het journaal van elke bestelling, en een verstuurde factuur kan niet meer stilletjes ongedaan gemaakt worden (enkel met een creditnota).</p>') +
      '</div>';
  }
  async function downloadUbl(d) {
    const r = await fetch(d.ubl, { credentials: "same-origin" });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(d.nummer + ": " + ((j.problems || []).join("; ") || j.error || "fout " + r.status)); }
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = (d.soort === "creditnota" ? "Creditnota-" : "Factuur-") + String(d.nummer).replace(/[^\w.-]+/g, "-") + ".xml"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  K.on(page, "click", "[data-preset]", (e, t) => { const p = PRESETS.find(x => x[0] === t.dataset.preset); if (p) go(p[2]); });
  K.on(page, "click", "#bkGo", () => {
    const van = page.querySelector("#bkVan").value, tot = page.querySelector("#bkTot").value;
    K.setErr("fBkVan", DAY.test(van) ? "" : "Kies een datum."); K.setErr("fBkTot", DAY.test(tot) ? (van && tot < van ? "Ligt vóór de begindatum." : "") : "Kies een datum.");
    if (DAY.test(van) && DAY.test(tot) && tot >= van) go({ van, tot });
  });
  K.on(page, "click", "[data-retry]", e => { e.preventDefault(); load(); });
  K.on(page, "click", "[data-ubl]", async (e, t) => { const d = (data.documenten || []).find(x => x.nummer === t.dataset.ubl); if (!d) return; K.busy(t, true, "UBL…"); try { await downloadUbl(d); } catch (er) { K.toast(er.message, { kind: "err" }); } finally { K.busy(t, false); } });
  K.on(page, "click", "#bkUbl", async (e, t) => {
    const list = (data.documenten || []).filter(d => !d.problemen.length); K.busy(t, true, "UBL…"); const fouten = [];
    for (const d of list) { try { await downloadUbl(d); } catch (er) { fouten.push(er.message); } }
    K.busy(t, false);
    if (fouten.length) K.panel({ title: "UBL: " + (list.length - fouten.length) + " klaar, " + fouten.length + " mislukt", body: '<ul class="pl-18 d-grid gap-6 fs-13">' + fouten.map(f => "<li>" + K.esc(f) + "</li>").join("") + "</ul>" });
    else K.toast(K.plural(list.length, "UBL-bestand", "UBL-bestanden") + " gedownload");
  });
  // Statut à la main, même panneau que la fiche (staff-common.js S.verzendingPanel) ; S.update recharge les commandes.
  const asOrder = d => ({ id: d.orderId, client: d.klant, ref: d.ref, verzending: { [d.nummer]: d.verzending } });
  K.on(page, "click", "[data-verz]", (e, t) => { const d = (data.documenten || []).find(x => x.nummer === t.dataset.verz); if (d) S.verzendingPanel(asOrder(d), d.nummer, load); });
  K.on(page, "click", "#bkMark", async (e, t) => {
    const list = (data.documenten || []).filter(d => !isSent(d));
    if (!(await K.confirm({ title: K.plural(list.length, "document", "documenten") + " als gestuurd noteren?", text: "Datum: vandaag (" + K.date(today) + "). Doe dit pas nadat u de CSV en de UBL-bestanden aan de boekhouder bezorgd hebt. Elke bestelling krijgt een regel in het journaal.", yes: "Noteren" }))) return;
    K.busy(t, true, "Noteren…");
    // Un document à la fois par commande (verrou serveur par commande) : séquentiel.
    const fouten = [];
    for (const d of list) { try { await K.api("/api/updateorder", { json: { id: d.orderId, verzending: { nummer: d.nummer, boekhouder: today } } }); } catch (er) { fouten.push(d.nummer + ": " + er.message); } }
    if (fouten.length) K.panel({ title: fouten.length + " niet genoteerd", body: '<ul class="pl-18 d-grid gap-6 fs-13">' + fouten.map(f => "<li>" + K.esc(f) + "</li>").join("") + "</ul>" });
    else K.toast(K.plural(list.length, "document", "documenten") + " genoteerd als gestuurd");
    load();
  });
  load();
})();
