/* global module, self */
// File hors ligne des confirmations de livraison (audit H-12). Logique pure, testable sous
// Node (test/offline-queue.test.js) : le stockage et l'envoi sont injectés.
//   - add(item)        : garde { id, orderId, body, proofs, at } (clé d'idempotence = id)
//   - replay(send)     : rejoue dans l'ordre ; send(item) → "ok" | "retry" | "drop"
// Rien de secret n'est gardé : le cookie de session (HttpOnly) suffit au rejeu.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FamoQueue = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const MAX_ITEMS = 50;
  function create(storage, key) {
    const K = key || "famoOfflineQueue";
    const read = () => { try { const v = JSON.parse(storage.getItem(K) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
    const write = (list) => { try { storage.setItem(K, JSON.stringify(list)); return true; } catch (e) { return false; } };
    let busy = false;
    return {
      list: read,
      size: () => read().length,
      has: (orderId) => read().some((x) => x.orderId === orderId),
      add(item) {
        const list = read().filter((x) => x.orderId !== item.orderId); // une confirmation par commande
        const it = Object.assign({ id: String(Date.now().toString(36) + Math.random().toString(36).slice(2, 8)), at: new Date().toISOString() }, item);
        list.push(it);
        if (list.length > MAX_ITEMS) return { ok: false, reason: "full" };
        if (write(list)) return { ok: true, item: it };
        // Stockage plein (photo trop lourde) : on garde la confirmation sans les pièces jointes.
        it.proofs = []; it.proofsDropped = true;
        return write(list) ? { ok: true, item: it, proofsDropped: true } : { ok: false, reason: "storage" };
      },
      remove(id) { write(read().filter((x) => x.id !== id)); },
      async replay(send) {
        if (busy) return { sent: 0, left: read().length, busy: true };
        busy = true;
        let sent = 0, dropped = 0;
        try {
          for (const it of read()) {
            let r;
            try { r = await send(it); } catch (e) { r = "retry"; }
            if (r === "retry") break; // toujours hors ligne : on garde l'ordre
            this.remove(it.id);
            if (r === "ok") sent++; else dropped++;
          }
        } finally { busy = false; }
        return { sent, dropped, left: read().length };
      }
    };
  }
  return { create, MAX_ITEMS };
});
