// Le questionnaire de cadrage est termine. Endpoint definitivement ferme
// pour empecher toute ecriture non authentifiee dans Airtable.
module.exports = async (req, res) => {
  res.status(410).json({ error: "Deze vragenlijst is afgesloten." });
};
