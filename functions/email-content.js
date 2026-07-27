"use strict";

const SITE_URL = "https://cinema-en-pleine-air-opio.oria-events.fr";
const ORIA_EMAIL = "Oria.ei@outlook.fr";

const {
  emailShell,
  bouton,
  blocBillet,
  blocInfos,
  referenceDepuisId,
} = require("./email-layout");

function detailPlaces(r) {
  const parts = [];
  if (r.nb_adultes > 0) {
    parts.push(r.nb_adultes + (r.nb_adultes > 1 ? " adultes" : " adulte"));
  }
  if (r.nb_enfants_3_10 > 0) {
    parts.push(r.nb_enfants_3_10 + (r.nb_enfants_3_10 > 1 ? " enfants" : " enfant") + " (3-10 ans)");
  }
  if (r.nb_enfants_moins_3 > 0) {
    parts.push(r.nb_enfants_moins_3 + (r.nb_enfants_moins_3 > 1 ? " enfants" : " enfant") + " (moins de 3 ans)");
  }
  return parts.join(", ");
}

function infosPratiques(event) {
  return [
    { picto: "&#128205;", texteHtml: "<strong>" + event.lieu + "</strong>" },
    { picto: "&#128368;", texteHtml: "Portes <strong>" + event.portes + "</strong> · Film <strong>" + event.filmHeure + "</strong> · Fin " + event.finHeure },
    { picto: "&#128663;", texteHtml: "Parking à proximité (Carrefour et Salle polyvalente)" },
    { picto: "&#127871;", texteHtml: "Buvette sur place · chaises fournies" },
    { picto: "&#129509;", texteHtml: "Prévoyez de quoi vous couvrir si les températures baissent" },
  ];
}

function buildCancelUrl(reservationId) {
  return SITE_URL + "/annuler.html?id=" + reservationId;
}

