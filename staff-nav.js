// Staff navigation: 4 daily destinations + Meer + footer setup.
(function (global) {
  const PRIMARY = [
    { id: "bestellingen", href: "/bestellingen.html", label: "Bestellingen", icon: "orders" },
    { id: "magazijn", href: "/entrepot.html", label: "Magazijn", icon: "warehouse" },
    { id: "leveringen", href: "/leveringen.html", label: "Leveringen", icon: "delivery" },
    { id: "invoeren", href: "/invoer.html", label: "Invoeren", icon: "entry" }
  ];
  // Voorraad reste accessible via son URL directe, mais n'est plus dans le menu :
  // le stock n'est pas encore fiable, on ne veut pas encourager son usage quotidien.
  const MEER = [
    { id: "documenten", href: "/documenten.html", label: "Documenten", icon: "docs" }
  ];
  const SETUP = { id: "aan-de-slag", href: "/aan-de-slag.html", label: "Aan de slag", icon: "guide" };
  const ITEMS = PRIMARY.concat(MEER).concat([SETUP]);

  function detectActive() {
    const path = (location.pathname || "").split("/").pop() || "";
    if (path === "entrepot.html" || path === "dagprep.html") return "magazijn";
    if (path === "invoer.html") return "invoeren";
    if (path === "stock.html") return "voorraad";
    if (path === "order.html" || path === "overzicht.html" || path === "bestellingen.html") return "bestellingen";
    if (path === "aan-de-slag.html") return "aan-de-slag";
    if (path === "leveringen.html") return "leveringen";
    if (path === "documenten.html") return "documenten";
    const hit = ITEMS.find(i => i.href.endsWith("/" + path) || i.href === "/" + path);
    return hit ? hit.id : "";
  }

  function linkClass(active, id) {
    return "staff-nav-link" + (active === id ? " active" : "");
  }

  function linkHtml(item, active) {
    const cur = active === item.id ? ' aria-current="page"' : "";
    return '<a class="' + linkClass(active, item.id) + '" href="' + item.href + '"' + cur +
      '><span class="staff-nav-icon ' + item.icon + '"></span>' + item.label + "</a>";
  }

  // Personeel (rol "staff") ziet enkel het dagelijkse minimum. Voorraad, Documenten,
  // Invoeren en Aan de slag zijn beheerderstaken (server-side afgedwongen via adminOk).
  const STAFF_PRIMARY = PRIMARY.filter(i => i.id !== "invoeren");

  function sidebarHtml(active, isAdmin) {
    active = active || detectActive();
    const primary = isAdmin ? PRIMARY : STAFF_PRIMARY;
    const logout = "famoStaff.logout().then(function(){location.reload()})";
    const meerBlock = isAdmin
      ? '<div class="staff-nav-label meer-label">Meer</div>' + MEER.map(i => linkHtml(i, active)).join("")
      : "";
    const setupBlock = isAdmin
      ? '<div class="staff-nav-foot"><a class="staff-setup-link' + (active === "aan-de-slag" ? " active" : "") + '" href="/aan-de-slag.html"' +
        (active === "aan-de-slag" ? ' aria-current="page"' : "") + '>Aan de slag</a></div>'
      : "";
    return '<a class="staff-logo" href="/bestellingen.html"><span class="staff-logo-mark">F</span>Famo Trading</a>' +
      '<div class="staff-nav-label">Vandaag</div>' +
      primary.map(i => linkHtml(i, active)).join("") +
      meerBlock +
      '<div class="staff-nav-spacer"></div>' +
      setupBlock +
      '<div class="staff-session"><span class="staff-session-avatar">PM</span><div><b>Personeel</b><small>Famo Trading</small></div>' +
      '<a href="#" onclick="' + logout + ';return false">Uitloggen</a></div>';
  }

  function mobileHtml(active, isAdmin) {
    active = active || detectActive();
    const items = isAdmin ? PRIMARY : STAFF_PRIMARY;
    const primary = items.map(i => {
      const cur = active === i.id ? ' aria-current="page"' : "";
      return '<a href="' + i.href + '"' + cur + (active === i.id ? ' class="active"' : "") + ">" + i.label + "</a>";
    }).join("");
    if (!isAdmin) return primary;
    const meerOpen = active === "voorraad" || active === "documenten" || active === "aan-de-slag";
    return primary +
      '<details class="staff-meer"' + (meerOpen ? " open" : "") + ">" +
      "<summary>Meer</summary>" +
      MEER.concat([SETUP]).map(i => {
        const cur = active === i.id ? ' aria-current="page"' : "";
        return '<a href="' + i.href + '"' + cur + (active === i.id ? ' class="active"' : "") + ">" + i.label + "</a>";
      }).join("") +
      "</details>";
  }

  function render(active, isAdmin) {
    document.querySelectorAll("[data-famo-nav]").forEach(el => {
      el.innerHTML = sidebarHtml(active, isAdmin);
      el.setAttribute("aria-label", "Personeelsnavigatie");
      el.classList.add("staff-sidebar");
    });
    document.querySelectorAll("[data-famo-mobile-nav]").forEach(el => {
      el.innerHTML = mobileHtml(active, isAdmin);
      el.setAttribute("aria-label", "Mobiele navigatie");
      el.classList.add("staff-mobile-nav");
    });
  }

  function mount(active) {
    active = active || detectActive();
    // Standaard het beperkte personeelsmenu tonen (geen flits van beheerderslinks);
    // pas uitbreiden zodra de rol bevestigd is als admin.
    render(active, false);
    maybeSetupBanner(active);
  }

  function maybeSetupBanner(active) {
    const path = (location.pathname || "").split("/").pop() || "";
    if (path === "aan-de-slag.html" || path === "index.html" || !path.endsWith(".html")) return;
    const staff = global.famoStaff;
    if (!staff || typeof staff.check !== "function" || typeof staff.api !== "function") return;
    staff.check().then(ok => {
      if (!ok) return null;
      const isAdmin = typeof staff.getRole === "function" && staff.getRole() === "admin";
      render(active, isAdmin);
      if (!isAdmin) return null;
      return staff.api("/api/config?status=1").then(r => r.ok ? r.json() : null);
    }).then(data => {
      if (!data || !data.status) return;
      const s = data.status;
      const main = document.querySelector(".staff-main .staff-page");
      if (!main) return;

      const aanvragen = Number(s.aanvragen) || 0;
      if (aanvragen > 0 && !main.querySelector(".staff-request-banner")) {
        const req = document.createElement("div");
        req.className = "staff-request-banner";
        req.setAttribute("role", "status");
        req.innerHTML = aanvragen + " nieuwe aanvra" + (aanvragen > 1 ? "gen" : "ag") +
          " van de website — <a href=\"/aan-de-slag.html\">bekijken en klant aanmaken</a>.";
        main.insertBefore(req, main.firstChild);
      }

      const gaps = [];
      if (!s.identiteit) gaps.push("bedrijfsgegevens/IBAN");
      if (!(Number(s.catalogue) > 0 || s.catalogueReady)) gaps.push("catalogus");
      if (!(Number(s.clients) > 0 || s.clientsReady)) gaps.push("klanten");
      if (!gaps.length || main.querySelector(".staff-setup-banner")) return;
      const banner = document.createElement("div");
      banner.className = "staff-setup-banner";
      banner.setAttribute("role", "status");
      banner.innerHTML = "Setup nog niet afgerond (" + gaps.join(", ") + ") — ga naar <a href=\"/aan-de-slag.html\">Aan de slag</a>.";
      main.insertBefore(banner, main.firstChild);
    }).catch(() => {});
  }

  global.famoNav = { ITEMS, PRIMARY, MEER, SETUP, detectActive, sidebarHtml, mobileHtml, mount };
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => mount());
    } else {
      mount();
    }
  }
})(typeof window !== "undefined" ? window : global);
