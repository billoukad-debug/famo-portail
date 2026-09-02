// Shared company helpers for staff docs. Example IBAN/BIC unlock daily invoice flow
// until real bank details are saved via Beheer.
(function (global) {
  const EXAMPLE = {
    iban: "BE68 5390 0754 7034",
    bic: "GKCCBEBB",
    label: "Voorbeeldbankgegevens — vervang het IBAN via Beheer vóór u echt factureert."
  };

  function normalize(cfg) {
    cfg = cfg || {};
    return {
      nom: String(cfg.nom || cfg.bedrijfsnaam || "").trim(),
      adresse: String(cfg.adresse || cfg.adres || "").trim(),
      cp: String(cfg.cp || cfg.plaats || "").trim(),
      tva: String(cfg.tva || cfg.btw || "").trim(),
      tel: String(cfg.tel || cfg.telefoon || "").trim(),
      email: String(cfg.email || "").trim(),
      iban: String(cfg.iban || "").trim(),
      bic: String(cfg.bic || "").trim()
    };
  }

  function withExampleBank(company) {
    const c = Object.assign({}, company || {});
    const missing = !c.iban || !c.bic;
    if (missing) {
      c.iban = EXAMPLE.iban;
      c.bic = EXAMPLE.bic;
      c.exampleBank = true;
    } else {
      c.exampleBank = false;
    }
    return c;
  }

  global.famoCompany = { EXAMPLE, normalize, withExampleBank };
})(typeof window !== "undefined" ? window : global);
