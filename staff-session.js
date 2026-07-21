// Client staff session: cookie HttpOnly via /api/session. Never store STAFF_CODE.
(function (global) {
  const RETURN_KEY = "famoReturnTo";
  const ERR_MAP = {
    "Code invalide": "Ongeldige personeelscode",
    "id requis": "Bestelling-id ontbreekt",
    "rien à mettre à jour": "Niets om bij te werken",
    "POST only": "Alleen POST toegestaan",
    "GET or POST only": "Alleen GET of POST toegestaan"
  };

  function translateError(msg) {
    const raw = String(msg || "").trim();
    if (!raw) return "Onbekende fout";
    if (ERR_MAP[raw]) return ERR_MAP[raw];
    if (/caisse/i.test(raw)) return raw.replace(/\bcaisse\b/gi, "kassa");
    return raw;
  }

  function stripCodeParam(url) {
    try {
      const u = new URL(url, location.origin);
      u.searchParams.delete("code");
      return u.pathname + u.search + u.hash;
    } catch (e) {
      return String(url || "").replace(/([?&])code=[^&]*/g, "$1").replace(/[?&]$/, "").replace(/\?&/, "?");
    }
  }

  function saveReturn() {
    try {
      sessionStorage.setItem(RETURN_KEY, location.pathname + location.search + location.hash);
    } catch (e) { /* ignore */ }
  }

  function takeReturn(fallback) {
    try {
      const v = sessionStorage.getItem(RETURN_KEY);
      sessionStorage.removeItem(RETURN_KEY);
      if (v && v.startsWith("/") && !v.startsWith("//")) return v;
    } catch (e) { /* ignore */ }
    return fallback || null;
  }

  async function login(code) {
    const r = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code: String(code || "") })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(translateError(d.error || "Aanmelden mislukt"));
    return d;
  }

  async function check() {
    const r = await fetch("/api/session", { method: "GET", credentials: "include" });
    return r.ok;
  }

  async function logout() {
    try {
      await fetch("/api/session", { method: "DELETE", credentials: "include" });
    } catch (e) { /* ignore */ }
  }

  async function api(url, opts) {
    const options = Object.assign({ credentials: "include" }, opts || {});
    if (options.headers && typeof options.headers === "object") {
      options.headers = Object.assign({}, options.headers);
    }
    const clean = stripCodeParam(url);
    const r = await fetch(clean, options);
    if (r.status === 401) {
      saveReturn();
      const err = new Error("Sessie verlopen. Meld u opnieuw aan.");
      err.status = 401;
      err.sessionExpired = true;
      throw err;
    }
    return r;
  }

  async function apiJson(url, opts) {
    const r = await api(url, opts);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(translateError(d.error || "Verzoek mislukt"));
      err.status = r.status;
      err.payload = d;
      throw err;
    }
    return d;
  }

  /** Bind login form: #code input, errorEl, onReady after session ok. */
  function bindLogin(cfg) {
    const codeEl = typeof cfg.code === "string" ? document.getElementById(cfg.code) : cfg.code;
    const errEl = typeof cfg.error === "string" ? document.getElementById(cfg.error) : cfg.error;
    const loginView = typeof cfg.loginView === "string" ? document.getElementById(cfg.loginView) : cfg.loginView;
    const appView = typeof cfg.appView === "string" ? document.getElementById(cfg.appView) : cfg.appView;
    let busy = false;

    async function showApp() {
      if (loginView) loginView.classList.add("hidden");
      if (appView) appView.classList.remove("hidden");
      if (typeof cfg.onReady === "function") await cfg.onReady();
    }

    async function enter() {
      if (busy) return;
      const code = (codeEl && codeEl.value || "").trim();
      if (!code) {
        if (errEl) errEl.textContent = "Vul de personeelscode in.";
        return;
      }
      busy = true;
      if (errEl) errEl.textContent = "Controleren…";
      try {
        await login(code);
        if (codeEl) codeEl.value = "";
        await showApp();
      } catch (e) {
        if (errEl) errEl.textContent = translateError(e.message);
      } finally {
        busy = false;
      }
    }

    async function doLogout() {
      await logout();
      location.reload();
    }

    if (codeEl) {
      codeEl.addEventListener("keydown", e => { if (e.key === "Enter") enter(); });
    }

    window.addEventListener("DOMContentLoaded", async () => {
      if (typeof cfg.onDom === "function") cfg.onDom();
      try {
        if (await check()) {
          await showApp();
          return;
        }
      } catch (e) { /* show login */ }
      if (loginView) loginView.classList.remove("hidden");
      if (appView) appView.classList.add("hidden");
      if (codeEl) codeEl.focus();
    });

    return { enter, logout: doLogout, showApp };
  }

  global.famoStaff = {
    login, check, logout, api, apiJson, bindLogin,
    translateError, saveReturn, takeReturn, stripCodeParam
  };
})(typeof window !== "undefined" ? window : global);
