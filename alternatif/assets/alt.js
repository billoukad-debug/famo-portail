// Maquette « Kaai bij nacht » : filtres de l'aanbod, quantités du catalogue, étapes de Vandaag. Données fictives, aucun appel réseau.
(function () {
  "use strict";
  document.querySelectorAll("[data-filter]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var f = chip.getAttribute("data-filter");
      document.querySelectorAll("[data-filter]").forEach(function (c) { c.setAttribute("aria-pressed", String(c === chip)); });
      document.querySelectorAll("[data-group]").forEach(function (g) { g.hidden = !!f && g.getAttribute("data-group") !== f; });
    });
  });

  var cart = document.getElementById("cart");
  function refresh() {
    var n = 0, total = 0;
    document.querySelectorAll(".line").forEach(function (l) {
      var q = Number(String(l.querySelector("output").value).replace(",", ".")) || 0;
      l.classList.toggle("has", q > 0);
      n += q ? 1 : 0; total += q * Number(l.getAttribute("data-price"));
    });
    if (!cart) return;
    cart.hidden = n === 0;
    cart.querySelector("[data-n]").textContent = n + (n === 1 ? " artikel" : " artikels");
    cart.querySelector("[data-total]").textContent = "€ " + total.toFixed(2).replace(".", ",");
  }
  document.querySelectorAll(".step").forEach(function (s) {
    var out = s.querySelector("output"), stepv = Number(s.getAttribute("data-step") || 1);
    s.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var v = Math.max(0, (Number(String(out.value).replace(",", ".")) || 0) + (b.getAttribute("data-d") === "+" ? stepv : -stepv));
      out.value = String(Math.round(v * 10) / 10).replace(".", ",");
      refresh();
    });
  });
  refresh();

  // Stappen van Vandaag : Ontvangen → Klaar → Onderweg → Geleverd → Betaald ; de knop noemt altijd de volgende stap.
  var FLOW = [["st-new", "Ontvangen"], ["st-ready", "Klaar"], ["st-road", "Onderweg"], ["st-done", "Geleverd"], ["st-done", "Betaald"]];
  document.querySelectorAll(".order").forEach(function (o) {
    var btn = o.querySelector(".next"), stage = o.querySelector(".stage");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var i = Math.min(FLOW.length - 1, Number(o.getAttribute("data-i")) + 1);
      o.setAttribute("data-i", String(i));
      stage.className = "stage " + FLOW[i][0]; stage.textContent = FLOW[i][1];
      if (i === FLOW.length - 1) { btn.textContent = "Afgerond"; btn.disabled = true; o.classList.add("is-done"); }
      else btn.textContent = FLOW[i + 1][1];
    });
  });
})();
