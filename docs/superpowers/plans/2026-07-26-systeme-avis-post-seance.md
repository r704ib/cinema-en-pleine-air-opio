# Système d'avis post-séance — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collecter les avis des participants après une séance via une page dédiée `avis.html` (mode email personnalisé + mode QR par email), avec envoi automatique programmé (inerte tant que non activé) et relance unique.

**Architecture:** On reprend le modèle existant : logique pure dans des modules testés par Jest (`feedback-logic.js`), constructeurs d'emails dans `email-content.js`, fonctions Firebase (callable + programmée) dans `index.js`, écritures réservées à l'Admin SDK, clients en lecture seule. Une nouvelle collection `avis` et un document `meta/session` (interrupteur d'activation).

**Tech Stack:** Node.js 20, firebase-functions v5 (onCall + onSchedule), firebase-admin (modular `firebase-admin/firestore`), Jest, Firebase JS SDK v10.13.0 (CDN) côté page, Brevo API, `qrcode` (génération QR), `exceljs` (export).

## Global Constraints

- Node.js 20 ; `firebase-functions` v5 ; CommonJS ; `"use strict"` en tête de chaque module functions.
- Toutes les écritures passent par des Cloud Functions (Admin SDK) ; les clients sont en lecture seule.
- Import admin modulaire : `const { getFirestore, FieldValue } = require("firebase-admin/firestore");` (ne PAS utiliser `admin.firestore.FieldValue`).
- Expéditeur emails : `reservations@opio.oria-events.fr` (déjà en place dans `SENDER`).
- `SITE_URL = "https://cinema-en-pleine-air-opio.oria-events.fr"` (déjà dans `email-content.js`).
- Note : entier **1..5** ; textes ≤ **2000** caractères.
- Envoi max **50/jour** ; relance **3 jours** après la 1ʳᵉ demande ; **une seule** relance.
- Charte graphique (variables CSS) : `--c-bg:#15101F` `--c-surface:#241A38` `--c-surface-2:#1c1530` `--c-gold:#E8A33D` `--c-gold-soft:rgba(232,163,61,0.16)` `--c-lavender:#9B86C9` `--c-ivory:#F6F1E7` `--c-muted:#B8AFC9` `--c-border:rgba(246,241,231,0.1)` ; polices `Fraunces` (titres), `Outfit` (corps).
- Config Firebase (publique) identique à `annuler.html` : apiKey `AIzaSyBB-WiFkZfrHQD9rXDQ6KjbeNQyMlO4VbA`, authDomain `cinema-en-pleine-air-opi-ac81e.firebaseapp.com`, projectId `cinema-en-pleine-air-opi-ac81e`, storageBucket `cinema-en-pleine-air-opi-ac81e.firebasestorage.app`, messagingSenderId `245777069404`, appId `1:245777069404:web:8478506b55ec08fb8abd99`.
- Commits fréquents (un par tâche minimum).

---

## Structure des fichiers

- **Créer** `functions/feedback-logic.js` — logique pure : validation d'un avis, normalisation email, correspondance email→réservation, sélection des destinataires (1ʳᵉ demande + relance, plafond 50).
- **Créer** `functions/test/feedback-logic.test.js` — tests Jest de la logique pure.
- **Modifier** `functions/email-content.js` — ajouter `buildFeedbackRequestEmail`, `buildFeedbackReminderEmail`.
- **Modifier** `functions/test/email-content.test.js` — tests des 2 nouveaux emails.
- **Modifier** `functions/index.js` — ajouter `submitFeedback` (callable), `stopFeedback` (callable), `sendFeedbackRequests` (programmée).
- **Modifier** `firestore.rules` — règles `avis` (tout `false` côté client) et `meta/session` (`get` autorisé).
- **Créer** `public/avis.html` — page d'avis (modes email/QR/désinscription), charte du site.
- **Créer** `outils-export/export-avis.js` — export des avis en `.xlsx`.
- **Créer** `outils-export/genere-qr.js` — génération de l'image QR (PNG) vers `avis.html?source=qr`.
- **Modifier** `outils-export/package.json` — ajouter la dépendance `qrcode`.
- **Créer** (script ponctuel) `outils-export/init-session.js` — crée `meta/session` (Opio, `feedbackEnabled:false`).

---

### Task 1 : Logique de validation d'un avis (`feedback-logic.js`)

**Files:**
- Create: `functions/feedback-logic.js`
- Test: `functions/test/feedback-logic.test.js`

**Interfaces:**
- Produces :
  - `MAX_FEEDBACK_EMAILS_PER_DAY = 50`, `FEEDBACK_REMINDER_DELAY_DAYS = 3`, `MAX_FEEDBACK_TEXT_LENGTH = 2000`
  - `normalizeEmail(email) -> string` (trim + lowercase)
  - `validateFeedbackInput(data) -> { valid:boolean, errors?:string[], feedback?:{ mode, reservationId, email, note, commentaire, film_souhaite, publication_autorisee } }`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `functions/test/feedback-logic.test.js` :

```js
const {
  validateFeedbackInput,
  normalizeEmail,
  MAX_FEEDBACK_TEXT_LENGTH,
} = require("../feedback-logic");

test("normalizeEmail trims and lowercases", () => {
  expect(normalizeEmail("  Jean@Example.FR ")).toBe("jean@example.fr");
  expect(normalizeEmail(null)).toBe("");
});

test("email mode: valid input keeps reservationId and cleans note/texts", () => {
  const r = validateFeedbackInput({
    mode: "email", reservationId: "abc123",
    note: 4, commentaire: "  super soirée  ", film_souhaite: "Intouchables",
    publication_autorisee: true,
  });
  expect(r.valid).toBe(true);
  expect(r.feedback.mode).toBe("email");
  expect(r.feedback.reservationId).toBe("abc123");
  expect(r.feedback.email).toBeNull();
  expect(r.feedback.note).toBe(4);
  expect(r.feedback.commentaire).toBe("super soirée");
  expect(r.feedback.publication_autorisee).toBe(true);
});

test("email mode: missing reservationId is rejected", () => {
  const r = validateFeedbackInput({ mode: "email", note: 4 });
  expect(r.valid).toBe(false);
  expect(r.errors).toContain("reservationId");
});

test("qr mode: requires a valid email, normalized", () => {
  const ok = validateFeedbackInput({ mode: "qr", email: "A@B.FR", note: 5 });
  expect(ok.valid).toBe(true);
  expect(ok.feedback.email).toBe("a@b.fr");
  expect(ok.feedback.reservationId).toBeNull();

  const bad = validateFeedbackInput({ mode: "qr", email: "not-an-email", note: 5 });
  expect(bad.valid).toBe(false);
  expect(bad.errors).toContain("email");
});

test("note must be an integer between 1 and 5", () => {
  expect(validateFeedbackInput({ mode: "qr", email: "a@b.fr", note: 0 }).valid).toBe(false);
  expect(validateFeedbackInput({ mode: "qr", email: "a@b.fr", note: 6 }).valid).toBe(false);
  expect(validateFeedbackInput({ mode: "qr", email: "a@b.fr", note: 3.5 }).valid).toBe(false);
});

test("publication_autorisee defaults to false when not exactly true", () => {
  const r = validateFeedbackInput({ mode: "qr", email: "a@b.fr", note: 3 });
  expect(r.feedback.publication_autorisee).toBe(false);
});

test("a comment longer than the max is rejected", () => {
  const long = "x".repeat(MAX_FEEDBACK_TEXT_LENGTH + 1);
  const r = validateFeedbackInput({ mode: "qr", email: "a@b.fr", note: 3, commentaire: long });
  expect(r.valid).toBe(false);
  expect(r.errors).toContain("commentaire");
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `cd functions && npx jest test/feedback-logic.test.js`
Expected: FAIL (`Cannot find module '../feedback-logic'`).

- [ ] **Step 3 : Écrire l'implémentation minimale**

Créer `functions/feedback-logic.js` :

```js
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
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `cd functions && npx jest test/feedback-logic.test.js`
Expected: PASS (tous les tests verts).

- [ ] **Step 5 : Commit**

```bash
git add functions/feedback-logic.js functions/test/feedback-logic.test.js
git commit -m "feat: validation des avis (feedback-logic)"
```

---

### Task 2 : Correspondance email + sélection des destinataires (`feedback-logic.js`)

**Files:**
- Modify: `functions/feedback-logic.js`
- Test: `functions/test/feedback-logic.test.js`

**Interfaces:**
- Consumes : `normalizeEmail`, `MAX_FEEDBACK_EMAILS_PER_DAY`, `FEEDBACK_REMINDER_DELAY_DAYS`, `ONE_DAY_MS`.
- Produces :
  - `matchReservationByEmail(reservations, email) -> reservation | null` (reservations = objets `{ id, email, ... }`)
  - `selectFeedbackRecipients({ reservations, avisReservationIds:Set, now:Date, sessionDate:Date, feedbackEnabled:boolean, maxPerDay?, reminderDelayDays? }) -> Array<{ reservationId, type:"request"|"reminder", email, prenom }>`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à la fin de `functions/test/feedback-logic.test.js` :

```js
const { matchReservationByEmail, selectFeedbackRecipients } = require("../feedback-logic");

test("matchReservationByEmail matches regardless of case/spaces", () => {
  const reservations = [
    { id: "1", email: "Alice@Example.FR" },
    { id: "2", email: "bob@example.fr" },
  ];
  expect(matchReservationByEmail(reservations, " alice@example.fr ").id).toBe("1");
  expect(matchReservationByEmail(reservations, "nobody@x.fr")).toBeNull();
});

function baseParams(overrides) {
  const session = new Date(2026, 6, 28, 20, 30, 0); // 28/07/2026 20h30
  return Object.assign(
    {
      reservations: [],
      avisReservationIds: new Set(),
      now: new Date(2026, 6, 29, 9, 0, 0), // J+1 à 9h
      sessionDate: session,
      feedbackEnabled: true,
    },
    overrides || {}
  );
}

test("returns nothing when feedback is disabled", () => {
  const out = selectFeedbackRecipients(baseParams({ feedbackEnabled: false,
    reservations: [{ id: "1", status: "active", email: "a@b.fr", prenom: "A" }] }));
  expect(out).toEqual([]);
});

test("returns nothing before session day + 1", () => {
  const out = selectFeedbackRecipients(baseParams({
    now: new Date(2026, 6, 28, 23, 0, 0), // même soir, trop tôt
    reservations: [{ id: "1", status: "active", email: "a@b.fr", prenom: "A" }],
  }));
  expect(out).toEqual([]);
});

test("first requests: only active, not opted-out, not already asked, no existing avis", () => {
  const out = selectFeedbackRecipients(baseParams({
    reservations: [
      { id: "1", status: "active", email: "a@b.fr", prenom: "A" },
      { id: "2", status: "cancelled", email: "c@b.fr", prenom: "C" },
      { id: "3", status: "active", email: "d@b.fr", prenom: "D", avisOptOut: true },
      { id: "4", status: "active", email: "e@b.fr", prenom: "E", avisRequestSent: true, avisRequestSentAt: new Date(2026, 6, 29, 8, 0, 0) },
    ],
    avisReservationIds: new Set(["1"]), // déjà un avis pour 1
  }));
  // seuls restent : aucun (1 a un avis, 2 annulé, 3 opt-out, 4 déjà sollicité récemment)
  expect(out.map((r) => r.reservationId)).toEqual([]);
});

test("first request produced for a fresh active reservation", () => {
  const out = selectFeedbackRecipients(baseParams({
    reservations: [{ id: "9", status: "active", email: "z@b.fr", prenom: "Zoe" }],
  }));
  expect(out).toEqual([{ reservationId: "9", type: "request", email: "z@b.fr", prenom: "Zoe" }]);
});

test("reminder after 3 days for someone asked but without avis", () => {
  const out = selectFeedbackRecipients(baseParams({
    now: new Date(2026, 7, 1, 9, 0, 0), // 3 jours après avisRequestSentAt
    reservations: [{
      id: "7", status: "active", email: "g@b.fr", prenom: "G",
      avisRequestSent: true, avisRequestSentAt: new Date(2026, 6, 29, 9, 0, 0),
    }],
  }));
  expect(out).toEqual([{ reservationId: "7", type: "reminder", email: "g@b.fr", prenom: "G" }]);
});

test("no reminder if avisRelanceSent already true", () => {
  const out = selectFeedbackRecipients(baseParams({
    now: new Date(2026, 7, 1, 9, 0, 0),
    reservations: [{
      id: "7", status: "active", email: "g@b.fr", prenom: "G",
      avisRequestSent: true, avisRequestSentAt: new Date(2026, 6, 29, 9, 0, 0), avisRelanceSent: true,
    }],
  }));
  expect(out).toEqual([]);
});

test("caps the total at maxPerDay, first requests prioritized", () => {
  const reservations = [];
  for (let i = 0; i < 60; i++) reservations.push({ id: "r" + i, status: "active", email: i + "@b.fr", prenom: "P" + i });
  const out = selectFeedbackRecipients(baseParams({ reservations: reservations, maxPerDay: 50 }));
  expect(out.length).toBe(50);
  expect(out.every((r) => r.type === "request")).toBe(true);
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `cd functions && npx jest test/feedback-logic.test.js`
Expected: FAIL (`matchReservationByEmail is not a function`).

- [ ] **Step 3 : Écrire l'implémentation**

Dans `functions/feedback-logic.js`, ajouter avant `module.exports` :

```js
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
  if (now < sessionDate + ONE_DAY_MS) return [];

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
```

Puis compléter `module.exports` avec :

```js
  matchReservationByEmail: matchReservationByEmail,
  selectFeedbackRecipients: selectFeedbackRecipients,
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `cd functions && npx jest test/feedback-logic.test.js`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add functions/feedback-logic.js functions/test/feedback-logic.test.js
git commit -m "feat: correspondance email + selection des destinataires d'avis"
```

---

### Task 3 : Constructeurs d'emails d'avis (`email-content.js`)

**Files:**
- Modify: `functions/email-content.js`
- Test: `functions/test/email-content.test.js`

**Interfaces:**
- Consumes : `SITE_URL` (déjà défini dans le module).
- Produces :
  - `buildFeedbackRequestEmail(reservation, reservationId) -> { to, subject, htmlContent }`
  - `buildFeedbackReminderEmail(reservation, reservationId) -> { to, subject, htmlContent }`
  - (`reservation` = `{ email, prenom }`)

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `functions/test/email-content.test.js` :

```js
const {
  buildFeedbackRequestEmail,
  buildFeedbackReminderEmail,
} = require("../email-content");

test("buildFeedbackRequestEmail targets the visitor and links to avis.html", () => {
  const email = buildFeedbackRequestEmail({ email: "jean@example.com", prenom: "Jean" }, "abc123");
  expect(email.to).toBe("jean@example.com");
  expect(email.htmlContent).toContain("Jean");
  expect(email.htmlContent).toContain("/avis.html?id=abc123");
});

test("buildFeedbackReminderEmail includes the avis link and an opt-out link", () => {
  const email = buildFeedbackReminderEmail({ email: "jean@example.com", prenom: "Jean" }, "abc123");
  expect(email.to).toBe("jean@example.com");
  expect(email.htmlContent).toContain("/avis.html?id=abc123");
  expect(email.htmlContent).toContain("stop=1");
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `cd functions && npx jest test/email-content.test.js`
Expected: FAIL (`buildFeedbackRequestEmail is not a function`).

- [ ] **Step 3 : Écrire l'implémentation**

Dans `functions/email-content.js`, ajouter après `buildOriaCancellationEmail` (avant `module.exports`) :

```js
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
```

Puis compléter `module.exports` avec :

```js
  buildFeedbackRequestEmail: buildFeedbackRequestEmail,
  buildFeedbackReminderEmail: buildFeedbackReminderEmail,
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `cd functions && npx jest`
Expected: PASS (toute la suite functions verte).

- [ ] **Step 5 : Commit**

```bash
git add functions/email-content.js functions/test/email-content.test.js
git commit -m "feat: emails de demande et de relance d'avis"
```

---

### Task 4 : Règles de sécurité Firestore (`avis` + `meta/session`)

**Files:**
- Modify: `firestore.rules`

**Interfaces:**
- Produces : collection `avis` inaccessible aux clients ; `meta/session` lisible.

- [ ] **Step 1 : Modifier les règles**

Dans `firestore.rules`, à l'intérieur du bloc `match /databases/{database}/documents {`, après le bloc `match /meta/gauge { ... }`, ajouter :

```
    match /meta/session {
      allow get: if true;
      allow list: if false;
      allow create, update, delete: if false;
    }

    match /avis/{avisId} {
      allow get, list: if false;
      allow create, update, delete: if false;
    }
```

- [ ] **Step 2 : Vérifier la syntaxe**

Run: `cd /Users/raphaellambert/cinema-plein-air-opio && firebase deploy --only firestore:rules`
Expected: `✔ Deploy complete!` (déploiement des règles réussi).

- [ ] **Step 3 : Commit**

```bash
git add firestore.rules
git commit -m "feat: regles Firestore pour avis et meta/session"
```

---

### Task 5 : Fonctions `submitFeedback` et `stopFeedback` (`index.js`)

**Files:**
- Modify: `functions/index.js`

**Interfaces:**
- Consumes : `validateFeedbackInput`, `normalizeEmail`, `matchReservationByEmail` (feedback-logic) ; `db`, `FieldValue`, `HttpsError`, `onCall`, `logger`.
- Produces : callable `submitFeedback({ mode, reservationId?, email?, note, commentaire?, film_souhaite?, publication_autorisee? })` et callable `stopFeedback({ reservationId })`.

- [ ] **Step 1 : Ajouter les imports**

Dans `functions/index.js`, après la ligne `const { validateReservationInput, MAX_PLACES } = require("./reservation-logic");`, ajouter :

```js
const {
  validateFeedbackInput,
  matchReservationByEmail,
  normalizeEmail,
} = require("./feedback-logic");
```

Et compléter la liste importée depuis `./email-content` (bloc `const { ... } = require("./email-content");`) en y ajoutant `buildFeedbackRequestEmail,` et `buildFeedbackReminderEmail,`.

- [ ] **Step 2 : Ajouter `submitFeedback` et `stopFeedback`**

Dans `functions/index.js`, après la fonction `exports.cancelReservation = onCall(...)` (avant `exports.onReservationCreated`), ajouter :

```js
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
  await db.collection("reservations").doc(reservationId).set(
    { avisOptOut: true }, { merge: true }
  );
  logger.info("Feedback opt-out", { reservationId: reservationId });
  return { success: true };
});
```

- [ ] **Step 3 : Vérifier que la suite de tests functions passe toujours**

Run: `cd functions && npx jest`
Expected: PASS (les modifications d'`index.js` n'affectent pas les tests unitaires ; on vérifie l'absence de régression).

- [ ] **Step 4 : Vérifier que le fichier se charge sans erreur de syntaxe**

Run: `cd functions && node -e "require('./index.js'); console.log('index.js OK')"`
Expected: affiche `index.js OK` (pas d'erreur de syntaxe/chargement).

- [ ] **Step 5 : Commit**

```bash
git add functions/index.js
git commit -m "feat: fonctions submitFeedback et stopFeedback"
```

---

### Task 6 : Fonction programmée `sendFeedbackRequests` (`index.js`)

**Files:**
- Modify: `functions/index.js`

**Interfaces:**
- Consumes : `selectFeedbackRecipients` (feedback-logic) ; `buildFeedbackRequestEmail`, `buildFeedbackReminderEmail` ; `sendEmail`, `db`, `FieldValue`, `BREVO_API_KEY`, `logger`.
- Produces : fonction programmée `sendFeedbackRequests` (quotidienne 9h Europe/Paris).

- [ ] **Step 1 : Ajouter les imports**

Dans `functions/index.js`, après la ligne `const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");`, ajouter :

```js
const { onSchedule } = require("firebase-functions/v2/scheduler");
```

Compléter l'import depuis `./feedback-logic` (créé en Task 5) pour y ajouter `selectFeedbackRecipients` :

```js
const {
  validateFeedbackInput,
  matchReservationByEmail,
  selectFeedbackRecipients,
} = require("./feedback-logic");
```

- [ ] **Step 2 : Ajouter la fonction programmée**

À la fin de `functions/index.js`, ajouter :

```js
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
```

- [ ] **Step 3 : Vérifier le chargement du fichier**

Run: `cd functions && node -e "require('./index.js'); console.log('index.js OK')"`
Expected: affiche `index.js OK`.

- [ ] **Step 4 : Commit**

```bash
git add functions/index.js
git commit -m "feat: fonction programmee sendFeedbackRequests (9h, inerte tant que non activee)"
```

---

### Task 7 : Page `avis.html`

**Files:**
- Create: `public/avis.html`

**Interfaces:**
- Consumes : callables `submitFeedback`, `stopFeedback` ; lecture `getDoc(reservations/{id})`.

- [ ] **Step 1 : Créer la page**

Créer `public/avis.html` :

```html
<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Votre avis — Cinéma en plein air d'Opio</title>
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..600&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --c-bg:#15101F; --c-surface:#241A38; --c-gold:#E8A33D;
    --c-gold-soft:rgba(232,163,61,0.16); --c-ivory:#F6F1E7;
    --c-muted:#B8AFC9; --c-border:rgba(246,241,231,0.1);
    --font-display:'Fraunces',serif; --font-body:'Outfit',sans-serif;
  }
  *,*::before,*::after{box-sizing:border-box;}
  body{margin:0;background:var(--c-bg);color:var(--c-ivory);
    font-family:var(--font-body);line-height:1.6;
    -webkit-font-smoothing:antialiased;padding:0 20px;}
  .wrap{max-width:560px;margin:56px auto;}
  h1{font-family:var(--font-display);font-weight:600;font-size:1.7rem;line-height:1.15;margin:0 0 8px;}
  .lead{color:var(--c-muted);margin-bottom:28px;}
  .card{background:rgba(36,26,56,0.6);border:1px solid var(--c-border);
    border-radius:20px;padding:32px;backdrop-filter:blur(14px);}
  label{display:block;font-size:0.85rem;font-weight:500;margin-bottom:8px;color:var(--c-muted);}
  input[type=email],textarea{width:100%;padding:14px 16px;border-radius:12px;
    border:1px solid var(--c-border);background:rgba(21,16,31,0.6);color:var(--c-ivory);
    font-family:var(--font-body);font-size:1rem;resize:vertical;}
  input[type=email]:focus,textarea:focus{outline:none;border-color:var(--c-gold);
    box-shadow:0 0 0 3px var(--c-gold-soft);}
  .field{margin-bottom:20px;}
  .stars{display:flex;gap:8px;margin-bottom:4px;}
  .star{font-size:2rem;line-height:1;background:none;border:none;cursor:pointer;
    color:rgba(246,241,231,0.28);transition:color .15s ease,transform .1s ease;padding:0;}
  .star:hover,.star.active{color:var(--c-gold);}
  .star:active{transform:scale(0.9);}
  .consent{display:flex;gap:10px;align-items:flex-start;font-size:0.9rem;color:var(--c-muted);margin-bottom:24px;}
  .consent input{margin-top:3px;}
  button.submit{width:100%;background:var(--c-gold);color:#231A12;border:none;
    border-radius:999px;padding:15px 24px;font-family:var(--font-body);font-size:1rem;
    font-weight:600;cursor:pointer;transition:filter .2s ease;}
  button.submit:hover{filter:brightness(1.07);}
  button.submit:disabled{opacity:0.5;cursor:not-allowed;}
  a{color:var(--c-gold);}
  .state{display:none;}
  .home{margin-top:24px;font-size:0.9rem;}
</style>
</head>
<body>
  <div class="wrap">
    <h1>Votre avis compte</h1>
    <p class="lead" id="lead">Merci d'avoir participé au Cinéma en plein air d'Opio !</p>

    <div class="card state" id="loading-state" style="display:block">Chargement…</div>

    <div class="card state" id="form-state">
      <div class="field" id="email-field" style="display:none">
        <label for="email">Votre email</label>
        <input type="email" id="email" autocomplete="email" placeholder="vous@exemple.fr">
      </div>

      <div class="field">
        <label>Votre note sur la séance</label>
        <div class="stars" id="stars" role="radiogroup" aria-label="Note de 1 à 5 étoiles">
          <button type="button" class="star" data-value="1" aria-label="1 étoile">★</button>
          <button type="button" class="star" data-value="2" aria-label="2 étoiles">★</button>
          <button type="button" class="star" data-value="3" aria-label="3 étoiles">★</button>
          <button type="button" class="star" data-value="4" aria-label="4 étoiles">★</button>
          <button type="button" class="star" data-value="5" aria-label="5 étoiles">★</button>
        </div>
      </div>

      <div class="field">
        <label for="commentaire">Un commentaire ? (facultatif)</label>
        <textarea id="commentaire" rows="3" placeholder="Ce que vous avez aimé, ce qu'on pourrait améliorer…"></textarea>
      </div>

      <div class="field">
        <label for="film">Quel film aimeriez-vous voir la prochaine fois ? (facultatif)</label>
        <textarea id="film" rows="2" placeholder="Un titre, un genre…"></textarea>
      </div>

      <label class="consent">
        <input type="checkbox" id="consent">
        <span>J'autorise le Cinéma en plein air d'Opio à publier mon avis (avec mon prénom) sur son site.</span>
      </label>

      <button type="button" class="submit" id="submit-btn">Envoyer mon avis</button>
    </div>

    <div class="card state" id="success-state">
      <p>Merci beaucoup pour votre retour&nbsp;! 🌟 Il nous aide à rendre les prochaines séances encore meilleures.</p>
    </div>

    <div class="card state" id="already-state">
      <p>Vous avez déjà donné votre avis pour cette séance — merci&nbsp;!</p>
    </div>

    <div class="card state" id="stop-state">
      <p>C'est noté : vous ne recevrez plus de demande d'avis. Merci&nbsp;!</p>
    </div>

    <div class="card state" id="error-state">
      <p>Une erreur est survenue, ou ce lien n'est pas valide. Réessayez plus tard.</p>
    </div>

    <p class="home"><a href="/">← Retour au site du Cinéma en plein air d'Opio</a></p>
  </div>

<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
  import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
  import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

  var firebaseConfig = {
    apiKey: "AIzaSyBB-WiFkZfrHQD9rXDQ6KjbeNQyMlO4VbA",
    authDomain: "cinema-en-pleine-air-opi-ac81e.firebaseapp.com",
    projectId: "cinema-en-pleine-air-opi-ac81e",
    storageBucket: "cinema-en-pleine-air-opi-ac81e.firebasestorage.app",
    messagingSenderId: "245777069404",
    appId: "1:245777069404:web:8478506b55ec08fb8abd99"
  };
  var app = initializeApp(firebaseConfig);
  var db = getFirestore(app);
  var functions = getFunctions(app);
  var submitFeedback = httpsCallable(functions, 'submitFeedback');
  var stopFeedback = httpsCallable(functions, 'stopFeedback');

  var params = new URLSearchParams(window.location.search);
  var reservationId = params.get('id');
  var source = params.get('source');
  var stop = params.get('stop');

  var el = function (id) { return document.getElementById(id); };
  function show(id) {
    ['loading-state','form-state','success-state','already-state','stop-state','error-state']
      .forEach(function (s) { el(s).style.display = (s === id) ? 'block' : 'none'; });
  }

  var note = 0;
  function setStars(v) {
    note = v;
    var stars = document.querySelectorAll('.star');
    stars.forEach(function (s) {
      s.classList.toggle('active', Number(s.dataset.value) <= v);
    });
  }
  document.querySelectorAll('.star').forEach(function (s) {
    s.addEventListener('click', function () { setStars(Number(s.dataset.value)); });
  });

  var mode = null; // "email" | "qr"

  async function init() {
    if (reservationId && stop === '1') {
      try { await stopFeedback({ reservationId: reservationId }); show('stop-state'); }
      catch (e) { show('error-state'); }
      return;
    }
    if (reservationId) {
      mode = 'email';
      try {
        var snap = await getDoc(doc(db, 'reservations', reservationId));
        if (!snap.exists()) { show('error-state'); return; }
        el('lead').textContent = 'Bonjour ' + snap.data().prenom + ', merci d\'avoir participé !';
        el('email-field').style.display = 'none';
        show('form-state');
      } catch (e) { show('error-state'); }
      return;
    }
    if (source === 'qr') {
      mode = 'qr';
      el('email-field').style.display = 'block';
      show('form-state');
      return;
    }
    show('error-state');
  }

  el('submit-btn').addEventListener('click', async function () {
    if (note < 1) { alert('Merci de choisir une note (1 à 5 étoiles).'); return; }
    var payload = {
      mode: mode,
      note: note,
      commentaire: el('commentaire').value,
      film_souhaite: el('film').value,
      publication_autorisee: el('consent').checked,
    };
    if (mode === 'email') {
      payload.reservationId = reservationId;
    } else {
      var email = el('email').value.trim();
      if (!email) { alert('Merci d\'indiquer votre email.'); return; }
      payload.email = email;
    }
    var btn = el('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Envoi…';
    try {
      await submitFeedback(payload);
      show('success-state');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Envoyer mon avis';
      if (err && err.message && err.message.indexOf('ALREADY_SUBMITTED') !== -1) {
        show('already-state');
      } else {
        alert('Impossible d\'envoyer votre avis, réessayez.');
      }
    }
  });

  init();
</script>
</body>
</html>
```

- [ ] **Step 2 : Déployer l'hébergement**

Run: `cd /Users/raphaellambert/cinema-plein-air-opio && firebase deploy --only hosting`
Expected: `✔ Deploy complete!`

- [ ] **Step 3 : Vérifier que la page répond**

Run: `curl -s -o /dev/null -w "%{http_code}\n" "https://cinema-en-pleine-air-opio.oria-events.fr/avis.html?source=qr"`
Expected: `200`

- [ ] **Step 4 : Commit**

```bash
git add public/avis.html
git commit -m "feat: page avis.html (modes email/QR/desinscription)"
```

---

### Task 8 : Déployer les fonctions + créer `meta/session` (Opio, inerte)

**Files:**
- Create: `outils-export/init-session.js`

**Interfaces:**
- Consumes : `outils-export/cle-admin.json` (clé admin déjà présente).
- Produces : document `meta/session` avec `sessionDate = 28/07/2026 20:30`, `feedbackEnabled = false`.

- [ ] **Step 1 : Déployer les nouvelles fonctions**

Run: `cd /Users/raphaellambert/cinema-plein-air-opio && firebase deploy --only functions`
Expected: `✔ Deploy complete!` — les fonctions `submitFeedback`, `stopFeedback`, `sendFeedbackRequests` apparaissent comme créées/à jour.

- [ ] **Step 2 : Créer le script d'initialisation de session**

Créer `outils-export/init-session.js` :

```js
// Crée/maj le document meta/session (Opio) — feedback DÉSACTIVÉ par défaut.
const path = require("path");
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, "cle-admin.json"))) });
const db = admin.firestore();

db.collection("meta").doc("session").set({
  sessionDate: new Date(2026, 6, 28, 20, 30, 0), // 28/07/2026 20h30
  feedbackEnabled: false,                        // inerte : aucun envoi automatique
}, { merge: true }).then(function () {
  console.log("meta/session créé (feedbackEnabled: false).");
  process.exit(0);
}).catch(function (e) { console.error(e); process.exit(1); });
```

- [ ] **Step 3 : Exécuter le script**

Run: `cd /Users/raphaellambert/cinema-plein-air-opio/outils-export && node init-session.js`
Expected: affiche `meta/session créé (feedbackEnabled: false).`

- [ ] **Step 4 : Commit**

```bash
git add outils-export/init-session.js
git commit -m "chore: script d'init meta/session (Opio, feedback inerte)"
```

---

### Task 9 : Outil d'export des avis (`export-avis.js`)

**Files:**
- Create: `outils-export/export-avis.js`

**Interfaces:**
- Consumes : `outils-export/cle-admin.json`, `firebase-admin`, `exceljs` (déjà installés).
- Produces : `outils-export/avis-<horodatage>.xlsx`.

- [ ] **Step 1 : Créer le script d'export**

Créer `outils-export/export-avis.js` :

```js
// Export des avis vers un fichier Excel (.xlsx). Usage : node export-avis.js
const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");
const ExcelJS = require("exceljs");

const KEY_PATH = path.join(__dirname, "cle-admin.json");
if (!fs.existsSync(KEY_PATH)) {
  console.error("\n❌ Clé admin introuvable : " + KEY_PATH + "\n");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
  });
}

async function main() {
  console.log("Lecture des avis…");
  const snap = await db.collection("avis").orderBy("createdAt", "asc").get();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Avis");
  ws.columns = [
    { header: "Note", key: "note", width: 7 },
    { header: "Commentaire", key: "commentaire", width: 45 },
    { header: "Film souhaité", key: "film_souhaite", width: 28 },
    { header: "Prénom", key: "prenom", width: 16 },
    { header: "Nom", key: "nom", width: 16 },
    { header: "Email", key: "email", width: 28 },
    { header: "Source", key: "source", width: 10 },
    { header: "Publication autorisée", key: "publication", width: 20 },
    { header: "Date", key: "date", width: 18 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8A33D" } };

  let total = 0, sommeNotes = 0;
  snap.forEach(function (doc) {
    const d = doc.data();
    total++;
    sommeNotes += Number(d.note || 0);
    ws.addRow({
      note: d.note,
      commentaire: d.commentaire || "",
      film_souhaite: d.film_souhaite || "",
      prenom: d.prenom || "",
      nom: d.nom || "",
      email: d.email || "",
      source: d.source || "",
      publication: d.publication_autorisee ? "Oui" : "Non",
      date: formatDate(d.createdAt),
    });
  });
  ws.addRow({});
  const moyenne = total > 0 ? (sommeNotes / total).toFixed(2) : "-";
  const totalRow = ws.addRow({ commentaire: "Note moyenne :", film_souhaite: moyenne + " / 5", note: total });
  totalRow.font = { bold: true };

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const outPath = path.join(__dirname, "avis-" + stamp + ".xlsx");
  await wb.xlsx.writeFile(outPath);
  console.log("\n✅ Export terminé : " + path.basename(outPath));
  console.log("   " + total + " avis, note moyenne " + moyenne + " / 5.");
  console.log("   Fichier : " + outPath + "\n");
}

main().catch(function (err) { console.error("Erreur :", err); process.exit(1); });
```

- [ ] **Step 2 : Vérifier le chargement du script (sans données requises)**

Run: `cd /Users/raphaellambert/cinema-plein-air-opio/outils-export && node -e "require('exceljs'); require('firebase-admin'); console.log('deps OK')"`
Expected: affiche `deps OK`.

- [ ] **Step 3 : Commit**

```bash
git add outils-export/export-avis.js
git commit -m "feat: export Excel des avis"
```

---

### Task 10 : Génération du QR code (`genere-qr.js`)

**Files:**
- Create: `outils-export/genere-qr.js`
- Modify: `outils-export/package.json`

**Interfaces:**
- Consumes : dépendance `qrcode`.
- Produces : `outils-export/qr-avis-opio.png` (encode `SITE_URL + "/avis.html?source=qr"`).

- [ ] **Step 1 : Ajouter la dépendance `qrcode` et ignorer les PNG**

Dans `outils-export/package.json`, ajouter `"qrcode": "^1.5.4"` dans `dependencies` (à côté de `exceljs` et `firebase-admin`).

Dans `outils-export/.gitignore`, ajouter une ligne `*.png` (pour ne jamais committer l'image QR générée).

- [ ] **Step 2 : Installer**

Run: `cd /Users/raphaellambert/cinema-plein-air-opio/outils-export && npm install`
Expected: installation sans erreur.

- [ ] **Step 3 : Créer le script**

Créer `outils-export/genere-qr.js` :

```js
// Génère l'image QR (PNG) pointant vers le formulaire d'avis (mode QR).
const path = require("path");
const QRCode = require("qrcode");

const URL = "https://cinema-en-pleine-air-opio.oria-events.fr/avis.html?source=qr";
const OUT = path.join(__dirname, "qr-avis-opio.png");

QRCode.toFile(OUT, URL, { width: 900, margin: 2, color: { dark: "#241A38", light: "#FFFFFF" } })
  .then(function () {
    console.log("✅ QR code généré : " + OUT);
    console.log("   Pointe vers : " + URL);
  })
  .catch(function (err) { console.error("Erreur QR :", err); process.exit(1); });
```

- [ ] **Step 4 : Générer le QR et vérifier le fichier**

Run: `cd /Users/raphaellambert/cinema-plein-air-opio/outils-export && node genere-qr.js && ls -la qr-avis-opio.png`
Expected: affiche `✅ QR code généré` et le fichier `qr-avis-opio.png` existe (taille > 0).

- [ ] **Step 5 : Commit** (le PNG et la clé restent ignorés par `.gitignore`)

```bash
git add outils-export/genere-qr.js outils-export/package.json outils-export/package-lock.json outils-export/.gitignore
git commit -m "feat: generation du QR code vers le formulaire d'avis"
```

---

### Task 11 : Test manuel bout-en-bout + note de version

**Files:**
- Create: `releases/v12.md`
- Modify: `releases/README.md`, `GUIDE.md`

**Interfaces:** aucune (validation + documentation).

- [ ] **Step 1 : Test mode email**

Sur le site en ligne, récupérer un `reservationId` de test (via l'outil d'export ou la console Firebase). Ouvrir :
`https://cinema-en-pleine-air-opio.oria-events.fr/avis.html?id=<reservationId>`
Vérifier : accueil par le prénom, choix d'étoiles, envoi → message de remerciement. Recharger la même URL et renvoyer → message « déjà donné votre avis ».

- [ ] **Step 2 : Test mode QR**

Ouvrir `https://cinema-en-pleine-air-opio.oria-events.fr/avis.html?source=qr`.
Saisir un email correspondant à une réservation existante + une note → envoyer. Vérifier via `node export-avis.js` que l'avis est bien relié (prénom/nom renseignés). Tester aussi un email inconnu → avis enregistré sans nom.

- [ ] **Step 3 : Test désinscription**

Ouvrir `https://cinema-en-pleine-air-opio.oria-events.fr/avis.html?id=<reservationId>&stop=1`.
Vérifier le message de désinscription, puis dans Firestore que la réservation a `avisOptOut = true`.

- [ ] **Step 4 : Export des avis**

Run: `cd /Users/raphaellambert/cinema-plein-air-opio/outils-export && node export-avis.js`
Expected: fichier `avis-<horodatage>.xlsx` créé, note moyenne affichée.

- [ ] **Step 5 : Nettoyer les avis de test**

Supprimer les documents d'avis de test dans la console Firebase (collection `avis`) et remettre `avisOptOut`/`avisRequestSent` des réservations de test si nécessaire (via console).

- [ ] **Step 6 : Note de version + guide**

Créer `releases/v12.md` décrivant : système d'avis post-séance (page `avis.html`, modes email/QR, envoi programmé inerte, relance, export, QR code). Ajouter la ligne v12 en tête de `releases/README.md`. Ajouter dans `GUIDE.md` une section « Recueillir les avis » (comment activer l'envoi — passer `meta/session.feedbackEnabled` à `true` —, où trouver le QR, comment exporter les avis).

- [ ] **Step 7 : Commit**

```bash
git add releases/v12.md releases/README.md GUIDE.md
git commit -m "docs: note de version v12 + guide systeme d'avis"
```

---

## Notes d'activation (post-construction)

- Pour **Opio** : `meta/session.feedbackEnabled` reste `false` → aucun envoi automatique. Le QR code reste utilisable indépendamment (il ne dépend pas de cet interrupteur).
- Pour **activer l'envoi automatique** (prochaines séances) : mettre `sessionDate` à la date de la séance et `feedbackEnabled: true` (via `init-session.js` adapté ou la console). Le réveil de 9h enverra alors les demandes le lendemain, 50/jour, avec relance à J+3.
