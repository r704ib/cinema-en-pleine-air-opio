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
  buildVisitorCancellationEmail,
  buildFeedbackRequestEmail,
  buildFeedbackReminderEmail,
  buildJourJReminderEmail,
  buildSeanceAnnulationEmail,
} = require("./email-content");

admin.initializeApp();
const db = getFirestore();

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");
const SENDER = { name: "Cinéma en plein air Opio", email: "reservations@opio.oria-events.fr" };

const DEFAULT_EVENT_ID = "opio-2026-07-28";

const ADMIN_EMAIL = "oria.ei@outlook.fr";
const {
  seanceLabelFromDateLabel,
  avisPublicFromAvis,
} = require("./avis-public-logic");

function assertAdmin(request) {
  const email = request.auth && request.auth.token && request.auth.token.email;
  if (!email || String(email).toLowerCase() !== ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "Accès réservé à l'administrateur");
  }
}

async function resolveSeanceLabel(reservationId) {
  if (!reservationId) return "";
  const resSnap = await db.collection("reservations").doc(reservationId).get();
  if (!resSnap.exists) return "";
  const eventId = resSnap.data().eventId;
  if (!eventId) return "";
  const ev = await loadEvent(eventId);
  return ev && ev.dateLabel ? seanceLabelFromDateLabel(ev.dateLabel) : "";
}

async function loadEvent(eventId) {
  const snap = await db.collection("events").doc(eventId).get();
  return snap.exists ? Object.assign({ id: eventId }, snap.data()) : null;
}

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

// Outil de test manuel — envoie l'email de demande d'avis (avec le bloc
// "prochaines séances") à l'exploitant, pour vérifier le circuit. Destinataire
// fixe (l'exploitant), donc sans risque. Déclenché à la demande via son URL.
exports.sendTestFeedbackEmail = onCall({ secrets: [BREVO_API_KEY] }, async () => {
  const apiKey = BREVO_API_KEY.value();
  const refEvent = await loadEvent(DEFAULT_EVENT_ID);
  // Une réservation réelle du 28/07 pour que le lien "Donner mon avis" fonctionne.
  const resSnap = await db.collection("reservations").where("eventId", "==", DEFAULT_EVENT_ID).limit(1).get();
  const reservationId = resSnap.empty ? "TEST" : resSnap.docs[0].id;
  const reservation = { email: "Oria.ei@outlook.fr", prenom: "Oria" };
  await sendEmail(apiKey, buildFeedbackRequestEmail(reservation, reservationId, refEvent));
  logger.info("Test feedback email sent");
  return { sent: true };
});

// Rappel « jour J » : envoie un rappel aux réservants actifs de la séance qui a
// lieu AUJOURD'HUI (fuseau Europe/Paris). Idempotent : marque rappelJourJSent
// par réservation, ne renvoie jamais deux fois. Déclenché à la demande.
function parisDay(date) {
  return date.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }); // "AAAA-MM-JJ"
}
exports.sendJourJReminder = onCall({ secrets: [BREVO_API_KEY] }, async () => {
  const apiKey = BREVO_API_KEY.value();
  const today = parisDay(new Date());
  const eventsSnap = await db.collection("events").get();
  let todayEvent = null;
  eventsSnap.forEach(function (d) {
    const e = Object.assign({ id: d.id }, d.data());
    if (e.dateISO && parisDay(e.dateISO.toDate()) === today) todayEvent = e;
  });
  if (!todayEvent) {
    logger.info("Rappel jour J : aucune séance aujourd'hui");
    return { sent: 0, skipped: 0, event: null };
  }
  const resSnap = await db.collection("reservations").where("eventId", "==", todayEvent.id).get();
  let sent = 0;
  let skipped = 0;
  for (const d of resSnap.docs) {
    const r = d.data();
    if (r.status !== "active") continue;
    if (r.rappelJourJSent === true) { skipped++; continue; }
    try {
      await sendEmail(apiKey, buildJourJReminderEmail(r, todayEvent));
      await d.ref.set({ rappelJourJSent: true, rappelJourJSentAt: FieldValue.serverTimestamp() }, { merge: true });
      sent++;
    } catch (err) {
      logger.error("Rappel jour J échec", { reservationId: d.id, error: String(err) });
    }
  }
  logger.info("Rappel jour J terminé", { event: todayEvent.id, sent: sent, skipped: skipped });
  return { sent: sent, skipped: skipped, event: todayEvent.id };
});

