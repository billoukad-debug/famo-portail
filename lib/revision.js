"use strict";
// Révision des commandes : un compteur incrémenté (atomiquement) à chaque écriture sur une
// commande. Les écrans du personnel se rafraîchissent toutes les 60 s ; si la révision n'a pas
// bougé, /api/allorders répond { unchanged } après UNE lecture au lieu de relire toute l'année
// de commandes (audit E-03 : trafic Neon et quota). Moteur SQL seulement ; Airtable : null.
const atomic = require("./atomic");
const TABLE = "Compteurs", ID = "reccntordersrev";

async function current() {
  const s = atomic.store();
  if (!s) return null;
  try { const r = await s.get(TABLE, ID); return r ? Number(r.fields.Waarde) || 0 : 0; } catch (e) { return null; }
}

async function bump() {
  const s = atomic.store();
  if (!s) return null;
  try {
    const r = await atomic.adjust(TABLE, ID, "Waarde", 1);
    if (r && r.ok) return r.after;
    try { await s.insert(TABLE, [{ id: ID, createdTime: new Date().toISOString(), fields: { Serie: "orders-rev", Waarde: 1 } }]); return 1; }
    catch (e) { const again = await atomic.adjust(TABLE, ID, "Waarde", 1); return again && again.ok ? again.after : null; }
  } catch (e) { console.error("[revision]", e && e.message || e); return null; }
}

module.exports = { current, bump };
