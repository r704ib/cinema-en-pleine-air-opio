"use strict";

const SITE_URL = "https://cinema-en-pleine-air-opio.oria-events.fr";
const ORIA_EMAIL = "Oria.ei@outlook.fr";

function buildCancelUrl(reservationId) {
  return SITE_URL + "/annuler.html?id=" + reservationId;
}

function buildVisitorConfirmationEmail(reservation, reservationId) {
  const cancelUrl = buildCancelUrl(reservationId);
  return {
    to: reservation.email,
    subject: "Votre réservation pour le Cinéma en plein air d'Opio",
    htmlContent:
      "<p>Bonjour " + reservation.prenom + ",</p>" +
      "<p>Votre réservation pour le 28 juillet 2026 est confirmée : " +
      reservation.totalPlaces + " place(s) (" +
      reservation.nb_adultes + " adulte(s), " +
      reservation.nb_enfants_3_10 + " enfant(s) 3-10 ans, " +
      reservation.nb_enfants_moins_3 + " enfant(s) moins de 3 ans).</p>" +
      "<p>Montant estimé à régler sur place : " + reservation.montantEstime + " €.</p>" +
      "<p>Si vous ne pouvez finalement pas venir, merci d'annuler votre place ici : " +
      "<a href=\"" + cancelUrl + "\">" + cancelUrl + "</a></p>" +
      "<p>À très vite sous les étoiles d'Opio !</p>",
  };
}

function buildOriaNewReservationEmail(reservation) {
  return {
    to: ORIA_EMAIL,
    subject: "Nouvelle réservation : " + reservation.prenom + " " + reservation.nom,
    htmlContent:
      "<p>Nouvelle réservation reçue.</p>" +
      "<ul>" +
      "<li>Nom : " + reservation.prenom + " " + reservation.nom + "</li>" +
      "<li>Email : " + reservation.email + "</li>" +
      "<li>Téléphone : " + reservation.telephone + "</li>" +
      "<li>Adultes : " + reservation.nb_adultes + "</li>" +
      "<li>Enfants 3-10 ans : " + reservation.nb_enfants_3_10 + "</li>" +
      "<li>Enfants moins de 3 ans : " + reservation.nb_enfants_moins_3 + "</li>" +
      "<li>Montant estimé : " + reservation.montantEstime + " €</li>" +
      "</ul>",
  };
}

function buildOriaCancellationEmail(reservation) {
  return {
    to: ORIA_EMAIL,
    subject: "Annulation : " + reservation.prenom + " " + reservation.nom,
    htmlContent:
      "<p>Une réservation vient d'être annulée.</p>" +
      "<ul>" +
      "<li>Nom : " + reservation.prenom + " " + reservation.nom + "</li>" +
      "<li>Places libérées : " + reservation.totalPlaces + "</li>" +
      "</ul>",
  };
}

function buildFeedbackRequestEmail(reservation, reservationId) {
  const url = SITE_URL + "/avis.html?id=" + reservationId;
  return {
    to: reservation.email,
    subject: "Votre avis sur le Cinéma en plein air d'Opio",
    htmlContent:
      "<p>Bonjour " + reservation.prenom + ",</p>" +
      "<p>Merci d'être venu(e) à la séance ! Votre avis nous aiderait beaucoup à " +
      "améliorer les prochaines projections.</p>" +
      "<p>Cela ne prend qu'une minute : " +
      "<a href=\"" + url + "\">donnez votre avis ici</a>.</p>" +
      "<p>À très vite sous les étoiles d'Opio !</p>",
  };
}

function buildFeedbackReminderEmail(reservation, reservationId) {
  const url = SITE_URL + "/avis.html?id=" + reservationId;
  const stopUrl = url + "&stop=1";
  return {
    to: reservation.email,
    subject: "Petit rappel : votre avis sur le Cinéma en plein air d'Opio",
    htmlContent:
      "<p>Bonjour " + reservation.prenom + ",</p>" +
      "<p>Vous n'avez pas encore donné votre avis sur la séance — votre retour " +
      "compte beaucoup pour nous !</p>" +
      "<p><a href=\"" + url + "\">Donner mon avis</a> (une minute suffit).</p>" +
      "<p>Si vous ne souhaitez plus recevoir ces messages, " +
      "<a href=\"" + stopUrl + "\">cliquez ici</a>.</p>",
  };
}

module.exports = {
  buildCancelUrl,
  buildVisitorConfirmationEmail,
  buildOriaNewReservationEmail,
  buildOriaCancellationEmail,
  buildFeedbackRequestEmail,
  buildFeedbackReminderEmail,
};
