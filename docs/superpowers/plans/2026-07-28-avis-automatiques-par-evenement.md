# Demandes d'avis automatiques par événement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre les demandes d'avis automatiques et pilotées par la collection `events` : chaque matin à 9h, pour chaque séance passée, récente (≤14 j) et non désactivée, envoyer les demandes d'avis à ses réservants — sans `meta/session` ni activation manuelle.

**Architecture:** `selectFeedbackRecipients` (logique pure) devient multi-événements : elle reçoit la liste des `events` (avec date + interrupteur `feedbackEnabled`) et sélectionne globalement les destinataires (plafond 50/jour, relance J+3, fenêtre 14 j). `sendFeedbackRequests` lit `events` + réservations + avis, ne lit plus `meta/session`, et envoie chaque email avec la date/film de la bonne séance.

**Tech Stack:** Node.js Cloud Functions v2 (onSchedule), Jest.

## Global Constraints

- Fenêtre : `FEEDBACK_WINDOW_DAYS = 14`. Plafond : `MAX_FEEDBACK_EMAILS_PER_DAY = 50`. Relance : `FEEDBACK_REMINDER_DELAY_DAYS = 3`.
- Une séance est éligible si : `feedbackEnabled !== false` (absent = activé) ET `jour(now) > jour(dateISO)` (passée) ET `jour(dateISO) >= jour(now) − 14` (récente).
- La sortie de `selectFeedbackRecipients` garde exactement la forme `{ reservationId, type, email, prenom }` (l'appelant retrouve la séance via l'`eventId` de la réservation).
- `sendFeedbackRequests` ne marque `avisRequestSent`/`avisRelanceSent` **qu'après** un envoi réussi. `DEFAULT_EVENT_ID = "opio-2026-07-28"` en repli.
- Tests depuis `functions/`, commande `npm test`. `index.js` non testé unitairement → `node --check`.

---

### Task 1 : `selectFeedbackRecipients` multi-événements + fenêtre

**Files:**
- Modify: `functions/feedback-logic.js`
- Modify: `functions/test/feedback-logic.test.js` (bloc `selectFeedbackRecipients`, lignes ~73-162)

**Interfaces:**
- Produces : `selectFeedbackRecipients({ reservations, events, avisReservationIds, now, maxPerDay?, reminderDelayDays?, windowDays? }) → [{ reservationId, type, email, prenom }]`. `events` = liste de `{ id, sessionDate, feedbackEnabled? }`. Chaque réservation porte `eventId`. Nouvelle constante exportée `FEEDBACK_WINDOW_DAYS = 14`.

- [ ] **Step 1 : Réécrire le bloc de tests (échec attendu)**

Dans `functions/test/feedback-logic.test.js`, remplacer **tout** ce qui va de `function baseParams(overrides) {` (ligne 73) jusqu'à la fin du fichier par :