// ⚠️ TEMPORAIRE — annonce l'annulation de la séance du 18/08 aux réservants.
// Ne change PAS le statut des réservations (elles sont conservées). Idempotent
// (marque annulation18Sent). Déclenché à la demande, puis à supprimer.
exports.sendAnnulation18Aout = onCall({ secrets: [BREVO_API_KEY] }, async () => {
  const apiKey = BREVO_API_KEY.value();
  const resSnap = await db.collection("reservations").where("eventId", "==", "opio-2026-08-18").get();
  let sent = 0;
  let skipped = 0;
  for (const d of resSnap.docs) {
    const r = d.data();
    if (r.status !== "active") continue;
    if (r.annulation18Sent === true) { skipped++; continue; }
    try {
      await sendEmail(apiKey, buildSeanceAnnulationEmail(r, "Mardi 18 août 2026"));
      await d.ref.set({ annulation18Sent: true, annulation18SentAt: FieldValue.serverTimestamp() }, { merge: true });
      sent++;
    } catch (err) {
      logger.error("Annulation 18/08 échec", { reservationId: d.id, error: String(err) });
    }
  }
  logger.info("Annulation 18/08 terminée", { sent: sent, skipped: skipped });
  return { sent: sent, skipped: skipped };
});

exports.createReservation = onCall(async (request) => {
  const eventId = request.data && request.data.eventId;
  if (typeof eventId !== "string" || eventId.length === 0) {
    throw new HttpsError("invalid-argument", "eventId manquant");
  }
  const event = await loadEvent(eventId);
  if (!event) {
    throw new HttpsError("not-found", "EVENT_NOT_FOUND");
  }
  if (event.ouvertResa !== true) {
    throw new HttpsError("failed-precondition", "RESA_FERMEE");
  }

  const result = validateReservationInput(request.data, event.maxParResa);
  if (!result.valid) {
    throw new HttpsError("invalid-argument", "Données de réservation invalides: " + result.errors.join(", "));
  }

  const eventRef = db.collection("events").doc(eventId);
  const reservationRef = db.collection("reservations").doc();

  await db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef);
    const reserved = eventSnap.exists && eventSnap.data().reserved ? eventSnap.data().reserved : 0;
    const gaugeMax = eventSnap.data().gaugeMax;
    if (reserved + result.reservation.totalPlaces > gaugeMax) {
      throw new HttpsError("resource-exhausted", "FULL");
    }
    tx.set(reservationRef, Object.assign({}, result.reservation, {
      createdAt: FieldValue.serverTimestamp(),
    }));
    tx.update(eventRef, {
      reserved: reserved + result.reservation.totalPlaces,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info("Reservation created", { reservationId: reservationRef.id, eventId });
  return { id: reservationRef.id };
});

exports.cancelReservation = onCall(async (request) => {
  const reservationId = request.data && request.data.reservationId;
  if (typeof reservationId !== "string" || reservationId.length === 0) {
    throw new HttpsError("invalid-argument", "reservationId manquant");
  }

  const reservationRef = db.collection("reservations").doc(reservationId);

  await db.runTransaction(async (tx) => {
    const reservationSnap = await tx.get(reservationRef);
    if (!reservationSnap.exists || reservationSnap.data().status !== "active") {
      throw new HttpsError("failed-precondition", "ALREADY_CANCELLED");
    }
    const data = reservationSnap.data();
    const eventId = data.eventId || DEFAULT_EVENT_ID;
    const eventRef = db.collection("events").doc(eventId);
    const eventSnap = await tx.get(eventRef);
    const reserved = eventSnap.exists && eventSnap.data().reserved ? eventSnap.data().reserved : 0;

    tx.update(reservationRef, {
      status: "cancelled",
      cancelledAt: FieldValue.serverTimestamp(),
    });
    tx.update(eventRef, {
      reserved: Math.max(0, reserved - data.totalPlaces),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info("Reservation cancelled", { reservationId });
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
    const ev = await loadEvent(reservation.eventId || DEFAULT_EVENT_ID);

    await sendEmail(apiKey, buildVisitorConfirmationEmail(reservation, reservationId, ev));
    await sendEmail(apiKey, buildOriaNewReservationEmail(reservation, ev));
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
      const reservationId = event.params.reservationId;
      const ev = await loadEvent(after.eventId || DEFAULT_EVENT_ID);
      try {
        await sendEmail(apiKey, buildVisitorCancellationEmail(after, reservationId, ev));
      } catch (err) {
        logger.error("Cancellation visitor email failed", { reservationId, error: String(err) });
      }
      try {
        await sendEmail(apiKey, buildOriaCancellationEmail(after, ev));
      } catch (err) {
        logger.error("Cancellation Oria email failed", { reservationId, error: String(err) });
      }
      logger.info("Cancellation emails processed", { reservationId });
    }
  }
);

exports.sendFeedbackRequests = onSchedule(
  { schedule: "0 9 * * *", timeZone: "Europe/Paris", secrets: [BREVO_API_KEY] },
  async () => {
    const eventsSnap = await db.collection("events").get();
    const events = [];
    const eventMap = {};
    eventsSnap.forEach(function (d) {
      const data = d.data();
      events.push({
        id: d.id,
        sessionDate: data.dateISO ? data.dateISO.toDate() : null,
        feedbackEnabled: data.feedbackEnabled,
      });
      eventMap[d.id] = Object.assign({ id: d.id }, data);
    });

    const resSnap = await db.collection("reservations").get();
    const reservations = resSnap.docs.map(function (d) {
      const data = d.data();
      return {
        id: d.id,
        eventId: data.eventId,
        status: data.status,
        email: data.email,
        prenom: data.prenom,
        avisOptOut: data.avisOptOut === true,
        avisRequestSent: data.avisRequestSent === true,
        avisRelanceSent: data.avisRelanceSent === true,
        avisRequestSentAt: data.avisRequestSentAt ? data.avisRequestSentAt.toDate() : null,
      };
    });
    const resEventById = {};
    reservations.forEach(function (r) { resEventById[r.id] = r.eventId; });

    const avisSnap = await db.collection("avis").get();
    const avisReservationIds = new Set();
    avisSnap.forEach(function (d) {
      const rid = d.data().reservationId;
      if (rid) avisReservationIds.add(rid);
    });

    const recipients = selectFeedbackRecipients({
      reservations: reservations,
      events: events,
      avisReservationIds: avisReservationIds,
      now: new Date(),
    });

    const apiKey = BREVO_API_KEY.value();
    let sent = 0;
    for (let i = 0; i < recipients.length; i++) {
      const rec = recipients[i];
      const reservation = { email: rec.email, prenom: rec.prenom };
      const ev = eventMap[resEventById[rec.reservationId]] || eventMap[DEFAULT_EVENT_ID];
      try {
        if (rec.type === "request") {
          await sendEmail(apiKey, buildFeedbackRequestEmail(reservation, rec.reservationId, ev));
          await db.collection("reservations").doc(rec.reservationId).set(
            { avisRequestSent: true, avisRequestSentAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        } else {
          await sendEmail(apiKey, buildFeedbackReminderEmail(reservation, rec.reservationId, ev));
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

exports.adminListAvis = onCall(async (request) => {
  assertAdmin(request);
  const snap = await db.collection("avis").orderBy("createdAt", "desc").get();
  const avis = [];
  for (const d of snap.docs) {
    const a = d.data();
    const seanceLabel = await resolveSeanceLabel(a.reservationId);
    avis.push({
      id: d.id,
      prenom: a.prenom || "",
      nom: a.nom || "",
      email: a.email || "",
      note: a.note,
      commentaire: a.commentaire || "",
      film_souhaite: a.film_souhaite || "",
      publication_autorisee: a.publication_autorisee === true,
      publie: a.publie === true,
      seanceLabel: seanceLabel,
    });
  }
  return { avis: avis };
});

exports.adminPublishAvis = onCall(async (request) => {
  assertAdmin(request);
  const avisId = request.data && request.data.avisId;
  if (typeof avisId !== "string" || avisId.length === 0) {
    throw new HttpsError("invalid-argument", "avisId manquant");
  }
  const avisRef = db.collection("avis").doc(avisId);
  const avisSnap = await avisRef.get();
  if (!avisSnap.exists) {
    throw new HttpsError("not-found", "AVIS_NOT_FOUND");
  }
  const a = avisSnap.data();
  if (a.publication_autorisee !== true) {
    throw new HttpsError("failed-precondition", "CONSENT_REQUIRED");
  }
  const seanceLabel = await resolveSeanceLabel(a.reservationId);
  await db.collection("avis_publics").doc(avisId).set(avisPublicFromAvis(a, seanceLabel));
  await avisRef.update({ publie: true });
  logger.info("Avis published", { avisId: avisId });
  return { success: true };
});

exports.adminUnpublishAvis = onCall(async (request) => {
  assertAdmin(request);
  const avisId = request.data && request.data.avisId;
  if (typeof avisId !== "string" || avisId.length === 0) {
    throw new HttpsError("invalid-argument", "avisId manquant");
  }
  await db.collection("avis_publics").doc(avisId).delete();
  await db.collection("avis").doc(avisId).update({ publie: false });
  logger.info("Avis unpublished", { avisId: avisId });
  return { success: true };
});
