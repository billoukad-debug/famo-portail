// Shared staff navigation (9 items) + aria-current="page".
(function (global) {
  const ITEMS = [
    { id: "overzicht", href: "/overzicht.html", label: "Overzicht", icon: "overview" },
    { id: "bestellingen", href: "/bestellingen.html", label: "Bestellingen", icon: "orders" },
    { id: "magazijn", href: "/entrepot.html", label: "Magazijn", icon: "warehouse" },
    { id: "dagprep", href: "/dagprep.html", label: "Dagvoorbereiding", icon: "pick" },
    { id: "invoeren", href: "/invoer.html", label: "Invoeren", icon: "entry" },
    { id: "voorraad", href: "/stock.html", label: "Voorraad", icon: "stock" },
    { id: "documenten", href: "/documenten.html", label: "Documenten", icon: "docs" },
    { id: "leveringen", href: "/leveringen.html", label: "Leveringen", icon: "delivery" },
    { id: "aan-de-slag", href: "/aan-de-slag.html", label: "Aan de slag", icon: "guide" }
  ];

  function detectActive() {
    const path = (location.pathname || "").split("/").pop() || "";
    if (path === "entrepot.html") return "magazijn";
    if (path === "invoer.html") return "invoeren";
    if (path === "stock.html") return "voorraad";
    if (path === "order.html") return "bestellingen";
    if (path === "aan-de-slag.html") return "aan-de-slag";
    const hit = ITEMS.find(i => i.href.endsWith("/" + path) || i.href === "/" + path);
    return hit ? hit.id : "";
  }

  function linkClass(active, id, extra) {
    return (extra || "staff-nav-link") + (active === id ? " active" : "");
  }

  function sidebarHtml(active, logoutFn) {
    active = active || detectActive();
    const links = ITEMS.map(i => {
      const cur = active === i.id ? ' aria-current="page"' : "";
      return '<a class="' + linkClass(active, i.id) + '" href="' + i.href + '"' + cur + '><span class="staff-nav-icon ' + i.icon + '"></span>' + i.label + "</a>";
    }).join("");
    const logout = logoutFn || "famoStaff.logout().then(function(){location.reload()})";
    return '<a class="staff-logo" href="/overzicht.html"><span class="staff-logo-mark">F</span>Famo Trading</a>' +
      '<div class="staff-nav-label">Werkruimte</div>' + links +
      '<div class="staff-nav-spacer"></div>' +
      '<div class="staff-session"><span class="staff-session-avatar">PM</span><div><b>Personeel</b><small>Famo Trading</small></div>' +
      '<a href="#" onclick="' + logout + ';return false">Uitloggen</a></div>';
  }

  function mobileHtml(active) {
    active = active || detectActive();
    return '<a href="/overzicht.html">Famo</a>' + ITEMS.filter(i => i.id !== "overzicht").map(i => {
      const cur = active === i.id ? ' aria-current="page"' : "";
      return '<a href="' + i.href + '"' + cur + (active === i.id ? ' class="active"' : "") + ">" + i.label + "</a>";
    }).join("");
  }

  function mount(active) {
    active = active || detectActive();
    document.querySelectorAll("[data-famo-nav]").forEach(el => {
      el.innerHTML = sidebarHtml(active);
      el.setAttribute("aria-label", "Personeelsnavigatie");
    });
    document.querySelectorAll("[data-famo-mobile-nav]").forEach(el => {
      el.innerHTML = mobileHtml(active);
      el.setAttribute("aria-label", "Mobiele navigatie");
    });
    // Also patch legacy sidebars that still list links inline: ensure Aan de slag + aria-current
    document.querySelectorAll(".staff-sidebar, .warehouse-sidebar").forEach(aside => {
      if (aside.hasAttribute("data-famo-nav")) return;
      ITEMS.forEach(i => {
        const a = aside.querySelector('a[href="' + i.href + '"]');
        if (a) {
          if (active === i.id) {
            a.setAttribute("aria-current", "page");
            a.classList.add("active");
          } else {
            a.removeAttribute("aria-current");
            a.classList.remove("active");
          }
        }
      });
      if (!aside.querySelector('a[href="/aan-de-slag.html"]')) {
        const spacer = aside.querySelector(".staff-nav-spacer, .warehouse-side-spacer");
        const a = document.createElement("a");
        a.className = linkClass(active, "aan-de-slag", aside.classList.contains("warehouse-sidebar") ? "warehouse-nav-link" : "staff-nav-link");
        a.href = "/aan-de-slag.html";
        if (active === "aan-de-slag") a.setAttribute("aria-current", "page");
        a.textContent = "Aan de slag";
        if (spacer) aside.insertBefore(a, spacer);
        else aside.appendChild(a);
      }
    });
  }

  global.famoNav = { ITEMS, detectActive, sidebarHtml, mobileHtml, mount };
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => mount());
    } else {
      mount();
    }
  }
})(typeof window !== "undefined" ? window : global);
