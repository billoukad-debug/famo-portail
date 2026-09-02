// Eenmalig: vervangt letterlijke controletekens in domain.js door escapes.
const fs = require("fs");
const p = require("path").join(__dirname, "..", "lib", "domain.js");
let s = fs.readFileSync(p, "utf8");
s = s.replace(/function clean\(value, max\) \{[^\n]*\n/, 'function clean(value, max) { return String(value == null ? "" : value).replace(/\\u00a0/g, " ").replace(/[\\u0000-\\u0008\\u000b-\\u001f\\u007f]/g, "").trim().slice(0, max || 200); }\n');
s = s.replace(/function cleanMultiline\(value, max\) \{[^\n]*\n/, 'function cleanMultiline(value, max) { return String(value == null ? "" : value).replace(/\\r\\n?/g, "\\n").replace(/\\u00a0/g, " ").replace(/[\\u0000-\\u0008\\u000b-\\u001f\\u007f]/g, "").trim().slice(0, max || 1000); }\n');
s = s.replace(/normalize\("NFD"\)\.replace\(\/\[[^\]]*\]\/g, ""\)/, 'normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")');
fs.writeFileSync(p, s);
const bad = [...s].filter((ch) => { const c = ch.charCodeAt(0); return (c < 32 && c !== 10 && c !== 9) || c === 127; });
console.log("control chars left:", bad.length);
