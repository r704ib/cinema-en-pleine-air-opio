"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { validateReservationInput, MAX_PLACES } = require("./reservation-logic");
const {
  validateFeedbackInput,
  matchReservationByEmail,
  normalizeEmail,
  selectFeedbackRecipients,
} = require("./feedback-logic");
const {
  buildVisitorConfirmationEmail,
  buildOriaNewReservationEmail,
  buildOriaCancellationEmail,
  buildFeedbackRequestEmail,
  buildFeedbackReminderEmail,
} = require("./email-content");

admin.initializeApp();
const db = getFirestore();

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");
const SENDER = { name: "Cinéma en plein air Opio", email: "reservations@opio.oria-events.fr" };

async function sendEmail(apiKey, email) {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      sender: SENDER,
      to: [{ email: email.to }],
      subject: email.subject,
      htmlContent: email.htmlContent,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error("Brevo API error " + response.status + ": " + body);
  }
}

exports.createReservation = onCall(async (request) => {
  const result = validateReservationInput(request.data);
  if (!result.valid) {
    throw new HttpsError("invalid-argument", "Données de réservation invalides: " + result.errors.join(", "));
  }

  const gaugeRef = db.collection("meta").doc("gauge");
  const reservationRef = db.collection("reservations").doc();

  await db.runTransaction(async (tx) => {
    const gaugeSnap = await tx.get(gaugeRef);
    const reserved = gaugeSnap.exists ? gaugeSnap.data().reserved : 0;
    if (reserved + result.reservation.totalPlaces > MAX_PLACES) {
      throw new HttpsError("resource-exhausted", "FULL");
    }
    tx.set(reservationRef, Object.assign({}, result.reservation, {
      createdAt: FieldValue.serverTimestamp(),
    }));
    tx.set(
      gaugeRef,
      {
        reserved: reserved + result.reservation.totalPlaces,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  logger.info("Reservation created", { reservationId: reservationRef.id });
  return { id: reservationRef.id };
});

exports.cancelReservation = onCall(async (request) => {
  const reservationId = request.data && request.data.reservationId;
  if (typeof reservationId !== "string" || reservationId.length === 0) {
    throw new HttpsError("invalid-argument", "reservationId manquant");
  }

  const reservationRef = db.collection("reservations").doc(reservationId);
  const gaugeRef = db.collection("meta").doc("gauge");

  await db.runTransaction(async (tx) => {
    const reservationSnap = await tx.get(reservationRef);
    if (!reservationSnap.exists || reservationSnap.data().status !== "active") {
      throw new HttpsError("failed-precondition", "ALREADY_CANCELLED");
    }
    const gaugeSnap = await tx.get(gaugeRef);
    const reserved = gaugeSnap.exists ? gaugeSnap.data().reserved : 0;
    const totalPlaces = reservationSnap.data().totalPlaces;

    tx.update(reservationRef, {
      status: "cancelled",
      cancelledAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      gaugeRef,
      {
        reserved: Math.max(0, reserved - totalPlaces),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  logger.info("Reservation cancelled", { reservationId: reservationId });
  return { success: true };
});

exports.submitFeedback = onCall(async (request) => {
  const result = validateFeedbackInput(request.data);
  if (!result.valid) {
    throw new HttpsError("invalid-argument", "Avis invalide: " + result.errors.join(", "));
  }
  const fb = result.feedback;

  let reservationId = null;
  let email = null;
  let prenom = "";
  let nom = "";

  if (fb.mode === "email") {
    const resSnap = await db.collection("reservations").doc(fb.reservationId).get();
    if (!resSnap.exists) {
      throw new HttpsError("not-found", "RESERVATION_NOT_FOUND");
    }
    const existing = await db.collection("avis")
      .where("reservationId", "==", fb.reservationId).limit(1).get();
    if (!existing.empty) {
      throw new HttpsError("failed-precondition", "ALREADY_SUBMITTED");
    }
    const r = resSnap.data();
    reservationId = fb.reservationId;
    email = normalizeEmail(r.email);
    prenom = r.prenom;
    nom = r.nom;
  } else {
    // Mode QR : identification par email
    const existingByEmail = await db.collection("avis")
      .where("email", "==", fb.email).limit(1).get();
    if (!existingByEmail.empty) {
      throw new HttpsError("failed-precondition", "ALREADY_SUBMITTED");
    }
    const allRes = await db.collection("reservations").get();
    const reservations = allRes.docs.map(function (d) {
      return Object.assign({ id: d.id }, d.data());
    });
    const match = matchReservationByEmail(reservations, fb.email);
    email = fb.email;
    if (match) {
      reservationId = match.id;
      prenom = match.prenom;
      nom = match.nom;
    }
  }

  await db.collection("avis").add({
    source: fb.mode,
    reservationId: reservationId,
    email: email,
    prenom: prenom,
    nom: nom,
    note: fb.note,
    commentaire: fb.commentaire,
    film_souhaite: fb.film_souhaite,
    publication_autorisee: fb.publication_autorisee,
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info("Feedback submitted", { mode: fb.mode, reservationId: reservationId });
  return { success: true };
});

exports.stopFeedback = onCall(async (request) => {
  const reservationId = request.data && request.data.reservationId;
  if (typeof reservationId !== "string" || reservationId.length === 0) {
    throw new HttpsError("invalid-argument", "reservationId manquant");
  }
  const reservationRef = db.collection("reservations").doc(reservationId);
  const snap = await reservationRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "RESERVATION_NOT_FOUND");
  }
  await reservationRef.update({ avisOptOut: true });
  logger.info("Feedback opt-out", { reservationId: reservationId });
  return { success: true };
});

exports.onReservationCreated = onDocumentCreated(
  { document: "reservations/{reservationId}", secrets: [BREVO_API_KEY] },
  async (event) => {
    const reservation = event.data.data();
    const reservationId = event.params.reservationId;
    const apiKey = BREVO_API_KEY.value();

    await sendEmail(apiKey, buildVisitorConfirmationEmail(reservation, reservationId));
    await sendEmail(apiKey, buildOriaNewReservationEmail(reservation));
    logger.info("Reservation emails sent", { reservationId });
  }
);

exports.onReservationCancelled = onDocumentUpdated(
  { document: "reservations/{reservationId}", secrets: [BREVO_API_KEY] },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (before.status === "active" && after.status === "cancelled") {
      const apiKey = BREVO_API_KEY.value();
      await sendEmail(apiKey, buildOriaCancellationEmail(after));
      logger.info("Cancellation email sent", { reservationId: event.params.reservationId });
    }
  }
);

exports.sendFeedbackRequests = onSchedule(
  { schedule: "0 9 * * *", timeZone: "Europe/Paris", secrets: [BREVO_API_KEY] },
  async () => {
    const sessionSnap = await db.collection("meta").doc("session").get();
    if (!sessionSnap.exists) {
      logger.info("Feedback: aucune session configurée, rien à faire");
      return;
    }
    const session = sessionSnap.data();
    if (session.feedbackEnabled !== true) {
      logger.info("Feedback: envoi désactivé (feedbackEnabled != true)");
      return;
    }

    const resSnap = await db.collection("reservations").get();
    const reservations = resSnap.docs.map(function (d) {
      const data = d.data();
      return {
        id: d.id,
        status: data.status,
        email: data.email,
        prenom: data.prenom,
        avisOptOut: data.avisOptOut === true,
        avisRequestSent: data.avisRequestSent === true,
        avisRelanceSent: data.avisRelanceSent === true,
        avisRequestSentAt: data.avisRequestSentAt ? data.avisRequestSentAt.toDate() : null,
      };
    });

    const avisSnap = await db.collection("avis").get();
    const avisReservationIds = new Set();
    avisSnap.forEach(function (d) {
      const rid = d.data().reservationId;
      if (rid) avisReservationIds.add(rid);
    });

    const recipients = selectFeedbackRecipients({
      reservations: reservations,
      avisReservationIds: avisReservationIds,
      now: new Date(),
      sessionDate: session.sessionDate.toDate(),
      feedbackEnabled: true,
    });

    const apiKey = BREVO_API_KEY.value();
    let sent = 0;
    for (let i = 0; i < recipients.length; i++) {
      const rec = recipients[i];
      const reservation = { email: rec.email, prenom: rec.prenom };
      try {
        if (rec.type === "request") {
          await sendEmail(apiKey, buildFeedbackRequestEmail(reservation, rec.reservationId));
          await db.collection("reservations").doc(rec.reservationId).set(
            { avisRequestSent: true, avisRequestSentAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        } else {
          await sendEmail(apiKey, buildFeedbackReminderEmail(reservation, rec.reservationId));
          await db.collection("reservations").doc(rec.reservationId).set(
            { avisRelanceSent: true, avisRelanceSentAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
        sent++;
      } catch (err) {
        logger.error("Feedback email échec", { reservationId: rec.reservationId, error: String(err) });
      }
    }
    logger.info("Feedback: campagne terminée", { envoyes: sent, candidats: recipients.length });
  }
);