```js
function baseParams(overrides) {
  return Object.assign(
    {
      reservations: [],
      events: [{ id: "opio-2026-07-28", sessionDate: new Date(2026, 6, 28, 20, 30, 0) }],
      avisReservationIds: new Set(),
      now: new Date(2026, 6, 29, 9, 0, 0), // J+1 à 9h (le lendemain matin)
    },
    overrides || {}
  );
}

test("ne cible que les reservations d'une seance eligible", () => {
  const out = selectFeedbackRecipients(baseParams({
    reservations: [
      { id: "a", eventId: "opio-2026-07-28", status: "active", email: "a@b.fr", prenom: "A" },
      { id: "b", eventId: "opio-2026-08-18", status: "active", email: "b@b.fr", prenom: "B" },
    ],
  }));
  expect(out.map(function (r) { return r.reservationId; })).toEqual(["a"]);
});

test("une seance avec feedbackEnabled:false est ignoree", () => {
  const out = selectFeedbackRecipients(baseParams({
    events: [{ id: "opio-2026-07-28", sessionDate: new Date(2026, 6, 28, 20, 30, 0), feedbackEnabled: false }],
    reservations: [{ id: "1", eventId: "opio-2026-07-28", status: "active", email: "a@b.fr", prenom: "A" }],
  }));
  expect(out).toEqual([]);
});

test("rien le soir meme (seance pas encore passee)", () => {
  const out = selectFeedbackRecipients(baseParams({
    now: new Date(2026, 6, 28, 23, 0, 0),
    reservations: [{ id: "1", eventId: "opio-2026-07-28", status: "active", email: "a@b.fr", prenom: "A" }],
  }));
  expect(out).toEqual([]);
});

test("les reservants d'une seance future ne recoivent rien", () => {
  const out = selectFeedbackRecipients(baseParams({
    events: [{ id: "opio-2026-08-18", sessionDate: new Date(2026, 7, 18, 20, 30, 0) }],
    reservations: [{ id: "x", eventId: "opio-2026-08-18", status: "active", email: "x@b.fr", prenom: "X" }],
  }));
  expect(out).toEqual([]);
});

test("une seance passee de plus de 14 jours est hors fenetre", () => {
  const out = selectFeedbackRecipients(baseParams({
    events: [{ id: "vieux", sessionDate: new Date(2026, 6, 10, 20, 30, 0) }], // 10 juillet, 19 j avant le 29
    reservations: [{ id: "o", eventId: "vieux", status: "active", email: "o@b.fr", prenom: "O" }],
  }));
  expect(out).toEqual([]);
});

test("deux seances eligibles : chacun ses reservants", () => {
  const out = selectFeedbackRecipients(baseParams({
    events: [
      { id: "e1", sessionDate: new Date(2026, 6, 28, 20, 30, 0) },
      { id: "e2", sessionDate: new Date(2026, 6, 27, 20, 30, 0) },
    ],
    reservations: [
      { id: "a", eventId: "e1", status: "active", email: "a@b.fr", prenom: "A" },
      { id: "b", eventId: "e2", status: "active", email: "b@b.fr", prenom: "B" },
    ],
  }));
  expect(out.map(function (r) { return r.reservationId; }).sort()).toEqual(["a", "b"]);
});

test("first requests: only active, not opted-out, not already asked, no existing avis", () => {
  const out = selectFeedbackRecipients(baseParams({
    reservations: [
      { id: "1", eventId: "opio-2026-07-28", status: "active", email: "a@b.fr", prenom: "A" },
      { id: "2", eventId: "opio-2026-07-28", status: "cancelled", email: "c@b.fr", prenom: "C" },
      { id: "3", eventId: "opio-2026-07-28", status: "active", email: "d@b.fr", prenom: "D", avisOptOut: true },
      { id: "4", eventId: "opio-2026-07-28", status: "active", email: "e@b.fr", prenom: "E", avisRequestSent: true, avisRequestSentAt: new Date(2026, 6, 29, 8, 0, 0) },
    ],
    avisReservationIds: new Set(["1"]),
  }));
  expect(out.map(function (r) { return r.reservationId; })).toEqual([]);
});

test("first request produced for a fresh active reservation", () => {
  const out = selectFeedbackRecipients(baseParams({
    reservations: [{ id: "9", eventId: "opio-2026-07-28", status: "active", email: "z@b.fr", prenom: "Zoe" }],
  }));
  expect(out).toEqual([{ reservationId: "9", type: "request", email: "z@b.fr", prenom: "Zoe" }]);
});

test("reminder after 3 days for someone asked but without avis", () => {
  const out = selectFeedbackRecipients(baseParams({
    now: new Date(2026, 7, 1, 9, 0, 0),
    reservations: [{
      id: "7", eventId: "opio-2026-07-28", status: "active", email: "g@b.fr", prenom: "G",
      avisRequestSent: true, avisRequestSentAt: new Date(2026, 6, 29, 9, 0, 0),
    }],
  }));
  expect(out).toEqual([{ reservationId: "7", type: "reminder", email: "g@b.fr", prenom: "G" }]);
});

test("no reminder if avisRelanceSent already true", () => {
  const out = selectFeedbackRecipients(baseParams({
    now: new Date(2026, 7, 1, 9, 0, 0),
    reservations: [{
      id: "7", eventId: "opio-2026-07-28", status: "active", email: "g@b.fr", prenom: "G",
      avisRequestSent: true, avisRequestSentAt: new Date(2026, 6, 29, 9, 0, 0), avisRelanceSent: true,
    }],
  }));
  expect(out).toEqual([]);
});

test("caps the total at maxPerDay, first requests prioritized", () => {
  const reservations = [];
  for (let i = 0; i < 60; i++) reservations.push({ id: "r" + i, eventId: "opio-2026-07-28", status: "active", email: i + "@b.fr", prenom: "P" + i });
  const out = selectFeedbackRecipients(baseParams({ reservations: reservations, maxPerDay: 50 }));
  expect(out.length).toBe(50);
  expect(out.every(function (r) { return r.type === "request"; })).toBe(true);
});
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `cd functions && npm test -- feedback-logic`
Expected: FAIL (l'ancienne signature `sessionDate`/`feedbackEnabled` ne gère pas `events`).

- [ ] **Step 3 : Réécrire la fonction**

Dans `functions/feedback-logic.js` :

(a) Ajouter la constante sous `const ONE_DAY_MS = ...` :

```js
const FEEDBACK_WINDOW_DAYS = 14;
```

(b) Remplacer entièrement `selectFeedbackRecipients` par :

```js
function selectFeedbackRecipients(params) {
  const reservations = params.reservations || [];
  const events = params.events || [];
  const avisReservationIds = params.avisReservationIds || new Set();
  const now = toMillis(params.now);
  const maxPerDay = params.maxPerDay || MAX_FEEDBACK_EMAILS_PER_DAY;
  const reminderDelayMs = (params.reminderDelayDays || FEEDBACK_REMINDER_DELAY_DAYS) * ONE_DAY_MS;
  const windowDays = params.windowDays || FEEDBACK_WINDOW_DAYS;

  if (typeof now !== "number") return [];
  const nowDay = new Date(now); nowDay.setHours(0, 0, 0, 0);
  const nowDayMs = nowDay.getTime();
  const windowStartMs = nowDayMs - windowDays * ONE_DAY_MS;

  const eligible = new Set();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.feedbackEnabled === false) continue;
    const sd = toMillis(ev.sessionDate);
    if (typeof sd !== "number") continue;
    const sessionDay = new Date(sd); sessionDay.setHours(0, 0, 0, 0);
    const sessionDayMs = sessionDay.getTime();
    if (nowDayMs <= sessionDayMs) continue;      // pas encore le lendemain
    if (sessionDayMs < windowStartMs) continue;  // trop ancien (hors fenêtre)
    eligible.add(ev.id);
  }

  const firstRequests = [];
  const reminders = [];
  for (let i = 0; i < reservations.length; i++) {
    const r = reservations[i];
    if (!eligible.has(r.eventId)) continue;
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

(c) Dans `module.exports`, ajouter `FEEDBACK_WINDOW_DAYS: FEEDBACK_WINDOW_DAYS,`.

- [ ] **Step 4 : Lancer (succès)**

Run: `cd functions && npm test -- feedback-logic`
Expected: PASS (tous les tests du bloc).

- [ ] **Step 5 : Commit**

```bash
git add functions/feedback-logic.js functions/test/feedback-logic.test.js
git commit -m "feat: selection des avis multi-evenements + fenetre 14j"
```

---

### Task 2 : `sendFeedbackRequests` piloté par les événements

**Files:**
- Modify: `functions/index.js` (la fonction `sendFeedbackRequests`)

**Interfaces:**
- Consumes : `selectFeedbackRecipients` (Task 1, nouvelle signature), builders d'avis event-aware, `loadEvent`/`DEFAULT_EVENT_ID` (existants).

- [ ] **Step 1 : Remplacer le corps de `sendFeedbackRequests`**

Remplacer tout le corps du callback de `sendFeedbackRequests` (depuis la lecture de `meta/session` jusqu'au `logger.info("Feedback: campagne terminée", ...)` final) par :

```js
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
```

> Note : la déclaration `onSchedule({ schedule: "0 9 * * *", timeZone: "Europe/Paris", secrets: [BREVO_API_KEY] }, ...)` reste inchangée — on ne remplace que le corps de la fonction async. `meta/session` n'est plus lu.

- [ ] **Step 2 : Vérifier la syntaxe + suite complète**

Run: `cd functions && node --check index.js && npm test`
Expected: `node --check` OK ; toutes les suites PASS.

- [ ] **Step 3 : Commit**

```bash
git add functions/index.js
git commit -m "feat: sendFeedbackRequests pilote par les events (plus de meta/session)"
```

---

### Task 3 : Note de version + guide

**Files:**
- Create: `releases/v16.md`
- Modify: `releases/README.md`, `GUIDE.md`

- [ ] **Step 1 : Note de version**

Créer `releases/v16.md` :

```markdown
# v16 — 2026-07-28

Demandes d'avis automatiques, pilotées par les séances.

## Nouveautés

- Les demandes d'avis partent **automatiquement le lendemain de chaque séance**,
  sans activation manuelle : il suffit que la fiche de la séance existe dans
  `events`. Elles ne concernent que les réservants de cette séance.
- **Interrupteur par séance** : un champ `feedbackEnabled` sur la fiche `events`,
  mis à `false`, désactive les avis pour cette séance (absent = activé).
- Garde-fous inchangés : 50 emails/jour maximum (le reste le lendemain), une
  relance à J+3, lien de désinscription, jamais deux fois la même personne.
- **Fenêtre de 14 jours** : une séance n'est « ouverte aux avis » que 14 jours
  après sa date (évite les envois tardifs et le rescan d'anciennes séances).

## Technique

- `selectFeedbackRecipients` devient multi-événements (fenêtre + interrupteur).
- `sendFeedbackRequests` (programmée 9h) est piloté par la collection `events` ;
  `meta/session` n'est plus utilisé.
```

- [ ] **Step 2 : Index des versions**

Dans `releases/README.md`, ajouter en haut de la liste `## Versions` :

```markdown
- [v16](v16.md) — 2026-07-28 — Demandes d'avis automatiques pilotées par les séances (interrupteur + fenêtre 14 j).
```

- [ ] **Step 3 : Guide**

Dans `GUIDE.md`, dans la section relative aux avis (« 💬 … avis »), ajouter un court paragraphe : les demandes d'avis partent désormais **automatiquement le lendemain de chaque séance** (plus besoin d'activer quoi que ce soit) ; pour **désactiver** les avis d'une séance précise, mettre le champ `feedbackEnabled` à `false` sur sa fiche dans la collection `events` (Firebase → Firestore → `events` → document de la séance).

- [ ] **Step 4 : Commit**

```bash
git add releases/v16.md releases/README.md GUIDE.md
git commit -m "docs: note de version v16 + guide avis automatiques"
```

---

## Déploiement (contrôleur, après implémentation — hors tâches)

1. `cd functions && npm test` (tout vert).
2. `firebase deploy --only functions` — **aujourd'hui**, bien avant demain 9h.
3. Vérifier (tests) que le 28/07 reste couvert. Le 28/07 (fiche `events` sans
   `feedbackEnabled`, date 28/07) sera retenu demain 9h → envoi à ses réservants.
4. `meta/session` devient inutilisé (peut rester en base, ignoré).

## Notes

- Ne pas lancer `firebase functions:secrets:access`.
