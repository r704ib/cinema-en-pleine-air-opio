"use strict";

const SITE_URL = "https://cinema-en-pleine-air-opio.oria-events.fr";
const CONTACT_EMAIL = "contact@opio.oria-events.fr";

const C = {
  violet: "#241A38",
  or: "#E8A33D",
  orFonce: "#C98A2B",
  creme: "#FBF7EF",
  ivoire: "#F6F1E7",
  lavande: "#9B86C9",
  texte: "#3b3152",
  muted: "#B8AFC9",
};

function referenceDepuisId(reservationId) {
  return String(reservationId).slice(0, 6).toUpperCase();
}

function bouton(texte, url) {
  return (
    '<a href="' + url + '" style="display:inline-block; background:' + C.or +
    "; color:" + C.violet +
    '; font-size:15px; font-weight:bold; text-decoration:none; padding:13px 30px; border-radius:8px;">' +
    texte + "</a>"
  );
}

function blocBillet(options) {
  const zoneQr = options.qrDataUri
    ? '<div style="margin-top:18px; text-align:center;"><img src="' + options.qrDataUri +
      '" width="180" height="180" alt="QR code d\'entree" style="width:180px; height:180px;"></div>'
    : '<div style="margin-top:18px; padding:16px; border:1px dashed #cbb892; border-radius:10px; ' +
      'text-align:center; color:#9a8a6a; font-size:13px; font-style:italic;">' +
      "&#9744;&nbsp; Emplacement réservé au futur QR code d'entrée</div>";
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid ' +
    C.or + '; border-radius:12px; background:#fff;"><tr><td style="padding:22px 26px;">' +
    '<div style="font-size:12px; letter-spacing:2px; color:' + C.orFonce +
    '; font-weight:bold; text-transform:uppercase;">Votre billet</div>' +
    '<div style="font-family:Georgia,serif; font-size:24px; color:' + C.violet +
    '; margin:8px 0 14px;">Réf. <strong>' + options.reference + "</strong></div>" +
    '<div style="font-size:15px; line-height:1.6; color:' + C.texte + ';">' + options.lignesHtml + "</div>" +
    zoneQr +
    "</td></tr></table>"
  );
}

function blocInfos(lignes) {
  const rows = lignes
    .map(function (l) {
      return (
        '<tr><td style="padding:6px 0; width:30px; vertical-align:top;">' + l.picto +
        '</td><td style="padding:6px 0;">' + l.texteHtml + "</td></tr>"
      );
    })
    .join("");
  return (
    '<div style="font-size:12px; letter-spacing:2px; color:' + C.orFonce +
    '; font-weight:bold; text-transform:uppercase; margin-bottom:12px;">Infos pratiques</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px; line-height:1.5; color:' +
    C.texte + ';">' + rows + "</table>"
  );
}

function pied(piedExtraHtml) {
  return (
    '<tr><td style="background:' + C.violet + '; padding:26px 40px; text-align:center;">' +
    '<div style="font-family:Georgia,serif; font-size:16px; font-style:italic; color:' + C.ivoire +
    ';">À très vite sous les étoiles d\'Opio <span style="color:' + C.or + ';">&#10022;</span></div>' +
    '<div style="font-size:12px; color:' + C.lavande + '; margin-top:14px; line-height:1.7; font-family:Arial,Helvetica,sans-serif;">' +
    'Cinéma en plein air · Opio — une prestation <strong style="color:' + C.or + ';">Oria</strong><br>' +
    '<a href="mailto:' + CONTACT_EMAIL + '" style="color:' + C.muted + '; text-decoration:underline;">' +
    CONTACT_EMAIL + "</a> &nbsp;·&nbsp; " +
    '<a href="' + SITE_URL + '" style="color:' + C.muted + '; text-decoration:underline;">le site</a>' +
    (piedExtraHtml || "") +
    "</div></td></tr>"
  );
}

function emailShell(options) {
  const preheader = options.preheader || "";
  return (
    '<div style="display:none; max-height:0; overflow:hidden; opacity:0;">' + preheader + "</div>" +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center" style="width:600px; max-width:100%; margin:0 auto; background:' +
    C.creme + '; border-radius:14px; overflow:hidden;">' +
    '<tr><td style="background:' + C.violet + '; padding:34px 40px 30px; text-align:center;">' +
    '<div style="font-size:12px; letter-spacing:3px; color:' + C.or +
    '; font-weight:bold; text-transform:uppercase;">Cinéma en plein air · Opio</div>' +
    '<div style="font-family:Georgia,serif; font-size:30px; font-style:italic; color:' + C.ivoire +
    '; margin-top:12px;">' + options.titre + "</div>" +
    "</td></tr>" +
    '<tr><td style="padding:34px 40px 30px; color:' + C.violet + '; font-family:Arial,Helvetica,sans-serif;">' + options.corpsHtml + "</td></tr>" +
    pied(options.piedExtraHtml) +
    "</table>"
  );
}

module.exports = {
  SITE_URL,
  CONTACT_EMAIL,
  referenceDepuisId,
  bouton,
  blocBillet,
  blocInfos,
  emailShell,
};
