// Shared delivery confirmation sheet for staff pages.
(function (global) {
  const root = global.famoStaff;
  if (!root) return;

  let busy = false;
  let current = null;
  let host = null;
  let toastEl = null;
  let toastTimer = null;

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }

  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement("div");
    toastEl.id = "famoDeliveryToast";
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    toastEl.className = "famo-delivery-toast hidden";
    document.body.appendChild(toastEl);
    return toastEl;
  }

  function toast(message, warn) {
    const el = ensureToast();
    el.textContent = message;
    el.className = "famo-delivery-toast" + (warn ? " warn" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = "famo-delivery-toast hidden"; }, 4200);
  }

  function ensureHost() {
    if (host) return host;
    host = document.createElement("div");
    host.id = "famoDeliverySheet";
    host.className = "hidden";
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-modal", "true");
    host.setAttribute("aria-labelledby", "famoDeliveryTitle");
    document.body.appendChild(host);
    host.addEventListener("click", e => {
      if (e.target === host) close();
    });
    return host;
  }

  function close() {
    if (!host) return;
    host.className = "hidden";
    host.innerHTML = "";
    current = null;
    document.body.style.overflow = "";
  }

  async function submit(opts) {
    if (busy || !current) return;
    const recipientEl = document.getElementById("famoDeliveryRecipient");
    const proofEl = document.getElementById("famoDeliveryProof");
    const recipient = recipientEl ? recipientEl.value.trim() : "";
    const proofUrl = proofEl ? proofEl.value.trim() : "";
    if (!recipient) {
      if (recipientEl) recipientEl.focus();
      return;
    }
    if (proofUrl && !/^https:\/\//i.test(proofUrl)) {
      toast("Gebruik een https://-link voor het bewijs.", true);
      return;
    }
    busy = true;
    const btn = document.getElementById("famoDeliverySubmit");
    host.querySelectorAll("button").forEach(b => { b.disabled = true; });
    try {
      const r = await root.api("/api/updateorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          statut: "Facturée",
          deliveryConfirmed: true,
          recipient,
          proofUrl
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Bijwerken mislukt.");
      const order = current;
      close();
      if (typeof opts.onDone === "function") {
        await opts.onDone(d, order);
      }
    } catch (e) {
      const msg = root.translateError(e.message || "Netwerkfout.");
      if (typeof opts.onError === "function") opts.onError(msg, e);
      else toast(msg, true);
    } finally {
      busy = false;
      if (host && !host.classList.contains("hidden")) {
        host.querySelectorAll("button").forEach(b => { b.disabled = false; });
        if (btn) btn.disabled = false;
      }
    }
  }

  function openDeliveryConfirm(order, opts) {
    opts = opts || {};
    if (!order || !order.id) return;
    current = order;
    const el = ensureHost();
    const ref = esc(order.ref);
    const client = esc(order.client);
    el.className = "famo-delivery-modal";
    el.innerHTML =
      '<div class="famo-delivery-sheet">' +
        '<h2 id="famoDeliveryTitle">Levering bevestigen</h2>' +
        '<p>' + ref + " · " + client + ". Een ontvanger is verplicht; een https-bewijslink is optioneel.</p>" +
        '<label>Ontvangen door<input id="famoDeliveryRecipient" type="text" placeholder="Naam ontvanger" autocomplete="name"></label>' +
        root.proofFieldsHtml({ id: "famoDeliveryProof", fileId: "famoDeliveryProofFile", previewId: "famoDeliveryProofPreview", noteId: "famoDeliveryProofNote" }) +
        '<div class="famo-delivery-actions">' +
          '<button type="button" class="staff-action-secondary" id="famoDeliveryCancel">Annuleren</button>' +
          '<button type="button" class="staff-action" id="famoDeliverySubmit">Bevestigen en factureren</button>' +
        "</div>" +
      "</div>";
    document.body.style.overflow = "hidden";
    root.bindProofFile("famoDeliveryProofFile", "famoDeliveryProofPreview", "famoDeliveryProofNote");
    document.getElementById("famoDeliveryCancel").onclick = close;
    document.getElementById("famoDeliverySubmit").onclick = () => submit(opts);
    const input = document.getElementById("famoDeliveryRecipient");
    if (input) {
      if (order.receptionnePar) input.value = order.receptionnePar;
      input.focus();
    }
    document.addEventListener("keydown", onKeydown);
    function onKeydown(e) {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", onKeydown);
        close();
      }
    }
  }

  root.openDeliveryConfirm = openDeliveryConfirm;
  root.closeDeliveryConfirm = close;
  root.deliveryToast = toast;
})(typeof window !== "undefined" ? window : global);
