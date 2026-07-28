"use strict";

function prenomInitiale(prenom, nom) {
  const p = (prenom || "").trim();
  if (!p) return "Un spectateur";
  const n = (nom || "").trim();
  if (!n) return p;
  return p + " " + n.charAt(0).toUpperCase() + ".";
}

function seanceLabelFromDateLabel(dateLabel) {
  const d = (dateLabel || "").trim();
  if (!d) return "";
  const sansJour = d.replace(/^\S+\s+/, "");
  return "séance du " + sansJour;
}

function avisPublicFromAvis(avis, seanceLabel) {
  return {
    prenomInitiale: prenomInitiale(avis.prenom, avis.nom),
    note: avis.note,
    commentaire: avis.commentaire,
    seanceLabel: seanceLabel || "",
    avisCreatedAt: avis.createdAt || null,
  };
}

module.exports = { prenomInitiale, seanceLabelFromDateLabel, avisPublicFromAvis };
