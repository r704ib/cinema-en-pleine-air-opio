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

function matchReservationByEmail(reservations, email) {
  const target = normalizeEmail(email);
  if (!target) return null;
  for (let i = 0; i < reservations.length; i++) {
    if (normalizeEmail(reservations[i].email) === target) return reservations[i];
  }
  return null;
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (value && typeof value.toDate === "function") return value.toDate().getTime();
  return null;
}

function selectFeedbackRecipients(params) {
  const reservations = params.reservations || [];
  const avisReservationIds = params.avisReservationIds || new Set();
  const now = toMillis(params.now);
  const sessionDate = toMillis(params.sessionDate);
  const feedbackEnabled = params.feedbackEnabled === true;
  const maxPerDay = params.maxPerDay || MAX_FEEDBACK_EMAILS_PER_DAY;
  const reminderDelayMs = (params.reminderDelayDays || FEEDBACK_REMINDER_DELAY_DAYS) * ONE_DAY_MS;

  if (!feedbackEnabled) return [];
  if (typeof sessionDate !== "number" || typeof now !== "number") return [];
  const nowDay = new Date(now); nowDay.setHours(0, 0, 0, 0);
  const sessionDay = new Date(sessionDate); sessionDay.setHours(0, 0, 0, 0);
  if (nowDay.getTime() <= sessionDay.getTime()) return [];

  const firstRequests = [];
  const reminders = [];

  for (let i = 0; i < reservations.length; i++) {
    const r = reservations[i];
    if (r.status !== "active") continue;
    if (r.avisOptOut === true) continue;
    if (avisReservationIds.has(r.id)) continue;

    if (r.avisRequestSent !== true) {
      firstRequests.push({ reservationId: r.id, type: "request", email: r.email, prenom: r.prenom });
    } else if (r.avisRelanceSent !== true) {
      const sentAt = toMillis(r.avisRequestSentAt);
      if (typeof sentAt === "number" && now - sentAt >= reminderDelayMs) {
        reminders.push({ reservationId: r.id, type: "reminder", email: r.email, prenom: r.prenom });
      }
    }
  }

  return firstRequests.concat(reminders).slice(0, maxPerDay);
}

module.exports = {
  MAX_FEEDBACK_EMAILS_PER_DAY: MAX_FEEDBACK_EMAILS_PER_DAY,
  FEEDBACK_REMINDER_DELAY_DAYS: FEEDBACK_REMINDER_DELAY_DAYS,
  MAX_FEEDBACK_TEXT_LENGTH: MAX_FEEDBACK_TEXT_LENGTH,
  ONE_DAY_MS: ONE_DAY_MS,
  normalizeEmail: normalizeEmail,
  validateFeedbackInput: validateFeedbackInput,
  matchReservationByEmail: matchReservationByEmail,
  selectFeedbackRecipients: selectFeedbackRecipients,
};
