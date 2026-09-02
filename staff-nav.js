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

  // Icones SVG inline — dessinees ici, aucune dependance. Trait 1.75 via CSS,
  // couleur heritee du lien (currentColor). Remplace les caracteres Unicode.
  const NAV_ICONS = {
    orders: '<path d="M5.5 4.5h8M5.5 8h8M5.5 11.5h8"/><path d="M2.4 4.5h.01M2.4 8h.01M2.4 11.5h.01"/>',
    warehouse: '<path d="M2.5 5.5 8 2.5l5.5 3v5L8 13.5l-5.5-3z"/><path d="M2.5 5.5 8 8.5l5.5-3M8 8.5v5"/>',
    delivery: '<path d="M1.5 3.5h8v6.5h-8z"/><path d="M9.5 6h2.6l2.4 2.6V10h-1.6"/><circle cx="4.4" cy="12" r="1.4"/><circle cx="11.2" cy="12" r="1.4"/>',
    entry: '<circle cx="8" cy="8" r="6"/><path d="M8 5.5v5M5.5 8h5"/>',
    docs: '<path d="M4 1.5h5l3 3V14.5H4z"/><path d="M9 1.5v3h3M6.2 8h3.6M6.2 10.6h3.6"/>',
    guide: '<path d="M2.5 4.7h5.6M12 4.7h1.5M2.5 11.3h1.5M8 11.3h5.5"/><circle cx="10" cy="4.7" r="1.7"/><circle cx="5.9" cy="11.3" r="1.7"/>',
    stock: '<path d="M2.5 11.5h11M2.5 8h11M2.5 4.5h11"/>',
    overview: '<rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1"/><rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1"/><rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1"/><rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1"/>'
  };

  function iconSvg(name) {
    const body = NAV_ICONS[name] || NAV_ICONS.overview;
    return '<svg viewBox="0 0 16 16" aria-hidden="true">' + body + "</svg>";
  }

  // Monogramme Famo : un F dont la barre mediane se prolonge en ligne de houle.
  // Trait 1.75, currentColor — le carre .staff-logo-mark fournit fond et couleur.
  const LOGO_MONOGRAM =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
    '<path d="M4 13.5V2.5h8"/>' +
    '<path d="M4 8h2.8c1.4 0 1.7-1.3 3.1-1.3s1.5 1.3 2.9 1.3"/>' +
    "</svg>";

  function linkHtml(item, active) {
    const cur = active === item.id ? ' aria-current="page"' : "";
    return '<a class="' + linkClass(active, item.id) + '" href="' + item.href + '"' + cur +
      '><span class="staff-nav-icon ' + item.icon + '">' + iconSvg(item.icon) + "</span>" + item.label + "</a>";
  }

  // Uitloggen via une fonction nommée globale : scripts/check.js ne comprend
  // pas les appels chaînés (a.b()) dans les onclick inline.
  global.famoNavLogout = function () {
    const staff = global.famoStaff;
    if (staff && typeof staff.logout === "function") {
      staff.logout().then(function () { location.reload(); });
    }
    return false;
  };

  function sidebarHtml(active, isAdmin) {
    active = active || detectActive();
    // Zone administration : uniquement pour l'admin (le serveur refuse de toute façon).
    const adminBlock = isAdmin
      ? '<div class="staff-nav-label meer-label">Beheer</div>' +
        MEER.concat([SETUP]).map(i => linkHtml(i, active)).join("")
      : "";
    return '<a class="staff-logo" href="/bestellingen.html"><span class="staff-logo-mark">' + LOGO_MONOGRAM + "</span>" +
      '<span class="staff-logo-word">Famo Trading<small>Antwerpen</small></span></a>' +
      '<div class="staff-nav-label">Dagelijks</div>' +
      PRIMARY.map(i => linkHtml(i, active)).join("") +
      adminBlock +
      '<div class="staff-nav-spacer"></div>' +
      '<div class="staff-nav-foot"><a class="staff-setup-link" href="/" target="_blank" rel="noopener">Klantportaal bekijken ↗</a></div>' +
      '<div class="staff-session"><span class="staff-session-avatar">' + (isAdmin ? "BH" : "PM") + '</span>' +
      '<div><b>' + (isAdmin ? "Beheerder" : "Personeel") + '</b><small>Famo Trading</small></div>' +
      '<a href="#" onclick="famoNavLogout();return false">Uitloggen</a></div>';
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
      banner.innerHTML = "De configuratie is nog niet afgerond (" + gaps.join(", ") + ") — ga naar <a href=\"/beheer.html\">Beheer</a>.";
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
