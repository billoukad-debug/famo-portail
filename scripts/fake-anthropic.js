"use strict";
// Lokale nabootsing van de Anthropic Messages API (POST /v1/messages) voor scripts/dev.js :
// bestellen per e-mail (specs/020) demonstreren zonder sleutel en zonder kosten. Geen echt model :
// een eenvoudige lezer die regels « 3 kg tong » of « 24 oesters » koppelt aan de catalogus uit de
// systeemprompt en antwoordt in exact de vorm van de API (thinking-blok + JSON-tekst, stop_reason, usage).
// Een mail met « WEIGER » geeft een refusal, « TRAAG » antwoordt pas na 30 s (time-out van het portaal).
const http = require("http");

const UNIT_WORDS = [[/^(kg|kilo|kilos|kilo's)$/i, "kg"], [/^(st|stuk|stuks|pc|pcs|pièces?|pieces?)$/i, "pièce"], [/^(kist|kisten|kassa|kassas|bak|bakken|caisses?)$/i, "caisse"], [/^(doos|dozen|cartons?)$/i, "carton"]];
const words = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9/]+/).filter((w) => w.length >= 3);

function catalogueOf(system) {
  const text = (Array.isArray(system) ? system : [{ text: String(system || "") }]).map((b) => b.text || "").join("\n");
  return text.split("\n").filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
}

function read(body) {
  const products = catalogueOf(body.system);
  const msg = String(((body.messages || [])[0] || {}).content || "");
  const today = (/Vandaag \(Brussel\): (\d{4}-\d{2}-\d{2})/.exec(msg) || [])[1] || new Date().toISOString().slice(0, 10);
  const mail = (/<email>\n?([\s\S]*?)\n?<\/email>/.exec(msg) || [])[1] || "";
  const lines = [];
  for (const raw of mail.split(/\n|,|;| en | et /i)) {
    const m = /(\d+(?:[.,]\d+)?)\s*([a-zA-Zèé']+)?\s+(.*)/.exec(raw.trim());
    if (!m || /levering|livraison|leveren|livrer|\d{1,2}\s*[uh]\b/i.test(raw)) continue;
    const qty = Number(m[1].replace(",", "."));
    let unit = "", rest = m[3];
    const u = UNIT_WORDS.find(([re]) => re.test(m[2] || ""));
    if (u) unit = u[1]; else rest = (m[2] || "") + " " + rest;
    const w = words(rest).filter((x) => !["van", "graag", "voor", "pour", "des", "les", "met", "een"].includes(x));
    if (!w.length) continue;
    const scored = products.map((p) => ({ p, s: words(p.naam + " " + (p.kaliber || "")).filter((x) => w.some((y) => y === x || (y.length >= 4 && x.startsWith(y.slice(0, 4))))).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const best = scored[0], tie = best && scored[1] && scored[1].s === best.s;
    if (!best && !unit) continue; // geen artikel en geen eenheid : geen bestelregel
    lines.push({ productId: best ? best.p.id : null, naam_in_mail: rest.trim().slice(0, 80), qty, unit, confidence: !best ? 0.2 : tie ? 0.55 : 0.92, opmerking: /gepeld|gefileerd|filets?/i.test(rest) ? (rest.match(/gepeld|gefileerd|filets?/i) || [""])[0] : "", note: tie ? "meerdere artikels mogelijk (" + scored.slice(0, 3).map((x) => x.p.naam).join(", ") + ")" : best ? "" : "niet in de catalogus" });
  }
  let leverdag = null;
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(mail);
  if (iso) leverdag = iso[1];
  else if (/\b(morgen|demain|tomorrow)\b/i.test(mail)) { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); leverdag = d.toISOString().slice(0, 10); }
  const opm = (/(?:levering|livraison|leveren|livrer)[^\n]*/i.exec(mail) || [""])[0].slice(0, 200);
  return { lines, leverdag, opmerkingen: opm, onduidelijk: !lines.length };
}

function startServer({ port = 0 } = {}) {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/messages") { res.writeHead(404); return res.end("{}"); }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const send = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json", "request-id": "req_dev_" + Date.now() }); res.end(JSON.stringify(obj)); };
      if (!req.headers["x-api-key"]) return send(401, { type: "error", error: { type: "authentication_error", message: "x-api-key ontbreekt" } });
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) { return send(400, { type: "error", error: { type: "invalid_request_error", message: "JSON" } }); }
      if (body.thinking && body.thinking.type === "disabled") return send(400, { type: "error", error: { type: "invalid_request_error", message: "thinking cannot be disabled for this model" } });
      const msg = String(((body.messages || [])[0] || {}).content || "");
      const usage = { input_tokens: 350, output_tokens: 220, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 };
      if (/WEIGER/.test(msg)) return send(200, { id: "msg_dev", type: "message", role: "assistant", model: body.model, content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: "dev" }, usage });
      const out = () => send(200, { id: "msg_dev", type: "message", role: "assistant", model: body.model, content: [{ type: "thinking", thinking: "", signature: "dev" }, { type: "text", text: JSON.stringify(read(body)) }], stop_reason: "end_turn", stop_details: null, usage });
      if (/TRAAG/.test(msg)) setTimeout(out, 30000); else out();
    });
  });
  return new Promise((resolve, reject) => { server.on("error", reject); server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` })); });
}

module.exports = { startServer, read };
