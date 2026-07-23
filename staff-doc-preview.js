// Shared in-app document preview: A4 iframe, print, real PDF download.
// Does not mutate order/stock/invoice data — HTML in, preview/export out.
(function (global) {
  const PDF_LIB = "/vendor/html2pdf.bundle.min.js";
  let host = null;
  let frame = null;
  let statusEl = null;
  let titleEl = null;
  let metaEl = null;
  let downloadBtn = null;
  let printBtn = null;
  let state = { html: "", filename: "Famo-Document.pdf", title: "Documentvoorbeeld", meta: "" };
  let busy = false;
  let pdfLibPromise = null;
  let lastFocus = null;

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }

  function sanitizeFilePart(value) {
    return String(value || "document")
      .replace(/[^\w.\-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "document";
  }

  function todayBrussels() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(new Date());
  }

  /** Build canonical PDF filenames for staff exports. */
  function filenameFor(kind, opts) {
    opts = opts || {};
    if (kind === "delivery" || kind === "lb") {
      return "Famo-Leveringsbon-" + sanitizeFilePart(opts.ref || opts.number || "CMD") + ".pdf";
    }
    if (kind === "invoice" || kind === "facture" || kind === "fa") {
      return "Famo-Factuur-" + sanitizeFilePart(opts.number || opts.invoice || opts.ref || "FA") + ".pdf";
    }
    if (kind === "credit") {
      return "Famo-Creditnota-" + sanitizeFilePart(opts.number || opts.ref || "CN") + ".pdf";
    }
    if (kind === "picking" || kind === "prep" || kind === "voorbereiding") {
      return "Famo-Picking-" + sanitizeFilePart(opts.date || todayBrussels()) + ".pdf";
    }
    return "Famo-Document-" + sanitizeFilePart(opts.name || todayBrussels()) + ".pdf";
  }

  function setStatus(message, kind) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.className = "famo-doc-status" + (kind ? " " + kind : "") + (message ? "" : " hidden");
  }

  function ensureHost() {
    if (host) return host;
    host = document.createElement("div");
    host.id = "famoDocPreview";
    host.className = "famo-doc-preview hidden";
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-modal", "true");
    host.setAttribute("aria-labelledby", "famoDocTitle");
    host.innerHTML =
      '<div class="famo-doc-pane">' +
        '<header class="famo-doc-toolbar">' +
          '<div class="famo-doc-heading">' +
            '<strong id="famoDocTitle">Documentvoorbeeld</strong>' +
            '<span id="famoDocMeta" class="famo-doc-meta"></span>' +
          "</div>" +
          '<div class="famo-doc-actions">' +
            '<button type="button" class="famo-doc-btn" data-famo-doc="close" aria-label="Sluiten">×</button>' +
            '<button type="button" class="famo-doc-btn" data-famo-doc="cancel">Annuleren</button>' +
            '<button type="button" class="famo-doc-btn" data-famo-doc="print">Afdrukken</button>' +
            '<button type="button" class="famo-doc-btn primary" data-famo-doc="download">Download PDF</button>' +
          "</div>" +
        "</header>" +
        '<div id="famoDocStatus" class="famo-doc-status hidden" role="status" aria-live="polite"></div>' +
        '<div class="famo-doc-stage">' +
          '<div class="famo-doc-a4">' +
            '<iframe id="famoDocFrame" title="Documentvoorbeeld" sandbox="allow-same-origin allow-modals"></iframe>' +
          "</div>" +
        "</div>" +
      "</div>";
    document.body.appendChild(host);
    frame = host.querySelector("#famoDocFrame");
    statusEl = host.querySelector("#famoDocStatus");
    titleEl = host.querySelector("#famoDocTitle");
    metaEl = host.querySelector("#famoDocMeta");
    downloadBtn = host.querySelector('[data-famo-doc="download"]');
    printBtn = host.querySelector('[data-famo-doc="print"]');

    host.addEventListener("click", e => {
      if (e.target === host) close();
      const btn = e.target.closest("[data-famo-doc]");
      if (!btn) return;
      const action = btn.getAttribute("data-famo-doc");
      if (action === "close" || action === "cancel") close();
      else if (action === "print") print();
      else if (action === "download") downloadPdf();
    });

    return host;
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  function open(opts) {
    opts = opts || {};
    ensureHost();
    lastFocus = document.activeElement;
    state = {
      html: String(opts.html || ""),
      filename: opts.filename || filenameFor("picking", {}),
      title: opts.title || "Documentvoorbeeld",
      meta: opts.meta || ""
    };
    if (!state.html) {
      setStatus("Geen documentinhoud beschikbaar.", "error");
      return;
    }
    titleEl.textContent = state.title;
    metaEl.textContent = state.meta;
    setStatus("Document laden…", "loading");
    if (downloadBtn) downloadBtn.disabled = true;
    if (printBtn) printBtn.disabled = true;
    host.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeydown);

    const onLoad = () => {
      frame.removeEventListener("load", onLoad);
      setStatus("");
      if (downloadBtn) downloadBtn.disabled = false;
      if (printBtn) printBtn.disabled = false;
      const closeBtn = host.querySelector('[data-famo-doc="close"]');
      if (closeBtn) closeBtn.focus();
    };
    frame.addEventListener("load", onLoad);
    frame.srcdoc = state.html;
  }

  function close() {
    if (!host) return;
    host.classList.add("hidden");
    if (frame) {
      frame.removeAttribute("srcdoc");
      try { frame.src = "about:blank"; } catch (e) { /* ignore */ }
    }
    setStatus("");
    busy = false;
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    if (lastFocus && typeof lastFocus.focus === "function") {
      try { lastFocus.focus(); } catch (e) { /* ignore */ }
    }
    lastFocus = null;
  }

  function print() {
    if (!frame || !frame.contentWindow) {
      setStatus("Afdrukken mislukt: voorbeeld niet geladen.", "error");
      return;
    }
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (e) {
      setStatus("Afdrukken mislukt. Probeer opnieuw.", "error");
    }
  }

  function loadPdfLib() {
    if (global.html2pdf) return Promise.resolve(global.html2pdf);
    if (pdfLibPromise) return pdfLibPromise;
    pdfLibPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-famo-html2pdf]');
      if (existing) {
        existing.addEventListener("load", () => global.html2pdf ? resolve(global.html2pdf) : reject(new Error("PDF-bibliotheek niet beschikbaar.")));
        existing.addEventListener("error", () => reject(new Error("PDF-bibliotheek kon niet worden geladen.")));
        return;
      }
      const s = document.createElement("script");
      s.src = PDF_LIB;
      s.async = true;
      s.setAttribute("data-famo-html2pdf", "1");
      s.onload = () => global.html2pdf ? resolve(global.html2pdf) : reject(new Error("PDF-bibliotheek niet beschikbaar."));
      s.onerror = () => reject(new Error("PDF-bibliotheek kon niet worden geladen."));
      document.head.appendChild(s);
    });
    return pdfLibPromise;
  }

  async function blobLooksLikePdf(blob) {
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    return head.length >= 4 &&
      head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function downloadPdf() {
    if (busy) return;
    if (!frame || !frame.contentDocument || !frame.contentDocument.body) {
      setStatus("Download mislukt: voorbeeld niet geladen.", "error");
      return;
    }
    busy = true;
    if (downloadBtn) downloadBtn.disabled = true;
    setStatus("PDF genereren…", "loading");
    try {
      const html2pdf = await loadPdfLib();
      const source = frame.contentDocument.body;
      const worker = html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: state.filename,
        image: { type: "jpeg", quality: 0.96 },
        html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 794 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"] }
      }).from(source);
      const blob = await worker.outputPdf("blob");
      if (!(blob instanceof Blob) || blob.type.indexOf("pdf") === -1 && blob.type !== "application/octet-stream") {
        // jsPDF sometimes returns empty type; magic-byte check is authoritative
      }
      if (!(await blobLooksLikePdf(blob))) {
        throw new Error("Geen geldige PDF gegenereerd (geen HTML-hernoemd bestand).");
      }
      const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
      triggerDownload(pdfBlob, state.filename);
      setStatus("PDF gedownload: " + state.filename, "ok");
    } catch (e) {
      setStatus((e && e.message) || "PDF downloaden mislukt.", "error");
    } finally {
      busy = false;
      if (downloadBtn) downloadBtn.disabled = false;
    }
  }

  global.famoDocPreview = {
    open,
    close,
    print,
    downloadPdf,
    filenameFor,
    esc
  };
})(typeof window !== "undefined" ? window : global);
