// Navigation en trois zones explicites :
//   DAGELIJKS  — le travail du jour, visible par tout le personnel
//   BEHEER     — administration, réservée au rôle admin (aussi imposé côté serveur)
//   footer     — passage vers le portail client + identité de la session
(function (global) {
  // Zone 1 : opérations quotidiennes (personnel + admin).
  const PRIMARY = [
    { id: "bestellingen", href: "/bestellingen.html", label: "Bestellingen", icon: "orders" },
    { id: "magazijn", href: "/entrepot.html", label: "Magazijn", icon: "warehouse" },
    { id: "leveringen", href: "/leveringen.html", label: "Leveringen", icon: "delivery" }
  ];
  // Zone 2 : administration (admin seulement).
  // Voorraad reste accessible via son URL directe, mais hors menu : le stock
  // n'est pas fiable, on ne veut pas encourager son usage quotidien.
  const MEER = [
    { id: "invoeren", href: "/invoer.html", label: "Invoeren", icon: "entry" },
    { id: "documenten", href: "/documenten.html", label: "Documenten", icon: "docs" }
  ];
  // Back-office (klanten, producten, prijzen, bedrijfsgegevens).
  // aan-de-slag.html reste l'assistant de mise en service initiale.
  const SETUP = { id: "beheer", href: "/beheer.html", label: "Beheer", icon: "guide" };
  const ITEMS = PRIMARY.concat(MEER).concat([SETUP]);

  function detectActive() {
    const path = (location.pathname || "").split("/").pop() || "";
    if (path === "entrepot.html" || path === "dagprep.html") return "magazijn";
    if (path === "invoer.html") return "invoeren";
    if (path === "stock.html") return "voorraad";
    if (path === "order.html" || path === "overzicht.html" || path === "bestellingen.html") return "bestellingen";
    if (path === "aan-de-slag.html") return "aan-de-slag";
    if (path === "beheer.html") return "beheer";
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

  function sidebarHtml(active, isAdmin) {
    active = active || detectActive();
    const logout = "famoStaff.logout().then(function(){location.reload()})";
    // Zone administration : uniquement pour l'admin (le serveur refuse de toute façon).
    const adminBlock = isAdmin
      ? '<div class="staff-nav-label meer-label">Beheer</div>' +
        MEER.concat([SETUP]).map(i => linkHtml(i, active)).join("")
      : "";
    return '<a class="staff-logo" href="/bestellingen.html"><span class="staff-logo-mark">F</span>Famo Trading</a>' +
      '<div class="staff-nav-label">Dagelijks</div>' +
      PRIMARY.map(i => linkHtml(i, active)).join("") +
      adminBlock +
      '<div class="staff-nav-spacer"></div>' +
      '<div class="staff-nav-foot"><a class="staff-setup-link" href="/" target="_blank" rel="noopener">Klantportaal bekijken ↗</a></div>' +
      '<div class="staff-session"><span class="staff-session-avatar">' + (isAdmin ? "BH" : "PM") + '</span>' +
      '<div><b>' + (isAdmin ? "Beheerder" : "Personeel") + '</b><small>Famo Trading</small></div>' +
      '<a href="#" onclick="' + logout + ';return false">Uitloggen</a></div>';
  }

  function mobileHtml(active, isAdmin) {
    active = active || detectActive();
    const link = i => {
      const cur = active === i.id ? ' aria-current="page"' : "";
      return '<a href="' + i.href + '"' + cur + (active === i.id ? ' class="active"' : "") + ">" + i.label + "</a>";
    };
    const primary = PRIMARY.map(link).join("");
    if (!isAdmin) return primary;
    const adminOpen = active === "invoeren" || active === "documenten" || active === "beheer" || active === "voorraad";
    return primary +
      '<details class="staff-meer"' + (adminOpen ? " open" : "") + ">" +
      "<summary>Beheer</summary>" +
      MEER.concat([SETUP]).map(link).join("") +
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

  function mount(active, knownAdmin) {
    active = active || detectActive();
    // Standaard het beperkte personeelsmenu tonen (geen flits van beheerderslinks);
    // pas uitbreiden zodra de rol bevestigd is als admin.
    render(active, knownAdmin === true);
    maybeSetupBanner(active);
  }

  /** Herteken de navigatie zodra de rol bekend is (bv. net na het aanmelden). */
  function refreshRole() {
    const staff = global.famoStaff;
    const isAdmin = !!(staff && typeof staff.getRole === "function" && staff.getRole() === "admin");
    render(detectActive(), isAdmin);
    maybeSetupBanner(detectActive());
  }

  function maybeSetupBanner(active) {
    const path = (location.pathname || "").split("/").pop() || "";
    if (path === "aan-de-slag.html" || path === "beheer.html" || path === "index.html" || !path.endsWith(".html")) return;
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
          " van de website — <a href=\"/beheer.html\">bekijken en klant aanmaken</a>.";
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
      banner.innerHTML = "Setup nog niet afgerond (" + gaps.join(", ") + ") — ga naar <a href=\"/beheer.html\">Beheer</a>.";
      main.insertBefore(banner, main.firstChild);
    }).catch(() => {});
  }

  global.famoNav = { ITEMS, PRIMARY, MEER, SETUP, detectActive, sidebarHtml, mobileHtml, mount, refreshRole };
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => mount());
    } else {
      mount();
    }
  }
})(typeof window !== "undefined" ? window : global);
