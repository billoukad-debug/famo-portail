"use strict";
// Lokale nabootsing van de Resend API: vangt e-mails op en toont ze op /inbox.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

class FakeResend {
  constructor({ file } = {}) {
    this.file = file || null;
    this.mails = [];
    this.failNext = 0;
    if (this.file && fs.existsSync(this.file)) { try { this.mails = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (_) { this.mails = []; } }
  }
  save() { if (this.file) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.mails, null, 1)); } }
  reset() { this.mails = []; this.save(); }
}

function startServer(box, { port = 0, key = "dev-resend" } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/inbox.json") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(box.mails)); }
    if (req.method === "GET" && url.pathname.startsWith("/inbox/")) {
      const m = box.mails.find((x) => x.id === url.pathname.slice(7));
      if (!m) { res.writeHead(404); return res.end("niet gevonden"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(m.html || "<pre>" + esc(m.text) + "</pre>");
    }
    if (req.method === "GET" && url.pathname === "/inbox") {
      const rows = box.mails.slice().reverse().map((m) => `<li><a href="/inbox/${m.id}" target="f"><b>${esc(m.subject)}</b></a><br><small>aan ${esc((m.to || []).join(", "))} · van ${esc(m.from)}${m.reply_to ? " · antwoord aan " + esc(m.reply_to) : ""} · ${esc(m.receivedAt)}</small></li>`).join("");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><meta charset="utf-8"><title>Postvak (lokaal)</title><style>body{font:14px system-ui;margin:0;display:grid;grid-template-columns:380px 1fr;height:100vh}ul{list-style:none;margin:0;padding:12px;overflow:auto;border-right:1px solid #ddd}li{padding:8px 0;border-bottom:1px solid #eee}iframe{width:100%;height:100%;border:0}</style><ul>${rows || "<li>Nog geen e-mails.</li>"}</ul><iframe name="f"></iframe>`);
    }
    if (req.method === "POST" && url.pathname === "/emails") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const auth = String(req.headers.authorization || "");
        if (auth !== "Bearer " + key) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ statusCode: 401, message: "Missing API key" })); }
        if (box.failNext > 0) { box.failNext--; res.writeHead(500, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ statusCode: 500, message: "Simulated failure" })); }
        let body = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (_) { res.writeHead(400); return res.end("{}"); }
        const bad = (Array.isArray(body.to) ? body.to : [body.to]).find((t) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(t || "")));
        if (bad !== undefined) { res.writeHead(422, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ statusCode: 422, name: "validation_error", message: "Invalid `to` field" })); }
        const idem = req.headers["idempotency-key"];
        const dup = idem && box.mails.find((m) => m.idempotencyKey === idem);
        if (dup) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ id: dup.id })); }
        const m = Object.assign({ id: crypto.randomUUID(), receivedAt: new Date().toISOString(), idempotencyKey: idem || "" }, body);
        box.mails.push(m); box.save();
        res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: m.id }));
      });
      return;
    }
    res.writeHead(404); res.end("niet gevonden");
  });
  return new Promise((resolve, reject) => { server.on("error", reject); server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` })); });
}

module.exports = { FakeResend, startServer };
