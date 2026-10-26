/* global module, self */
// Bestellen « x30 » (specs/036) : règles pures de l'écran Bestellen du portail client, partagées par le navigateur
// (window.FamoBestellen) et le serveur (require("../assets/bestellen.js"), lib/gewoonte.js). Testées sous Node
// (test/x30-commande.test.js). Rien ici ne lit le DOM, le réseau ou le stockage.
//   klok(rules, now)     bandeau de l'heure : prochaine livraison, temps restant, ambre, jauge (heure de Bruxelles)
//   klokTekst(k, lang)   les mots du bandeau, NL / FR
//   groep(p)             groupe métier d'un produit (Vis, Garnalen, Schaaldieren, Schelpdieren, Inktvis, Overig)
//   naam(nom)            nom en casse normale pour l'affichage (la donnée reste intacte)
//   soort(p)             plaque typographique d'espèce (sans photo)
//   rauwOk(vis)          « Rauw OK » seulement avec « bestemd om rauw te eten » ET un traitement choisi (spec 035)
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FamoBestellen = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KEYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
  const DAG = { nl: ["zo", "ma", "di", "wo", "do", "vr", "za"], fr: ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"] };
  const DAG_LANG = { nl: ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"], fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"] };
  const L = (lang) => (String(lang || "").toLowerCase() === "fr" ? "fr" : "nl");
  // Jauge : pleine jusqu'à 8 h avant l'heure limite, vide à l'heure limite ; ambre dans la dernière demi-heure.
  const JAUGE_MIN = 8 * 60, AMBER_MIN = 30;

  /** Heure murale de Bruxelles : { iso: "AAAA-MM-JJ", min: minutes depuis minuit }. */
  function brussel(now) {
    const d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    try {
      const o = {};
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(d).forEach((x) => { o[x.type] = x.value; });
      return { iso: o.year + "-" + o.month + "-" + o.day, min: Number(o.hour) * 60 + Number(o.minute) };
    } catch (e) {
      return { iso: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
    }
  }
  // Arithmétique de dates civiles (midi UTC : jamais de décalage d'heure d'été).
  const noon = (iso) => new Date(iso + "T12:00:00Z");
  function addDays(iso, n) { const d = noon(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  const dow = (iso) => noon(iso).getUTCDay();
  const dayDiff = (a, b) => Math.round((noon(b) - noon(a)) / 864e5);

  /** Règles du navigateur (publicRules : leverdagen ["ma"…]) ou du serveur (rulesFrom : dagen [1…]). */
  function norm(rules) {
    const r = rules || {};
    const dl = /^\d{1,2}:\d{2}$/.test(String(r.deadline || "").trim()) ? String(r.deadline).trim().padStart(5, "0") : "22:00";
    let dagen = Array.isArray(r.dagen) ? r.dagen.filter((i) => i >= 0 && i <= 6) : Array.isArray(r.leverdagen) ? r.leverdagen.map((k) => KEYS.indexOf(String(k).slice(0, 2))).filter((i) => i >= 0) : [];
    if (!dagen.length) dagen = [1, 2, 3, 4, 5, 6];
    const gesloten = Array.isArray(r.gesloten) ? r.gesloten : Array.isArray(r.geslotenDagen) ? r.geslotenDagen : [];
    const [h, m] = dl.split(":").map(Number);
    return { deadline: dl, cut: h * 60 + m, dagen, gesloten, levervenster: venster(r.levervenster) };
  }

  // Levervenster : emplacement prévu pour un futur réglage Configuratie (« 06:00-08:00 »). Il n'existe PAS encore :
  // lib/levering.js ne l'envoie pas, donc le bandeau n'annonce jamais d'heure de livraison (rien n'est inventé).
  function venster(v) {
    const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(String(v || "").trim());
    if (!m) return null;
    const a = Number(m[1]) * 60 + Number(m[2]), b = Number(m[3]) * 60 + Number(m[4]);
    return b > a && b < 1440 ? { van: m[1] + ":" + m[2], tot: m[3] + ":" + m[4] } : null;
  }

  /**
   * Bandeau de l'heure. Même règle que la commande (lib/levering.js, K.orderWindow) : avant l'heure limite, le
   * premier jour possible est demain, après, après-demain ; puis le premier jour de livraison qui n'est pas fermé.
   * L'heure limite qui compte est celle de la VEILLE de ce jour (on commande le samedi soir ou le dimanche avant
   * 22:00 pour le lundi). Heure de Bruxelles, quel que soit le fuseau de l'appareil.
   * → { levering, deadlineDag, deadline, minuten, amber, vulling (0..1), venster, vandaag }
   */
  function klok(rules, now) {
    const r = norm(rules), b = brussel(now);
    let d = addDays(b.iso, b.min < r.cut ? 1 : 2), i = 0;
    while ((!r.dagen.includes(dow(d)) || r.gesloten.includes(d)) && i++ < 400) d = addDays(d, 1);
    const deadlineDag = addDays(d, -1);
    const minuten = dayDiff(b.iso, deadlineDag) * 1440 + r.cut - b.min;
    return {
      levering: d, deadlineDag, deadline: r.deadline, minuten, vandaag: b.iso,
      amber: minuten <= AMBER_MIN, vulling: Math.max(0, Math.min(1, minuten / JAUGE_MIN)), venster: r.levervenster
    };
  }

  const kort = (iso, lang) => { const x = noon(iso); return DAG[L(lang)][x.getUTCDay()] + " " + x.getUTCDate() + "/" + String(x.getUTCMonth() + 1).padStart(2, "0"); };
  const uur = (hhmm, lang) => { const [h, m] = hhmm.split(":"); const n = String(Number(h)); return m === "00" ? n : n + (L(lang) === "fr" ? "h" : ":") + m; };

  /** Mots du bandeau : { rest: "Nog 1 u 12", levering: "geleverd ma 26/10", tot: "tot 22:00" | "tot zo 22:00" }. */
  function klokTekst(k, lang) {
    const fr = L(lang) === "fr", m = k.minuten;
    let rest;
    if (m < 60) rest = (fr ? "Encore " : "Nog ") + m + " min";
    else if (m < 24 * 60) rest = (fr ? "Encore " : "Nog ") + Math.floor(m / 60) + (fr ? " h " : " u ") + String(m % 60).padStart(2, "0");
    else rest = (fr ? "Commander jusqu'à " : "Bestellen tot ") + kort(k.deadlineDag, lang) + " " + k.deadline;
    let levering = (fr ? "livré " : "geleverd ") + kort(k.levering, lang);
    if (k.venster) levering += fr ? " entre " + uur(k.venster.van, lang) + " et " + uur(k.venster.tot, lang) + " h" : " tussen " + uur(k.venster.van, lang) + " en " + uur(k.venster.tot, lang) + " u";
    const tot = (fr ? "jusqu'à " : "tot ") + (k.deadlineDag === k.vandaag ? "" : kort(k.deadlineDag, lang) + " ") + k.deadline;
    return { rest, levering, tot, dag: kort(k.levering, lang) };
  }
  /** « maandag » / « lundi » : le jour de la semaine d'une date. */
  const weekdag = (iso, lang) => DAG_LANG[L(lang)][dow(iso)];

  // ---- Catalogue : groupes métier, noms, plaques, Rauw OK -------------------------------------------------------
  const fold = (s) => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Ordre d'affichage et libellés néerlandais (traduits à l'écran par K.t / K.FR).
  const GROEPEN = [["vis", "Vis"], ["garnalen", "Garnalen"], ["schaaldieren", "Schaaldieren"], ["schelpdieren", "Schelpdieren"], ["inktvis", "Inktvis"], ["overig", "Zeewier en overig"]];
  const GROEP_LABEL = Object.fromEntries(GROEPEN);
  // Le nom d'abord (la catégorie « Algemeen » contient de tout en production), puis la catégorie, puis « overig ».
  const NAAM_REGELS = [
    ["overig", /\b(veggie|vegan|vegetar|surimi|edamame|zeewier|wakame|algue|tofu|eieren|eitjes|oeufs?|saus|sauce|sesam|rijst|riz)\b/],
    ["garnalen", /(garna|crevett|scampi|vannamei|black ?tiger|gamba|prawn|shrimp)/],
    ["inktvis", /(inktvis|calamar|calamar|squid|octop|poulpe|sepia|seiche|pijlinktvis)/],
    ["schaaldieren", /(kreeft|homard|krab|crabe|langoust|kingcrab|king crab)/],
    ["schelpdieren", /(mossel|moule|oester|huitre|coquill|sint.?jakob|st.?jakob|clam|vongol|kokkel|scallop|wulk)/],
    ["vis", /(zalm|saumon|tonijn|thon|kabeljauw|cabillaud|zeebaars|\bbar\b|tong\b|sole\b|dorade|zeebrasem|schol|tarbot|griet|heek|merlu|forel|truite|makreel|maquereau|haring|hareng|poon|rog\b|raie|zeeduivel|lotte|pangasius|tilapia|wijting|hamachi|yellowtail|vis\b|poisson)/]
  ];
  const CAT_REGELS = { poisson: "vis", poissons: "vis", vis: "vis", crustaces: "schaaldieren", crustace: "schaaldieren", schaaldieren: "schaaldieren", coquillages: "schelpdieren", coquillage: "schelpdieren", schelpdieren: "schelpdieren", cephalopodes: "inktvis", inktvis: "inktvis", vegetarisch: "overig", surimi: "overig" };
  /** Groupe métier d'un produit { nom, cat } : clé de GROEPEN. */
  function groep(p) {
    const n = fold(p && p.nom), c = fold(p && p.cat).trim();
    if (CAT_REGELS[c] === "overig") return "overig";
    for (const [g, re] of NAAM_REGELS) if (re.test(n)) return g;
    return CAT_REGELS[c] || "overig";
  }

  /**
   * Casse normale pour l'affichage : un nom saisi en CAPITALES devient « Black tiger garnalen 8-12 ».
   * Les mots avec un chiffre (« U5 », « 8-12 ») et les sigles de deux lettres (« EP ») restent tels quels ; un poids collé
   * (« 1KG ») devient « 1 kg » (spec 038).
   * Un nom déjà en casse mixte n'est pas touché.
   */
  function naam(nom) {
    const s = String(nom == null ? "" : nom).replace(/\s+/g, " ").trim();
    const letters = s.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
    if (letters.length < 4 || letters !== letters.toUpperCase()) return s;
    let first = true;
    return s.split(" ").map((w) => {
      // Spec 038 : un poids collé (« 1KG », « 500G ») devient « 1 kg », « 500 g ».
      const unit = /^(\d+(?:[.,]\d+)?)(KG|G|L|CL|ML)$/i.exec(w);
      if (unit) { first = false; return unit[1] + " " + unit[2].toLowerCase(); }
      if (/\d/.test(w) || /^[A-ZÀ-Ý]{1,2}$/.test(w)) { first = false; return w; }
      const low = w.toLowerCase();
      if (first) { first = false; return low.charAt(0).toUpperCase() + low.slice(1); }
      return low;
    }).join(" ");
  }

  // Plaques : un aplat de couleur et une forme simple par espèce (CSS .x-pl-<soort>, symboles SVG dans klant.js).
  const SOORT_REGELS = [
    ["zeewier", /(zeewier|wakame|algue|edamame|veggie|vegan|vegetar)/], ["ei", /(eieren|eitjes|oeufs?\b)/],
    ["tiger", /black ?tiger/], ["garnaal", /(garna|crevett|scampi|vannamei|gamba|prawn|shrimp)/],
    ["inktvis", /(inktvis ?ring|calamar|squid ring|ringen)/], ["tube", /(inktvis|octop|poulpe|sepia|seiche)/],
    ["kreeft", /(kreeft|homard|krab|crabe|langoust|surimi)/], ["schelp", /(mossel|moule|oester|huitre|coquill|jakob|clam|vongol|kokkel)/],
    ["zalm", /(zalm|saumon|forel|truite)/], ["tonijn", /(tonijn|thon|hamachi|yellowtail)/]
  ];
  /** Espèce (plaque) d'un produit : zalm, tonijn, garnaal, tiger, inktvis, tube, kreeft, schelp, zeewier, ei, vis. */
  function soort(p) {
    const n = fold(p && p.nom) + " " + fold(p && p.vis && p.vis.wetenschappelijkeNaam);
    for (const [s, re] of SOORT_REGELS) if (re.test(n)) return s;
    return groep(p) === "overig" ? "zeewier" : "vis";
  }

  // Barèmes de congélation de la spec 035 (R853 annexe III sect. VIII ch. III partie D) : rien d'autre.
  const BAREMA = ["-20 °C 24 h", "-35 °C 15 h"];
  /** « Rauw OK » : bestemd om rauw te eten ET un traitement choisi parmi les deux barèmes. Sinon : pas de badge. */
  const rauwOk = (vis) => !!(vis && vis.rauw === true && BAREMA.includes(vis.vriesbehandeling));

  /** Pas de quantité d'un produit (stepper) : un conditionnement entier, 0,5 kg ou 1. */
  function stap(p) {
    const per = Number(p && p.per), only = !!(p && p.enkel);
    if (only && per > 1) return per;
    return /kg/i.test(String((p && (p.unite || p.unit)) || "")) ? 0.5 : 1;
  }
  /** Quantité arrondie au pas (au moins un pas) ; utilisée pour la commande probable. */
  function rond(q, p) {
    const s = stap(p), n = Math.max(1, Math.round(Number(q) / s));
    return Math.round(n * s * 1000) / 1000;
  }

  return { KEYS, GROEPEN, GROEP_LABEL, JAUGE_MIN, AMBER_MIN, brussel, addDays, norm, venster, klok, klokTekst, weekdag, kort, groep, naam, soort, rauwOk, stap, rond, fold };
});
