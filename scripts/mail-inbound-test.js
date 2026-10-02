#!/usr/bin/env node
"use strict";
// Bestelling per e-mail nabootsen tegen de LOKALE portaal (specs/020-bestellen-per-mail), zonder Resend
// of Anthropic : de mail wordt in de nagebootste Resend gelegd (scripts/fake-resend.js), daarna wordt
// de webhook « email.received » ondertekend (Svix, geheim van de ontwikkelomgeving) en gepost naar
// /api/inbound-mail. scripts/dev.js moet draaien (het schrijft .dev-data/dev-ports.json).
//
//   node scripts/mail-inbound-test.js
//   node scripts/mail-inbound-test.js --from keuken@alohapoke.example --text "3 kg saumon frais\n2 kisten scampi" --subject "Bestelling"
//   node scripts/mail-inbound-test.js --from onbekend@example.com          (onbekende afzender → Te controleren)
//   node scripts/mail-inbound-test.js --dmarc fail                         (vervalst → Te controleren)
//   node scripts/mail-inbound-test.js --text "WEIGER"                      (AI weigert → Te controleren)
//   node scripts/mail-inbound-test.js --twice                              (zelfde webhook twee keer : één bestelling)
// Weigert elke niet-lokale bestemming : nooit naar productie.
const fs = require("fs");
const path = require("path");
const svix = require("../lib/inbound/svix");

const ROOT = path.join(__dirname, "..");
// Zelfde publiek bekend ontwikkelgeheim als scripts/dev.js (nooit in productie).
const DEV_SECRET = "whsec_" + Buffer.from("famo-dev-inbound-secret-0123456789").toString("base64");

function args() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--help" || a[i] === "-h") o.help = true;
    else if (a[i] === "--twice") o.twice = true;
    else if (a[i].startsWith("--")) o[a[i].slice(2)] = a[i + 1], i++;
  }
  return o;
}

async function main() {
  const o = args();
  if (o.help) { console.log(fs.readFileSync(__filename, "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); return; }
  const portsFile = path.join(ROOT, ".dev-data", "dev-ports.json");
  if (!fs.existsSync(portsFile)) throw new Error("Start eerst node scripts/dev.js (" + portsFile + " ontbreekt)");
  const ports = JSON.parse(fs.readFileSync(portsFile, "utf8"));
  const base = String(o.base || process.env.BASE || ports.portal);
  for (const u of [base, ports.resend]) if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u.replace(/\/+$/, ""))) throw new Error("Enkel lokaal: " + u);
  const from = o.from || "Keuken Aloha <keuken@alohapoke.example>";
  const text = (o.text || "Goedemiddag,\n\nVoor morgen graag:\n3 kg saumon frais\n2 kg cabillaud\n\nLevering voor 9u aan de achterdeur.\n\nGroeten,\nKeuken Aloha").replace(/\\n/g, "\n");
  const subject = o.subject || "Bestelling";
  const auth = { spf: o.spf || "pass", dkim: o.dkim || "pass", dmarc: o.dmarc || "pass" };
  // 1. De mail « komt binnen » bij de nagebootste Resend.
  const r = await fetch(ports.resend.replace(/\/+$/, "") + "/__receive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from, to: ["bestel@orders.famoseafood.be"], subject, text, authentication: auth, headers: o.header ? { [o.header.split(":")[0]]: o.header.split(":").slice(1).join(":").trim() } : {} }) });
  const got = await r.json();
  // 2. Resend → portaal : ondertekende webhook (enkel metadata, zoals in productie).
  const payload = { type: "email.received", created_at: new Date().toISOString(), data: { email_id: got.id, created_at: got.created_at, from, to: ["bestel@orders.famoseafood.be"], cc: [], bcc: [], message_id: got.message_id, subject, attachments: [] } };
  const raw = JSON.stringify(payload);
  const send = async () => {
    const id = "msg_dev_" + Date.now() + Math.random().toString(36).slice(2, 6), ts = String(Math.floor(Date.now() / 1000));
    const res = await fetch(base.replace(/\/+$/, "") + "/api/inbound-mail", { method: "POST", headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": ts, "svix-signature": "v1," + svix.sign(process.env.RESEND_INBOUND_SECRET || DEV_SECRET, id, ts, raw) }, body: raw });
    console.log("webhook →", res.status, JSON.stringify(await res.json().catch(() => ({}))));
  };
  await send();
  if (o.twice) await send();
  console.log("Bekijk: " + base + "/team/bestellingen#/controle · postvak " + ports.resend + "/inbox");
}

main().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