function buildVisitorConfirmationEmail(reservation, reservationId, event) {
  const cancelUrl = buildCancelUrl(reservationId);
  const billet = blocBillet({
    reference: referenceDepuisId(reservationId),
    lignesHtml:
      "<strong>" + reservation.totalPlaces + (reservation.totalPlaces > 1 ? " places" : " place") + "</strong> · " + detailPlaces(reservation) + "<br>" +
      "À régler sur place : <strong>" + reservation.montantEstime + " €</strong>",
  });
  const corps =
    '<p style="font-size:17px; line-height:1.5; margin:0 0 14px;">Bonjour <strong>' +
    reservation.prenom + "</strong>,</p>" +
    '<p style="font-size:16px; line-height:1.6; color:#3b3152; margin:0 0 26px;">' +
    "Votre réservation pour la projection de <strong>« " + event.filmTitre + " »</strong> le " +
    "<strong>" + event.dateLabel + "</strong> est bien confirmée. On a hâte de vous accueillir " +
    "sous les étoiles d'Opio&nbsp;!</p>" +
    billet +
    '<div style="margin:30px 0 6px;">' + blocInfos(infosPratiques(event)) + "</div>" +
    '<p style="font-size:15px; color:#3b3152; margin:26px 0 16px; text-align:center;">' +
    "Un empêchement&nbsp;? Merci de libérer votre place pour d'autres spectateurs.</p>" +
    '<div style="text-align:center;">' + bouton("Annuler ma réservation", cancelUrl) + "</div>";
  return {
    to: reservation.email,
    subject: "Votre réservation pour le Cinéma en plein air d'Opio",
    htmlContent: emailShell({
      titre: 'Réservation confirmée <span style="color:#E8A33D;">&#10022;</span>',
      preheader: "Votre réservation pour le Cinéma en plein air d'Opio est confirmée.",
      corpsHtml: corps,
    }),
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

function buildVisitorCancellationEmail(reservation, reservationId, event) {
  const corps =
    '<p style="font-size:17px; line-height:1.5; margin:0 0 14px;">Bonjour <strong>' +
    reservation.prenom + "</strong>,</p>" +
    '<p style="font-size:16px; line-height:1.6; color:#3b3152; margin:0 0 14px;">' +
    "Votre annulation pour la séance du <strong>" + event.dateLabel + "</strong> est bien prise " +
    "en compte. Vos <strong>" + reservation.totalPlaces + (reservation.totalPlaces > 1 ? " places" : " place") + "</strong> ont été libérées — " +
    "merci de nous avoir prévenus.</p>" +
    '<p style="font-size:16px; line-height:1.6; color:#3b3152; margin:0 0 28px;">' +
    "On espère vous retrouver à une prochaine projection sous les étoiles d'Opio&nbsp;!</p>" +
    '<div style="text-align:center;">' + bouton("Voir les prochaines séances", SITE_URL) + "</div>";
  return {
    to: reservation.email,
    subject: "Votre annulation — Cinéma en plein air d'Opio",
    htmlContent: emailShell({
      titre: "Annulation confirmée",
      preheader: "Votre annulation est bien prise en compte.",
      corpsHtml: corps,
    }),
  };
}

function buildFeedbackRequestEmail(reservation, reservationId, event) {
  const url = SITE_URL + "/avis.html?id=" + reservationId;
  const corps =
    '<p style="font-size:17px; line-height:1.5; margin:0 0 14px;">Bonjour <strong>' +
    reservation.prenom + "</strong>,</p>" +
    '<p style="font-size:16px; line-height:1.6; color:#3b3152; margin:0 0 28px;">' +
    "Merci d'être venu(e) à la séance&nbsp;! Votre retour nous aide beaucoup à préparer de plus " +
    "belles projections. Cela ne prend qu'une minute.</p>" +
    '<div style="text-align:center;">' + bouton("Donner mon avis", url) + "</div>";
  return {
    to: reservation.email,
    subject: "Votre avis sur le Cinéma en plein air d'Opio",
    htmlContent: emailShell({
      titre: 'Votre avis compte <span style="color:#E8A33D;">&#10022;</span>',
      preheader: "Votre avis nous aiderait beaucoup à améliorer les prochaines séances.",
      corpsHtml: corps,
    }),
  };
}

function buildFeedbackReminderEmail(reservation, reservationId, event) {
  const url = SITE_URL + "/avis.html?id=" + reservationId;
  const stopUrl = url + "&stop=1";
  const corps =
    '<p style="font-size:17px; line-height:1.5; margin:0 0 14px;">Bonjour <strong>' +
    reservation.prenom + "</strong>,</p>" +
    '<p style="font-size:16px; line-height:1.6; color:#3b3152; margin:0 0 28px;">' +
    "Vous n'avez pas encore donné votre avis sur la séance — votre retour compte beaucoup " +
    "pour nous&nbsp;! Une minute suffit.</p>" +
    '<div style="text-align:center;">' + bouton("Donner mon avis", url) + "</div>";
  const piedExtra =
    '<br><a href="' + stopUrl + '" style="color:#B8AFC9; text-decoration:underline; font-size:11px;">' +
    "Ne plus recevoir ces messages</a>";
  return {
    to: reservation.email,
    subject: "Petit rappel : votre avis sur le Cinéma en plein air d'Opio",
    htmlContent: emailShell({
      titre: 'Petit rappel <span style="color:#E8A33D;">&#10022;</span>',
      preheader: "Votre avis compte beaucoup pour nous.",
      corpsHtml: corps,
      piedExtraHtml: piedExtra,
    }),
  };
}

module.exports = {
  buildCancelUrl,
  buildVisitorConfirmationEmail,
  buildOriaNewReservationEmail,
  buildOriaCancellationEmail,
  buildVisitorCancellationEmail,
  buildFeedbackRequestEmail,
  buildFeedbackReminderEmail,
};
