"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { validateReservationInput, MAX_PLACES } = require("./reservation-logic");
const {
  buildVisitorConfirmationEmail,
  buildComiteNewReservationEmail,
  buildComiteCancellationEmail,
} = require("./email-content");

admin.initializeApp();
const db = getFirestore();

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");
const SENDER = { name: "Cinéma en plein air Opio", email: "Oria.ei@outlook.fr" };

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

exports.onReservationCreated = onDocumentCreated(
  { document: "reservations/{reservationId}", secrets: [BREVO_API_KEY] },
  async (event) => {
    const reservation = event.data.data();
    const reservationId = event.params.reservationId;
    const apiKey = BREVO_API_KEY.value();

    await sendEmail(apiKey, buildVisitorConfirmationEmail(reservation, reservationId));
    await sendEmail(apiKey, buildComiteNewReservationEmail(reservation));
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
      await sendEmail(apiKey, buildComiteCancellationEmail(after));
      logger.info("Cancellation email sent", { reservationId: event.params.reservationId });
    }
  }
);
