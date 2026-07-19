// Config minimale : on ne cherche pas le style, uniquement les vraies erreurs
// (variable non definie, variable inutilisee, code inatteignable).
const browser = {
  window:"readonly", document:"readonly", fetch:"readonly", localStorage:"readonly",
  alert:"readonly", console:"readonly", setTimeout:"readonly", Date:"readonly",
  Math:"readonly", JSON:"readonly", Number:"readonly", String:"readonly",
  Object:"readonly", Array:"readonly", Map:"readonly", Set:"readonly",
  parseInt:"readonly", parseFloat:"readonly", encodeURIComponent:"readonly", isNaN:"readonly"
};
const node = { module:"writable", require:"readonly", process:"readonly", __dirname:"readonly", fetch:"readonly", console:"readonly", Date:"readonly", Math:"readonly", JSON:"readonly", Number:"readonly", String:"readonly", Object:"readonly", Array:"readonly", Map:"readonly", Set:"readonly", encodeURIComponent:"readonly" };

module.exports = [
  {
    files: ["api/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: node },
    rules: { "no-undef": "error", "no-unreachable": "error", "no-dupe-keys": "error", "no-const-assign": "error" }
  },
  {
    files: ["scripts/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: node },
    rules: { "no-undef": "error" }
  }
];
