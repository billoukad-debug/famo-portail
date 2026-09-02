"use strict";
process.env.AIRTABLE_TOKEN = "t";
process.env.ADMIN_CODE = "admin-code-1234";
process.env.STAFF_CODE = "staff-code-1234";
const test = require("node:test");
const assert = require("node:assert/strict");
const auth = require("../lib/auth");

test("sessie: ondertekenen en verifiëren", () => {
  const tok = auth.sign({ k: "klant", id: "rec1", exp: Date.now() + 1000 });
  assert.equal(auth.verify(tok).id, "rec1");
  assert.equal(auth.verify(tok.slice(0, -2) + "xx"), null);
  assert.equal(auth.verify(auth.sign({ k: "klant", id: "rec1", exp: Date.now() - 1 })), null);
  const req = { headers: { cookie: "a=1; " + auth.COOKIE_CLIENT + "=" + encodeURIComponent(tok) } };
  assert.equal(auth.clientSession(req).clientId, "rec1");
  assert.equal(auth.teamSession(req), null);
});

test("teamsessie en cookies", () => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; } };
  auth.setTeamSession(res, "admin");
  auth.setClientSession(res, "recX");
  const cookies = res.headers["Set-Cookie"];
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /HttpOnly; SameSite=Lax/);
  const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");
  const req = { headers: { cookie: cookieHeader } };
  assert.equal(auth.teamSession(req).role, "admin");
  assert.equal(auth.isAdmin(req), true);
  assert.equal(auth.clientSession(req).clientId, "recX");
});

test("codes: omgeving, hash vervangt omgeving, geen lekken", () => {
  assert.equal(auth.roleForCode("admin-code-1234", {}), "admin");
  assert.equal(auth.roleForCode("staff-code-1234", {}), "staff");
  assert.equal(auth.roleForCode("fout", {}), null);
  assert.equal(auth.roleForCode("", {}), null);
  const h = auth.hashCode("nieuwe-teamcode-xyz");
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(auth.roleForCode("staff-code-1234", { staffHash: h }), null, "omgevingscode vervalt zodra een hash bestaat");
  assert.equal(auth.roleForCode("nieuwe-teamcode-xyz", { staffHash: h }), "staff");
  assert.equal(auth.roleForCode("admin-code-1234", { staffHash: h }), "admin");
  assert.equal(auth.verifyHash("rommel", "x"), false);
});

test("wachtwoorden: klare tekst (compatibel) of scrypt", () => {
  assert.equal(auth.passwordMatches("welkom123", "welkom123"), true);
  assert.equal(auth.passwordMatches("welkom123", "Welkom123"), false);
  assert.equal(auth.passwordMatches("", "x"), false);
  assert.equal(auth.passwordMatches("welkom123", ""), false);
  assert.equal(auth.passwordMatches(auth.hashCode("geheim!!"), "geheim!!"), true);
  assert.equal(auth.generatePassword(10).length, 10);
});

test("documentlinks", () => {
  const t = auth.docToken("factuur", "rec1");
  assert.equal(auth.verifyDocToken(t, "factuur", "rec1"), true);
  assert.equal(auth.verifyDocToken(t, "leveringsbon", "rec1"), false);
  assert.equal(auth.verifyDocToken(t, "factuur", "rec2"), false);
});

test("drempel tegen misbruik", () => {
  for (let i = 0; i < 3; i++) assert.equal(auth.rateLimited("k", 3, 60000), false);
  assert.equal(auth.rateLimited("k", 3, 60000), true);
  auth.rateReset("k");
  assert.equal(auth.rateLimited("k", 3, 60000), false);
});
