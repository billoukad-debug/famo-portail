// Numéro de commande lisible, sur le modèle des factures : CMD-2026-0001.
//
// Séquence par année civile (heure de Bruxelles), sur 4 chiffres minimum. Les
// anciennes références CMD-<horodatage> ne sont ni renumérotées ni comptées.
//
// Une seule requête Airtable en temps normal : la plus grande référence à
// 4 chiffres de l'année, par tri décroissant (à longueur égale, l'ordre
// alphabétique est l'ordre numérique). Si elle atteint 9999, une seconde
// requête lit les numéros à 5 chiffres et plus.
//
// Sur le moteur SQL (production : Neon), le numéro vient d'un compteur atomique
// (lib/billing.js reserve) : deux commandes simultanées ne reçoivent plus le même
// numéro (audit B-01). Sur Airtable, pas d'écriture conditionnelle : max + 1, non
// atomique. Si la base ne répond pas, on retombe sur l'ancien format horodaté : une
// commande n'est jamais perdue pour une question de numéro.

function brusselsYear(now) {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", year: "numeric" }).format(now || new Date())
  );
}

// Requête : la plus grande référence CMD-<année>-<n chiffres>.
function lastRefPath(year, digits) {
  const formula = `REGEX_MATCH({Référence}, "^CMD-${year}-[0-9]{${digits}}$")`;
  return "Commandes?filterByFormula=" + encodeURIComponent(formula) +
    "&sort%5B0%5D%5Bfield%5D=" + encodeURIComponent("Référence") +
    "&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=1" +
    "&fields%5B%5D=" + encodeURIComponent("Référence");
}

async function lastNumber(at, year, digits) {
  const page = await at(lastRefPath(year, digits));
  if (!page || page.error) throw new Error((page && page.error && page.error.message) || "Commandes onleesbaar");
  const ref = String(((((page.records || [])[0]) || {}).fields || {})["Référence"] || "");
  const m = ref.match(new RegExp("^CMD-" + year + "-(\\d+)$"));
  return m ? parseInt(m[1], 10) : 0;
}

async function nextOrderRef(at, now) {
  const year = brusselsYear(now);
  try {
    const n = await require("./billing").reserve("CMD-" + year, async () => {
      let m = await lastNumber(at, year, "4");
      if (m >= 9999) m = Math.max(m, await lastNumber(at, year, "5,"));
      return m;
    });
    if (n != null) return `CMD-${year}-${String(n).padStart(4, "0")}`;
    let last = await lastNumber(at, year, "4");
    if (last >= 9999) last = Math.max(last, await lastNumber(at, year, "5,"));
    return `CMD-${year}-${String(last + 1).padStart(4, "0")}`;
  } catch (error) {
    console.error("[ordernumber] numérotation indisponible, référence horodatée :", error.message || error);
    return "CMD-" + Date.now();
  }
}

module.exports = { nextOrderRef, brusselsYear, lastRefPath };
