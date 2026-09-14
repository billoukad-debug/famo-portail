/* Documents depuis les cartes (Bestellingen et Magazijn) : une icône document qui ouvre le
   document (Documenten l'ouvre directement) et une icône imprimante qui imprime sans passer
   par l'aperçu. Mêmes règles que Documenten : leveringsbon dès la préparation, factuur dès
   qu'elle a un numéro ; contenu produit par documents.js (identité de l'entreprise lue une
   fois via /api/config). La fenêtre d'impression du navigateur s'affiche toujours. */
(function (global) {
  const DOCS = [
    { type: "delivery", url: "lb", tag: "LB", label: "Leveringsbon", available: o => o.statut !== "Reçue" },
    { type: "invoice", url: "facture", tag: "FA", label: "Factuur", available: o => !!o.factuurnummer }
  ];
  const ICON_DOC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14.5 3.5V8H19"/><path d="M9.5 12.5h5M9.5 16h5"/></svg>';
  const ICON_PRINT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8.5v-5h10v5"/><path d="M7 16.5H4.5v-8h15v8H17"/><path d="M7 13.5h10v7H7z"/></svg>';
  let source = () => [];
  let company = null;
  let frame = null;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function setSource(fn) { source = fn; }

  function iconsHtml(o) {
    const parts = DOCS.filter(d => d.available(o)).map(d =>
      '<span class="doc-pair">' +
        '<a class="doc-ico" href="/documenten.html?order=' + encodeURIComponent(o.id) + '&type=' + d.url + '" title="' + d.label + ' openen" aria-label="' + d.label + ' openen">' + ICON_DOC + '<span class="doc-tag">' + d.tag + '</span></a>' +
        '<button type="button" class="doc-ico" data-id="' + esc(o.id) + '" onclick="famoDocActions.print(this.dataset.id,\'' + d.type + '\')" title="' + d.label + ' afdrukken" aria-label="' + d.label + ' afdrukken">' + ICON_PRINT + '</button>' +
      '</span>');
    return parts.length ? '<span class="doc-actions">' + parts.join("") + '</span>' : "";
  }

  function notify(message) {
    if (typeof global.showNotice === "function") { global.showNotice(message, "error"); return; }
    let box = document.getElementById("docActionsNotice");
    if (!box) {
      box = document.createElement("div");
      box.id = "docActionsNotice";
      box.setAttribute("role", "alert");
      document.body.appendChild(box);
    }
    box.className = "notice error";
    box.textContent = message;
    clearTimeout(box._timer);
    box._timer = setTimeout(() => box.classList.add("hidden"), 7000);
  }

  function loadCompany() {
    if (!company) {
      company = global.famoStaff.api("/api/config")
        .then(r => r.json().catch(() => ({})).then(d => {
          if (r.ok && d.config) global.FamoDocuments.setCompany(d.config);
          else company = null;
        }))
        .catch(() => { company = null; });
    }
    return company;
  }

  async function print(id, type) {
    const order = (source() || []).find(o => o.id === id);
    const doc = DOCS.find(d => d.type === type);
    if (!order || !doc || !doc.available(order)) { notify("Document niet beschikbaar voor deze bestelling."); return false; }
    await loadCompany();
    let html;
    try { html = global.FamoDocuments.build(order, type); }
    catch (e) { notify(e && e.message ? e.message : "Document kon niet worden opgemaakt."); return false; }
    if (frame) frame.remove();
    const target = frame = document.createElement("iframe");
    target.className = "doc-print-frame";
    target.title = doc.label + " afdrukken";
    target.setAttribute("aria-hidden", "true");
    target.setAttribute("tabindex", "-1");
    return new Promise(resolve => {
      target.onload = () => {
        const w = target.contentWindow;
        if (!w || !w.document || !w.document.body || !w.document.body.innerHTML) return; // about:blank initial
        try { w.focus(); w.print(); resolve(true); }
        catch (e) { notify("Afdrukken mislukt. Probeer opnieuw."); resolve(false); }
      };
      target.srcdoc = html;
      document.body.appendChild(target);
    });
  }

  global.famoDocActions = { iconsHtml, print, setSource };
})(window);
