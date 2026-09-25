// Photo produit stockée dans la base Postgres/SQLite (voir lib/at-engine.js, upload).
// GET /api/foto?id=att… -> l'image, en cache long : un id ne change jamais de contenu
// (une nouvelle photo reçoit un nouvel id). Public, comme le catalogue public d'un
// grossiste : l'id est aléatoire et imprévisible, et rien de personnel n'y figure.
const ds = require("../lib/datastore");
const { Buffer } = require("buffer");

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).json({ error: "Methode niet toegestaan" });
  const id = String((req.query || {}).id || "");
  if (!/^att[A-Za-z0-9]{14}$/.test(id)) return res.status(400).json({ error: "Ongeldige foto" });
  const store = ds.state.store;
  if (!store) return res.status(404).json({ error: "Foto niet gevonden" });
  try {
    const f = await store.getFile(id);
    if (!f || !/^image\/(jpeg|png|webp)$/.test(f.contentType)) return res.status(404).json({ error: "Foto niet gevonden" });
    const buf = Buffer.from(f.data, "base64");
    res.setHeader("Content-Type", f.contentType);
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.statusCode = 200;
    return res.end(req.method === "HEAD" ? undefined : buf);
  } catch (e) {
    console.error("[foto]", e);
    return res.status(500).json({ error: "Foto kon niet geladen worden" });
  }
};
