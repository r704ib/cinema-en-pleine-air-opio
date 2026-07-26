"use strict";

const MAX_FEEDBACK_EMAILS_PER_DAY = 50;
const FEEDBACK_REMINDER_DELAY_DAYS = 3;
const MAX_FEEDBACK_TEXT_LENGTH = 2000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function normalizeEmail(email) {
  return String(email == null ? "" : email).trim().toLowerCase();
}

function validateFeedbackInput(data) {
  data = data || {};
  const errors = [];
  const mode = data.mode === "qr" ? "qr" : "email";

  const note = Number(data.note);
  if (!Number.isInteger(note) || note < 1 || note > 5) errors.push("note");

  const commentaire = typeof data.commentaire === "string" ? data.commentaire.trim() : "";
  if (commentaire.length > MAX_FEEDBACK_TEXT_LENGTH) errors.push("commentaire");

  const film_souhaite = typeof data.film_souhaite === "string" ? data.film_souhaite.trim() : "";
  if (film_souhaite.length > MAX_FEEDBACK_TEXT_LENGTH) errors.push("film_souhaite");

  if (mode === "email") {
    if (typeof data.reservationId !== "string" || data.reservationId.trim().length === 0) {
      errors.push("reservationId");
    }
  } else {
    if (typeof data.email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
      errors.push("email");
    }
  }

  if (errors.length > 0) return { valid: false, errors: errors };

  return {
    valid: true,
    feedback: {
      mode: mode,
      reservationId: mode === "email" ? data.reservationId.trim() : null,
      email: mode === "qr" ? normalizeEmail(data.email) : null,
      note: note,
      commentaire: commentaire,
      film_souhaite: film_souhaite,
      publication_autorisee: data.publication_autorisee === true,
    },
  };
}

module.exports = {
  MAX_FEEDBACK_EMAILS_PER_DAY: MAX_FEEDBACK_EMAILS_PER_DAY,
  FEEDBACK_REMINDER_DELAY_DAYS: FEEDBACK_REMINDER_DELAY_DAYS,
  MAX_FEEDBACK_TEXT_LENGTH: MAX_FEEDBACK_TEXT_LENGTH,
  ONE_DAY_MS: ONE_DAY_MS,
  normalizeEmail: normalizeEmail,
  validateFeedbackInput: validateFeedbackInput,
};
