// On ne cherche pas le style, uniquement les vraies erreurs : les règles
// « eslint:recommended » d'ESLint 9, recopiées ici parce que le dépôt n'a pas de
// node_modules (require("@eslint/js") serait introuvable avec `npx eslint@…`).
// Couvre le serveur (api, lib, scripts, test) ET le navigateur (assets, *.js à la racine).
// Version figée : npx -y eslint@9.39.5 . (même version en CI, voir .github/workflows/check.yml).
//
// Deux règles recommandées restent désactivées tant que le code ne les respecte pas :
//   no-useless-escape (18 cas : api/, assets/ui.js, assets/docs/documents.js…) et
//   no-regex-spaces (2 cas dans test/workflow/corrections.test.js, bloc AN). Les corriger puis les activer.
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
  location: "readonly", history: "readonly", requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
  getComputedStyle: "readonly", FileReader: "readonly", Blob: "readonly", Image: "readonly", HTMLElement: "readonly",
  btoa: "readonly", atob: "readonly", performance: "readonly", innerHeight: "readonly", scrollBy: "readonly",
  CSS: "readonly", CustomEvent: "readonly", global: "readonly", // global : repli des modules UMD (window ?? global)
  // globaux du portail (déclarés par ui.js, staff-common.js, assets/docs/documents.js, assets/docs/voorbeeld.js, assets/docs/bedrijf.js)
  K: "writable", S: "writable", FamoDocuments: "writable", famoDocPreview: "writable", famoCompany: "writable",
  famoNL: "writable", FAMO_NL: "writable", html2pdf: "readonly"
});
// alert/confirm/prompt natifs : absents des globaux (interdits, voir scripts/check.js : K.confirm / K.prompt).
const RECOMMENDED = [
  "constructor-super", "for-direction", "getter-return", "no-async-promise-executor", "no-case-declarations", "no-class-assign",
  "no-compare-neg-zero", "no-cond-assign", "no-const-assign", "no-constant-binary-expression", "no-constant-condition",
  "no-control-regex", "no-debugger", "no-delete-var", "no-dupe-args", "no-dupe-class-members", "no-dupe-else-if", "no-dupe-keys",
  "no-duplicate-case", "no-empty", "no-empty-character-class", "no-empty-pattern", "no-empty-static-block", "no-ex-assign",
  "no-extra-boolean-cast", "no-fallthrough", "no-func-assign", "no-global-assign", "no-import-assign", "no-invalid-regexp",
  "no-irregular-whitespace", "no-loss-of-precision", "no-misleading-character-class", "no-new-native-nonconstructor",
  "no-nonoctal-decimal-escape", "no-obj-calls", "no-octal", "no-prototype-builtins", "no-redeclare", "no-self-assign",
  "no-setter-return", "no-shadow-restricted-names", "no-sparse-arrays", "no-this-before-super", "no-undef",
  "no-unexpected-multiline", "no-unreachable", "no-unsafe-finally", "no-unsafe-negation", "no-unsafe-optional-chaining",
  "no-unused-labels", "no-unused-private-class-members", "no-useless-backreference", "no-useless-catch", "no-with",
  "require-yield", "use-isnan", "valid-typeof"
];
const errors = Object.assign(Object.fromEntries(RECOMMENDED.map(rule => [rule, "error"])), {
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }]
});

module.exports = [
  { ignores: ["vendor/**", ".dev-data/**", "node_modules/**"] },
  {
    files: ["api/**/*.js", "lib/**/*.js", "scripts/**/*.js", "test/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "commonjs", globals: node },
    rules: errors
  },
  {
    files: ["assets/**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "script", globals: browser },
    rules: errors
  }
];
