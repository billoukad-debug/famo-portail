/* Carte commande commune à Bestellingen et Magazijn — une seule structure :
   leverdatum en gros (le préparateur travaille par date), référence discrète, client,
   articles en liste compacte (quantité + unité, nom, sans prix ni pavé), total.
   Styles : .m-card-* dans staff.css. Chaque page ajoute autour ce qui lui est propre
   (lien vers la fiche, sélection, boutons d'action). */
(function (global) {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function eur(n) { return "€ " + Number(n || 0).toFixed(2).replace(".", ","); }
  function brusselsDay(offset) {
    const fmt = d => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(d);
    const base = new Date(fmt(new Date()) + "T12:00:00");
    base.setDate(base.getDate() + (offset || 0));
    return fmt(base);
  }
  function deliveryDay(o) { return String((o && o.dateLiv) || "").slice(0, 10); }
  function isLate(o) { const day = deliveryDay(o); return Boolean(day && day < brusselsDay() && o.statut !== "Facturée"); }
  function dateLabel(o) {
    const day = deliveryDay(o);
    if (!day) return "Geen leverdatum";
    if (day === brusselsDay()) return "Vandaag";
    if (day === brusselsDay(1)) return "Morgen";
    const d = new Date(day + "T00:00:00");
    return Number.isNaN(+d) ? day : d.toLocaleDateString("nl-BE", { day: "2-digit", month: "2-digit" });
  }
  function lines(txt) {
    const nl = global.famoNL;
    return String(txt || "").split("\n").filter(Boolean).map(raw => {
      const clean = raw.replace(/\s*\[€[^\]]+\]/g, "");
      const line = nl ? nl.lines(clean) : clean;
      const m = line.match(/^(.*?)\s*[×x]\s*([\d.,]+)\s*(.*)$/);
      if (!m) return { qty: "", name: line.trim() };
      const comment = (m[3].match(/\((.*)\)/) || [])[1] || "";
      const unit = m[3].replace(/\(.*\)/, "").trim();
      return { qty: m[2] + (unit ? " " + unit : ""), name: m[1].trim() + (comment ? " (" + comment + ")" : "") };
    });
  }
  function html(o, opts) {
    opts = opts || {};
    const all = lines(o.lignes), max = opts.maxLines || all.length, shown = all.slice(0, max);
    return '<div class="m-card-top"><span class="m-card-date' + (isLate(o) ? " m-late" : "") + (deliveryDay(o) ? "" : " m-nodate") + '">' + esc(dateLabel(o)) + '</span><span class="m-card-ref">' + esc(o.ref) + '</span></div>' +
      '<div class="m-card-client">' + esc(o.client) + '</div>' +
      (shown.length ? '<ul class="m-card-lines">' + shown.map(l => '<li><span class="m-card-q">' + esc(l.qty) + '</span><span class="m-card-n">' + esc(l.name) + '</span></li>').join("") +
        (all.length > max ? '<li class="m-card-more">+ ' + (all.length - max) + ' meer</li>' : "") + '</ul>' : "") +
      (opts.extra || "") +
      '<div class="m-card-foot">' + (opts.foot || "") + '<span class="m-card-total">' + eur(o.total) + '</span></div>';
  }
  global.famoCard = { html, lines, dateLabel, isLate };
})(window);
