// Preuve de livraison sur place (audit H-09) : signature au doigt et photo réduite dans le
// navigateur avant l'envoi (api/bewijs.js). Sans dépendance ; UMD léger (window.FamoProof).
(function (root) {
  "use strict";
  // Zone de signature : pointer events (doigt, stylet, souris), trait lissé, fond blanc.
  function pad(canvas) {
    const ctx = canvas.getContext("2d");
    let drawing = false, empty = true, last = null;
    const fit = () => {
      const r = canvas.getBoundingClientRect(), dpr = Math.max(1, Math.min(3, root.devicePixelRatio || 1));
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, r.width, r.height);
      ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
      empty = true;
    };
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.style.touchAction = "none"; // le doigt dessine au lieu de faire défiler la page
    canvas.addEventListener("pointerdown", (e) => { drawing = true; last = pos(e); try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ancien navigateur */ } e.preventDefault(); });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p; empty = false; e.preventDefault();
    });
    const end = () => { drawing = false; last = null; if (!empty && api.onchange) api.onchange(); };
    canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end); canvas.addEventListener("pointerleave", end);
    const api = {
      isEmpty: () => empty,
      clear: () => { fit(); if (api.onchange) api.onchange(); },
      // PNG en base64 (sans préfixe data:), comme l'attend api/bewijs.js.
      toPng: () => canvas.toDataURL("image/png").split(",")[1],
      onchange: null
    };
    fit();
    return api;
  }

  // Photo du téléphone réduite (≤ max px, JPEG q) : quelques centaines de Ko au lieu de 5 Mo.
  function shrink(file, max, quality) {
    const M = max || 1600, Q = quality || 0.8;
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error("Geen afbeelding")); return; }
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const s = Math.min(1, M / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ contentType: "image/jpeg", base64: c.toDataURL("image/jpeg", Q).split(",")[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Foto kon niet gelezen worden")); };
      img.src = url;
    });
  }

  root.FamoProof = { pad, shrink };
})(typeof window !== "undefined" ? window : this);
