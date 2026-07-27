// Génère un aperçu HTML des 4 emails visiteurs via les vrais builders.
const fs = require("fs");
const path = require("path");
const {
  buildVisitorConfirmationEmail,
  buildVisitorCancellationEmail,
  buildFeedbackRequestEmail,
  buildFeedbackReminderEmail,
} = require("../functions/email-content");

const r = {
  prenom: "Jean", nom: "Dupont", email: "jean@example.com", telephone: "0600000000",
  nb_adultes: 2, nb_enfants_3_10: 1, nb_enfants_moins_3: 0, totalPlaces: 3, montantEstime: 13,
};
const id = "ZreOWUFAg5SY8y0jR6Ik";

const emails = [
  ["1 · Confirmation", buildVisitorConfirmationEmail(r, id)],
  ["2 · Annulation", buildVisitorCancellationEmail(r, id)],
  ["3 · Demande d'avis", buildFeedbackRequestEmail(r, id)],
  ["4 · Relance d'avis", buildFeedbackReminderEmail(r, id)],
];

const sections = emails.map(function (e) {
  return '<div style="max-width:640px;margin:0 auto;padding:8px 20px;"><div style="background:#241A38;color:#E8A33D;' +
    'font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;padding:8px 14px;border-radius:8px;">' +
    e[0] + " — <em>" + e[1].subject + "</em></div></div>" +
    '<div style="padding:14px 0 34px;">' + e[1].htmlContent + "</div>";
}).join("");

const page = "<!DOCTYPE html><html lang=\"fr\"><head><meta charset=\"utf-8\">" +
  '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Aperçu emails</title></head>' +
  '<body style="margin:0;padding:24px 0;background:#e9e5ef;font-family:Arial,sans-serif;">' + sections + "</body></html>";

const out = path.join(__dirname, "apercu-emails.html");
fs.writeFileSync(out, page);
console.log("✅ Aperçu généré : " + out);
