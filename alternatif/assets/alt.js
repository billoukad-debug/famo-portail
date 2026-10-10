// Maquette « Kaai bij nacht » v2 : données fictives, aucun appel réseau.
// Mouvement selon emil-design-eng : révélation unique au défilement (IntersectionObserver, pas d'écouteur scroll),
// panier en transition interruptible, aucune animation sur l'étape de Vandaag (action répétée).
// ?demo=pire : données extrêmes (emil break-ui) pour vérifier que rien ne casse.
(function () {
  "use strict";
  var root = document.documentElement;
  root.classList.add("js");
  var num = function (s) { return Number(String(s).replace(",", ".")) || 0; };
  var eur = function (n) { return "€ " + n.toFixed(2).replace(".", ","); };

  // Révélation des photos, une seule fois
  var rev = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && rev.length) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    rev.forEach(function (el) { io.observe(el); });
    // Filet : jamais de contenu caché durablement (impression, capture, navigateur lent)
    setTimeout(function () { rev.forEach(function (el) { el.classList.add("in"); }); }, 2500);
  } else rev.forEach(function (el) { el.classList.add("in"); });

  // Aanbod : filtres par famille
  document.querySelectorAll("[data-filter]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var f = chip.getAttribute("data-filter");
      document.querySelectorAll("[data-filter]").forEach(function (c) { c.setAttribute("aria-pressed", String(c === chip)); });
      document.querySelectorAll("[data-group]").forEach(function (g) { g.hidden = !!f && g.getAttribute("data-group") !== f; });
    });
  });

  // Klant : quantités, total, panier
  var cart = document.getElementById("cart");
  function refresh() {
    var n = 0, total = 0;
    document.querySelectorAll(".line").forEach(function (l) {
      var q = num(l.querySelector("output").value);
      l.classList.toggle("has", q > 0);
      if (q) { n++; total += q * num(l.getAttribute("data-price")); }
    });
    if (!cart) return;
    cart.classList.toggle("off", n === 0);
    cart.querySelector("[data-n]").textContent = n + (n === 1 ? " artikel" : " artikels");
    cart.querySelector("[data-total]").textContent = eur(total);
  }
  document.querySelectorAll(".step").forEach(function (s) {
    var out = s.querySelector("output"), stepv = num(s.getAttribute("data-step") || 1);
    s.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var v = Math.max(0, num(out.value) + (b.getAttribute("data-d") === "+" ? stepv : -stepv));
      out.value = String(Math.round(v * 10) / 10).replace(".", ",");
      refresh();
    });
  });
  var q = document.getElementById("q");
  if (q) q.addEventListener("input", function () {
    var t = q.value.trim().toLowerCase(), any = false;
    document.querySelectorAll("[data-g]").forEach(function (g) {
      var shown = 0;
      g.querySelectorAll(".line").forEach(function (l) { var ok = !t || l.getAttribute("data-name").indexOf(t) >= 0; l.hidden = !ok; if (ok) shown++; });
      g.hidden = shown === 0; if (shown) any = true;
    });
    document.getElementById("empty").classList.toggle("on", !any);
  });
  refresh();

  // Vandaag : un tap = l'étape suivante, instantané (pas de mouvement sur une action faite 50 fois par matin)
  var FLOW = [["st-new", "Ontvangen"], ["st-ready", "Klaar"], ["st-road", "Onderweg"], ["st-done", "Geleverd"], ["st-done", "Betaald"]];
  document.querySelectorAll(".order").forEach(function (o) {
    var btn = o.querySelector(".next"), stage = o.querySelector(".stage");
    btn.addEventListener("click", function () {
      var i = Math.min(FLOW.length - 1, Number(o.getAttribute("data-i")) + 1);
      o.setAttribute("data-i", String(i));
      stage.className = "stage " + FLOW[i][0]; stage.textContent = FLOW[i][1];
      if (i === FLOW.length - 1) { btn.textContent = "Afgerond"; btn.disabled = true; o.classList.add("done"); }
      else btn.textContent = "Zet op " + FLOW[i + 1][1];
    });
  });

  // Pire cas (break-ui) : noms très longs, chiffres extrêmes
  if (/[?&]demo=pire\b/.test(location.search)) {
    var long = "Restaurant Het Gouden Zeepaardje aan de Scheldekaai Antwerpen-Noord BVBA";
    document.querySelectorAll(".order h2, [data-who]").forEach(function (h) { h.textContent = long; });
    document.querySelectorAll(".line b").forEach(function (b, i) { if (i % 2 === 0) b.textContent = "VANNAMEI GARNALEN GEPELD EN ONTDARMD 16/20 DIEPVRIES IQF GLAZUUR 10% (OPGELET: ENKEL PER DOOS)"; });
    document.querySelectorAll(".order ul").forEach(function (u) { u.insertAdjacentHTML("beforeend", "<li>Tonijn sashimiblok 12,75 kg × 38</li><li>Oesters × 1440</li>"); });
    document.querySelectorAll(".step output").forEach(function (o) { o.value = "999,5"; });
    refresh();
  }
})();
