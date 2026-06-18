"use strict";

const MAX_PLACES = 150;
const MAX_PER_RESERVATION = 10;
const PRICE_ADULTE = 5;
const PRICE_ENFANT = 3;

function validateReservationInput(data) {
  data = data || {};
  const errors = [];

  if (typeof data.prenom !== "string" || data.prenom.trim().length === 0) errors.push("prenom");
  if (typeof data.nom !== "string" || data.nom.trim().length === 0) errors.push("nom");
  if (typeof data.email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) errors.push("email");
  if (typeof data.telephone !== "string" || data.telephone.trim().length === 0) errors.push("telephone");

  const nbAdultes = Number(data.nb_adultes);
  const nbEnfants310 = Number(data.nb_enfants_3_10);
  const nbEnfantsMoins3 = Number(data.nb_enfants_moins_3);

  if (!Number.isInteger(nbAdultes) || nbAdultes < 0) errors.push("nb_adultes");
  if (!Number.isInteger(nbEnfants310) || nbEnfants310 < 0) errors.push("nb_enfants_3_10");
  if (!Number.isInteger(nbEnfantsMoins3) || nbEnfantsMoins3 < 0) errors.push("nb_enfants_moins_3");

  const totalPlaces = nbAdultes + nbEnfants310 + nbEnfantsMoins3;
  if (!Number.isInteger(totalPlaces) || totalPlaces < 1 || totalPlaces > MAX_PER_RESERVATION) {
    errors.push("totalPlaces");
  }

  if (typeof data.hp !== "string" || data.hp !== "") errors.push("hp");

  if (errors.length > 0) {
    return { valid: false, errors: errors };
  }

  return {
    valid: true,
    reservation: {
      prenom: data.prenom.trim(),
      nom: data.nom.trim(),
      email: data.email.trim(),
      telephone: data.telephone.trim(),
      nb_adultes: nbAdultes,
      nb_enfants_3_10: nbEnfants310,
      nb_enfants_moins_3: nbEnfantsMoins3,
      totalPlaces: totalPlaces,
      montantEstime: nbAdultes * PRICE_ADULTE + nbEnfants310 * PRICE_ENFANT,
      status: "active",
      cancelledAt: null,
    },
  };
}

module.exports = {
  validateReservationInput: validateReservationInput,
  MAX_PLACES: MAX_PLACES,
  MAX_PER_RESERVATION: MAX_PER_RESERVATION,
  PRICE_ADULTE: PRICE_ADULTE,
  PRICE_ENFANT: PRICE_ENFANT,
};
