// Config minimale : on ne cherche pas le style, uniquement les vraies erreurs
// (variable non définie, variable inutilisée, code inatteignable, clé en double).
// Couvre le serveur (api, lib, scripts, test) ET le navigateur (assets, *.js à la racine).
const common = {
  console: "readonly", Date: "readonly", Math: "readonly", JSON: "readonly", Number: "readonly", String: "readonly",
  Object: "readonly", Array: "readonly", Map: "readonly", Set: "readonly", WeakMap: "readonly", Promise: "readonly",
  parseInt: "readonly", parseFloat: "readonly", isNaN: "readonly", encodeURIComponent: "readonly", decodeURIComponent: "readonly",
  setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
  Intl: "readonly", URL: "readonly", URLSearchParams: "readonly", fetch: "readonly", Response: "readonly",
  TextEncoder: "readonly", TextDecoder: "readonly", Symbol: "readonly", Error: "readonly", RegExp: "readonly", Boolean: "readonly",
  Infinity: "readonly", NaN: "readonly", globalThis: "readonly", structuredClone: "readonly", AbortController: "readonly"
};
const node = Object.assign({}, common, {
  module: "writable", require: "readonly", process: "readonly", __dirname: "readonly", __filename: "readonly",
  Buffer: "readonly", exports: "writable", setImmediate: "readonly", AbortSignal: "readonly"
});
const browser = Object.assign({}, common, {
  window: "readonly", document: "readonly", localStorage: "readonly", sessionStorage: "readonly", navigator: "readonly",
  location: "readonly", history: "readonly", alert: "readonly", requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
  getComputedStyle: "readonly", FileReader: "readonly", Blob: "readonly", Image: "readonly", HTMLElement: "readonly",
  btoa: "readonly", atob: "readonly", performance: "readonly", innerHeight: "readonly", scrollBy: "readonly",
  CSS: "readonly", CustomEvent: "readonly", global: "readonly", // global : repli des modules UMD (window ?? global)
  // globaux du portail (déclarés par ui.js, staff-common.js, documents.js, staff-doc-preview.js, staff-company.js)
  K: "writable", S: "writable", FamoDocuments: "writable", famoDocPreview: "writable", famoCompany: "writable",
  famoNL: "writable", FAMO_NL: "writable", html2pdf: "readonly"
});
const errors = { "no-undef": "error", "no-unreachable": "error", "no-dupe-keys": "error", "no-const-assign": "error", "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }] };

module.exports = [
  { ignores: ["vendor/**", ".dev-data/**", "node_modules/**"] },
  {
    files: ["api/**/*.js", "lib/**/*.js", "scripts/**/*.js", "test/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "commonjs", globals: node },
    rules: errors
  },
  {
    files: ["assets/**/*.js", "documents.js", "staff-doc-preview.js", "staff-company.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "script", globals: browser },
    rules: errors
  }
];
