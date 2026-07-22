// Client staff session: cookie HttpOnly via /api/session. Never store STAFF_CODE.
(function (global) {
  const RETURN_KEY = "famoReturnTo";
  const PROOF_MAX_BYTES = Math.floor(1.5 * 1024 * 1024);
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

  function showLoginAfterExpiry() {
    const loginView = document.getElementById("login") || document.getElementById("loginView");
    const appView = document.getElementById("app");
    if (loginView) {
      loginView.classList.remove("hidden");
      if (appView) appView.classList.add("hidden");
      const codeEl = document.getElementById("code");
      if (codeEl) {
        try { codeEl.focus(); } catch (e) { /* ignore */ }
      }
      const errEl = document.getElementById("err");
      if (errEl) errEl.textContent = "Sessie verlopen. Meld u opnieuw aan.";
      return true;
    }
    return false;
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
      try {
        document.dispatchEvent(new CustomEvent("famo:session-expired", { detail: { url: clean } }));
      } catch (e) { /* ignore */ }
      showLoginAfterExpiry();
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

  /** HTML block for proof-of-delivery: HTTPS URL + local image preview only (no fake Blob upload). */
  function proofFieldsHtml(opts) {
    const o = opts || {};
    const id = o.id || "proof";
    const fileId = o.fileId || (id + "File");
    const previewId = o.previewId || (id + "Preview");
    const noteId = o.noteId || (id + "Note");
    return '<label>Bewijslink (https, optioneel)<input id="' + id + '" type="url" placeholder="https://…" autocomplete="off"></label>' +
      '<label style="margin-top:10px">Voorbeeld foto (lokaal)<input id="' + fileId + '" type="file" accept="image/*"></label>' +
      '<div id="' + previewId + '" style="display:none;margin-top:8px"><img alt="Voorbeeld bewijs" style="max-width:100%;max-height:160px;border-radius:8px;border:1px solid #e0e0e0"></div>' +
      '<p id="' + noteId + '" class="proof-upload-note" data-proof-blocked="PROOF_UPLOAD_BLOCKED" style="margin:8px 0 0;color:#9a6700;font-size:12px;line-height:1.45">' +
      'PROOF_UPLOAD_BLOCKED — Bestandsupload vereist Vercel Blob of externe opslag. Peppol/Blob zijn externe diensten. Plak voorlopig een https-link; de lokale foto is alleen een voorbeeld en wordt niet naar Airtable gestuurd.' +
      '</p>';
  }

  function bindProofFile(fileInput, previewWrap, noteEl) {
    const fileEl = typeof fileInput === "string" ? document.getElementById(fileInput) : fileInput;
    const preview = typeof previewWrap === "string" ? document.getElementById(previewWrap) : previewWrap;
    const note = typeof noteEl === "string" ? document.getElementById(noteEl) : noteEl;
    if (!fileEl) return;
    fileEl.addEventListener("change", () => {
      const f = fileEl.files && fileEl.files[0];
      const img = preview && preview.querySelector("img");
      if (!f) {
        if (preview) preview.style.display = "none";
        if (img) img.removeAttribute("src");
        return;
      }
      if (!/^image\//i.test(f.type || "")) {
        fileEl.value = "";
        if (note) note.textContent = "Kies een afbeeldingsbestand (image/*).";
        return;
      }
      if (f.size > PROOF_MAX_BYTES) {
        fileEl.value = "";
        if (preview) preview.style.display = "none";
        if (note) {
          note.textContent = "Bestand te groot (max. 1,5 MB). Verklein de foto of plak een https-link.";
        }
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (img) {
          img.src = String(reader.result || "");
          if (preview) preview.style.display = "block";
        }
        if (note) {
          note.textContent = "PROOF_UPLOAD_BLOCKED — Lokale preview OK. Plak een https-link hierboven om het bewijs op te slaan (geen Blob-token geconfigureerd; data-URL’s worden niet naar Airtable gestuurd).";
        }
      };
      reader.onerror = () => {
        if (note) note.textContent = "Bestand kon niet worden gelezen.";
      };
      reader.readAsDataURL(f);
    });
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

    window.addEventListener("famo:session-expired", () => {
      if (loginView) {
        loginView.classList.remove("hidden");
        if (appView) appView.classList.add("hidden");
        if (errEl) errEl.textContent = "Sessie verlopen. Meld u opnieuw aan.";
        if (codeEl) {
          try { codeEl.focus(); } catch (e) { /* ignore */ }
        }
      }
    });

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
    translateError, saveReturn, takeReturn, stripCodeParam,
    proofFieldsHtml, bindProofFile, PROOF_MAX_BYTES
  };
})(typeof window !== "undefined" ? window : global);
