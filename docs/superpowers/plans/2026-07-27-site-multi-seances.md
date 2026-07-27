# Site multi-séances — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire passer le site d'une page unique (séance du 28/07 câblée en dur) à un site multi-séances : page d'accueil « Programme », une page par séance, jauge/réservations/emails par événement, avec migration sans casse de la séance du 28/07.

**Architecture:** Approche A (pages statiques par séance + backend par événement). Une collection Firestore `events` (une fiche par séance) porte la config et le compteur `reserved`. Chaque réservation reçoit un `eventId`. Les fonctions et les emails deviennent event-aware. Le frontend garde le template animé actuel par séance, plus une nouvelle page d'accueil listant les séances.

**Tech Stack:** Node.js Cloud Functions v2, Jest, Firestore, Firebase Hosting, HTML/CSS/JS vanilla (modules Firebase 10.13.0 via CDN).

## Global Constraints

- Format `eventId` : `opio-AAAA-MM-JJ` (ex. `opio-2026-08-18`).
- `DEFAULT_EVENT_ID = "opio-2026-07-28"` (fallback annulations sans eventId).
- Séance 28/07 : `filmTitre` « Un p'tit truc en plus », `filmAuteur` « Un film d'Artus », `dateLabel` « Mardi 28 juillet 2026 », `afficheImg` « affiche.jpg », `ouvertResa` false, `gaugeMax` 150, `maxParResa` 10.
- Séance 18/08 : `filmTitre` « Jumanji : Bienvenue dans la jungle », `filmAuteur` « de Jake Kasdan », `dateLabel` « Mardi 18 août 2026 », `afficheImg` « affiche-jumanji.jpg », `ouvertResa` true, `gaugeMax` 150, `maxParResa` 10, horaires portes 20h30 / film 21h30 / fin ~23h15, lieu « Cœur du village à Opio 06650 ».
- Tarifs : 5 € adulte, 3 € enfant 3-10 ans, gratuit < 3 ans (règlement sur place).
- Contrat des builders email : `{ to, subject, htmlContent }` inchangé.
- Charte email/site inchangée. Tests depuis `functions/`, commande `npm test`.
- Ne JAMAIS committer `outils-export/cle-admin.json` ni les fichiers générés.

---

### Task 1 : `reservation-logic.js` — validation event-aware

**Files:**
- Modify: `functions/reservation-logic.js`
- Test: `functions/test/reservation-logic.test.js`

**Interfaces:**
- Produces: `validateReservationInput(data, maxParReservation) → { valid, errors?, reservation? }`. La réservation retournée inclut `eventId`. `MAX_PER_RESERVATION` reste exporté comme valeur par défaut. `MAX_PLACES` reste exporté (utilisé par l'ancien code jusqu'à la Task 3, puis par la migration).

- [ ] **Step 1 : Lire les tests existants**

Run: `cd functions && npm test -- reservation-logic`
Noter les cas couverts (ils passent `data` sans `eventId` aujourd'hui).

- [ ] **Step 2 : Écrire/adapter les tests (échec attendu)**

Dans `functions/test/reservation-logic.test.js`, ajouter (et adapter les échantillons existants pour inclure `eventId: "opio-2026-08-18"` dans les data valides) :

```js
test("rejette une reservation sans eventId", () => {
  const res = validateReservationInput({
    prenom: "A", nom: "B", email: "a@b.fr", telephone: "0600000000",
    nb_adultes: 1, nb_enfants_3_10: 0, nb_enfants_moins_3: 0, hp: "",
  }, 10);
  expect(res.valid).toBe(false);
  expect(res.errors).toContain("eventId");
});

test("inclut eventId dans la reservation validee", () => {
  const res = validateReservationInput({
    eventId: "opio-2026-08-18",
    prenom: "A", nom: "B", email: "a@b.fr", telephone: "0600000000",
    nb_adultes: 2, nb_enfants_3_10: 1, nb_enfants_moins_3: 0, hp: "",
  }, 10);
  expect(res.valid).toBe(true);
  expect(res.reservation.eventId).toBe("opio-2026-08-18");
});

test("respecte le maxParReservation passe en argument", () => {
  const base = {
    eventId: "opio-2026-08-18",
    prenom: "A", nom: "B", email: "a@b.fr", telephone: "0600000000",
    nb_adultes: 4, nb_enfants_3_10: 0, nb_enfants_moins_3: 0, hp: "",
  };
  expect(validateReservationInput(base, 3).valid).toBe(false); // 4 > 3
  expect(validateReservationInput(base, 5).valid).toBe(true);  // 4 <= 5
});
```

- [ ] **Step 3 : Lancer les tests (échec)**

Run: `cd functions && npm test -- reservation-logic`
Expected: FAIL (eventId non géré, signature à 1 argument).

- [ ] **Step 4 : Modifier `reservation-logic.js`**

Remplacer la signature et la logique de `validateReservationInput` :

```js
function validateReservationInput(data, maxParReservation) {
  data = data || {};
  const maxPar = Number.isInteger(maxParReservation) ? maxParReservation : MAX_PER_RESERVATION;
  const errors = [];

  if (typeof data.eventId !== "string" || data.eventId.trim().length === 0) errors.push("eventId");
  if (typeof data.prenom !== "string" || data.prenom.trim().length === 0) errors.push("prenom");
  if (typeof data.nom !== "string" || data.nom.trim().length === 0) errors.push("nom");
  if (typeof data.email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) errors.push("email");
  if (typeof data.telephone !== "string" || data.telephone.trim().length === 0) errors.push("telephone");

  const nbAdultes = Number(data.nb_adultes);
  const nbEnfants310 = Number(data.nb_enfants_3_10);
  const nbEnfantsMoins3 = Number(data.nb_enfants_moins_3);

  if (!Number.isInteger(nbAdultes) || nbAdultes < 0) errors.push("nb_adultes");
  if (!Number.isInteger(nbEnfants310) || nbEnfants310 < 0) errors.push("nb_enfants_3_10");
  if (!Number.isInteger(nbEnfantsMoins3) || nbEnfantsMoins3 < 0) errors.push("nb_enfants_moins_3");

  const totalPlaces = nbAdultes + nbEnfants310 + nbEnfantsMoins3;
  if (!Number.isInteger(totalPlaces) || totalPlaces < 1 || totalPlaces > maxPar) {
    errors.push("totalPlaces");
  }

  if (typeof data.hp !== "string" || data.hp !== "") errors.push("hp");

  if (errors.length > 0) {
    return { valid: false, errors: errors };
  }

  return {
    valid: true,
    reservation: {
      eventId: data.eventId.trim(),
      prenom: data.prenom.trim(),
      nom: data.nom.trim(),
      email: data.email.trim(),
      telephone: data.telephone.trim(),
      nb_adultes: nbAdultes,
      nb_enfants_3_10: nbEnfants310,
      nb_enfants_moins_3: nbEnfantsMoins3,
      totalPlaces: totalPlaces,
      montantEstime: nbAdultes * PRICE_ADULTE + nbEnfants310 * PRICE_ENFANT,
      status: "active",
      cancelledAt: null,
    },
  };
}
```

- [ ] **Step 5 : Lancer les tests (succès)**

Run: `cd functions && npm test -- reservation-logic`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add functions/reservation-logic.js functions/test/reservation-logic.test.js
git commit -m "feat: validation reservation event-aware (eventId + maxParReservation)"
```

---

### Task 2 : Emails event-aware

**Files:**
- Modify: `functions/email-content.js`
- Test: `functions/test/email-content.test.js`

**Interfaces:**
- Consumes: helpers de `./email-layout` (inchangés).
- Produces (signatures modifiées — un `event` est ajouté) :
  - `buildVisitorConfirmationEmail(reservation, reservationId, event)`
  - `buildVisitorCancellationEmail(reservation, reservationId, event)`
  - `buildFeedbackRequestEmail(reservation, reservationId, event)`
  - `buildFeedbackReminderEmail(reservation, reservationId, event)`
  - `event` = `{ dateLabel, filmTitre, lieu, portes, filmHeure, finHeure }`.

- [ ] **Step 1 : Adapter les tests (échec attendu)**

Dans `functions/test/email-content.test.js`, ajouter en haut un échantillon event et adapter les appels :

```js
const sampleEvent = {
  dateLabel: "Mardi 18 août 2026",
  filmTitre: "Jumanji : Bienvenue dans la jungle",
  lieu: "Cœur du village à Opio 06650",
  portes: "20h30", filmHeure: "21h30", finHeure: "~23h15",
};
```

Mettre à jour les tests existants pour passer `sampleEvent` en 3e argument, et ajouter :

```js
test("la confirmation utilise la date et le film de l'evenement", () => {
  const email = buildVisitorConfirmationEmail(sampleReservation, "abc123", sampleEvent);
  expect(email.htmlContent).toContain("Mardi 18 août 2026");
  expect(email.htmlContent).toContain("Jumanji : Bienvenue dans la jungle");
  expect(email.htmlContent).not.toContain("28 juillet");
});
```

- [ ] **Step 2 : Lancer les tests (échec)**

Run: `cd functions && npm test -- email-content`
Expected: FAIL (date/film en dur, signatures à 2 args).

- [ ] **Step 3 : Modifier `email-content.js`**

Supprimer la constante `INFOS_PRATIQUES` figée et la remplacer par une fonction event-aware, puis mettre à jour les 4 builders. Les lignes fixes (parking, buvette, couvrir) restent constantes ; lieu et horaires viennent de `event`.

```js
function infosPratiques(event) {
  return [
    { picto: "&#128205;", texteHtml: "<strong>" + event.lieu + "</strong>" },
    { picto: "&#128368;", texteHtml: "Portes <strong>" + event.portes + "</strong> · Film <strong>" + event.filmHeure + "</strong> · Fin " + event.finHeure },
    { picto: "&#128663;", texteHtml: "Parking à proximité (Carrefour et Salle polyvalente)" },
    { picto: "&#127871;", texteHtml: "Buvette sur place · chaises fournies" },
    { picto: "&#129509;", texteHtml: "Prévoyez de quoi vous couvrir si les températures baissent" },
  ];
}
```

Dans `buildVisitorConfirmationEmail(reservation, reservationId, event)` : remplacer la phrase d'intro et le bloc infos :

```js
    "Votre réservation pour la projection de <strong>« " + event.filmTitre + " »</strong> le " +
    "<strong>" + event.dateLabel + "</strong> est bien confirmée. On a hâte de vous accueillir " +
    "sous les étoiles d'Opio&nbsp;!</p>" +
    billet +
    '<div style="margin:30px 0 6px;">' + blocInfos(infosPratiques(event)) + "</div>" +
```

Dans `buildVisitorCancellationEmail(reservation, reservationId, event)` : remplacer « mardi 28 juillet 2026 » par `event.dateLabel`.

Dans `buildFeedbackRequestEmail` et `buildFeedbackReminderEmail` (signature + `event` ajouté) : le texte ne cite pas la date, mais garder la signature à 3 args pour cohérence (l'argument `event` peut n'être pas utilisé — acceptable, on le passe depuis index.js).

- [ ] **Step 4 : Lancer les tests (succès)**

Run: `cd functions && npm test -- email-content`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add functions/email-content.js functions/test/email-content.test.js
git commit -m "feat: emails event-aware (date, film, lieu, horaires depuis la fiche event)"
```

---

### Task 3 : Fonctions Cloud event-aware (createReservation, cancelReservation, triggers)

**Files:**
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: `validateReservationInput(data, maxPar)` (Task 1), builders event-aware (Task 2).
- Produces: fonctions déployées lisant/écrivant `events/{eventId}.reserved`.

- [ ] **Step 1 : Modifier les imports et constantes**

En tête, sous `const SENDER = ...`, ajouter :

```js
const DEFAULT_EVENT_ID = "opio-2026-07-28";

async function loadEvent(eventId) {
  const snap = await db.collection("events").doc(eventId).get();
  return snap.exists ? Object.assign({ id: eventId }, snap.data()) : null;
}
```

- [ ] **Step 2 : Remplacer `createReservation`**

```js
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
```

- [ ] **Step 3 : Remplacer `cancelReservation`**

```js
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
```

- [ ] **Step 4 : Rendre les triggers email event-aware**

Dans `onReservationCreated`, charger l'event et le passer aux builders :

```js
    const reservation = event.data.data();
    const reservationId = event.params.reservationId;
    const apiKey = BREVO_API_KEY.value();
    const ev = await loadEvent(reservation.eventId || DEFAULT_EVENT_ID);

    await sendEmail(apiKey, buildVisitorConfirmationEmail(reservation, reservationId, ev));
    await sendEmail(apiKey, buildOriaNewReservationEmail(reservation));
    logger.info("Reservation emails sent", { reservationId });
```

> ⚠️ Attention au shadowing : le paramètre du trigger s'appelle déjà `event`. Utiliser `ev` pour la fiche chargée (comme ci-dessus).

Dans `onReservationCancelled`, charger l'event et le passer à l'email visiteur :

```js
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
        await sendEmail(apiKey, buildOriaCancellationEmail(after));
      } catch (err) {
        logger.error("Cancellation Oria email failed", { reservationId, error: String(err) });
      }
      logger.info("Cancellation emails processed", { reservationId });
    }
```

Dans `sendFeedbackRequests` (fonction programmée, inerte) : passer l'event aux builders d'avis. Charger l'event de la session une fois : après avoir lu `session`, ajouter `const ev = await loadEvent(session.eventId || DEFAULT_EVENT_ID);` et passer `ev` en 3e argument à `buildFeedbackRequestEmail(reservation, rec.reservationId, ev)` et `buildFeedbackReminderEmail(reservation, rec.reservationId, ev)`.

- [ ] **Step 5 : Vérifier la syntaxe et lancer toute la suite**

Run: `cd functions && node --check index.js && npm test`
Expected: `node --check` OK ; toutes les suites PASS.

- [ ] **Step 6 : Commit**

```bash
git add functions/index.js
git commit -m "feat: fonctions Cloud event-aware (jauge par evenement + emails)"
```

---

### Task 4 : Règles Firestore pour `events`

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1 : Ajouter le bloc events**

Dans `firestore.rules`, après le bloc `meta/gauge` (ou avec les autres `match`), ajouter :

```
    match /events/{eventId} {
      allow get, list: if true;
      allow create, update, delete: if false;
    }
```

- [ ] **Step 2 : Vérifier la syntaxe (dry-run)**

Run: `firebase deploy --only firestore:rules --dry-run 2>&1 | tail -5`
Expected: pas d'erreur de compilation des règles.

- [ ] **Step 3 : Commit**

```bash
git add firestore.rules
git commit -m "feat: regles Firestore lecture publique de la collection events"
```

---

### Task 5 : Script de migration

**Files:**
- Create: `outils-export/migration-multi-seances.js`

**Interfaces:**
- Consumes: `cle-admin.json` (Admin SDK, déjà présent, gitignoré), le doc `meta/gauge`.
- Produces: fiches `events/opio-2026-07-28` et `events/opio-2026-08-18`, backfill `eventId` sur les réservations.

- [ ] **Step 1 : Écrire le script (idempotent)**

Créer `outils-export/migration-multi-seances.js` :

```js
// Migration multi-séances : crée les fiches events, backfille eventId.
// Idempotent : ne recrée pas une fiche existante, ne double pas reserved.
const admin = require("firebase-admin");
const serviceAccount = require("./cle-admin.json");
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const EVENT_28 = "opio-2026-07-28";
const EVENT_18 = "opio-2026-08-18";

async function main() {
  // 1. Fiche 28/07 avec reserved = meta/gauge.reserved
  const gaugeSnap = await db.collection("meta").doc("gauge").get();
  const reserved28 = gaugeSnap.exists && gaugeSnap.data().reserved ? gaugeSnap.data().reserved : 0;

  const ref28 = db.collection("events").doc(EVENT_28);
  if (!(await ref28.get()).exists) {
    await ref28.set({
      filmTitre: "Un p'tit truc en plus", filmAuteur: "Un film d'Artus",
      dateLabel: "Mardi 28 juillet 2026",
      dateISO: admin.firestore.Timestamp.fromDate(new Date("2026-07-28T18:30:00Z")),
      lieu: "Cœur du village à Opio 06650",
      portes: "20h30", filmHeure: "21h30", finHeure: "~23h15",
      gaugeMax: 150, maxParResa: 10, reserved: reserved28,
      afficheImg: "affiche.jpg", slug: "seance-2026-07-28", ouvertResa: false,
    });
    console.log("✅ Fiche 28/07 créée (reserved=" + reserved28 + ")");
  } else {
    console.log("• Fiche 28/07 déjà présente, inchangée");
  }

  // 2. Fiche 18/08
  const ref18 = db.collection("events").doc(EVENT_18);
  if (!(await ref18.get()).exists) {
    await ref18.set({
      filmTitre: "Jumanji : Bienvenue dans la jungle", filmAuteur: "de Jake Kasdan",
      dateLabel: "Mardi 18 août 2026",
      dateISO: admin.firestore.Timestamp.fromDate(new Date("2026-08-18T18:30:00Z")),
      lieu: "Cœur du village à Opio 06650",
      portes: "20h30", filmHeure: "21h30", finHeure: "~23h15",
      gaugeMax: 150, maxParResa: 10, reserved: 0,
      afficheImg: "affiche-jumanji.jpg", slug: "seance-2026-08-18", ouvertResa: true,
    });
    console.log("✅ Fiche 18/08 créée");
  } else {
    console.log("• Fiche 18/08 déjà présente, inchangée");
  }

  // 3. Backfill eventId sur les réservations sans eventId
  const resSnap = await db.collection("reservations").get();
  let batch = db.batch(); let count = 0; let total = 0;
  resSnap.forEach(function (d) {
    if (!d.data().eventId) {
      batch.update(d.ref, { eventId: EVENT_28 });
      count++; total++;
      if (count === 400) { batch.commit(); batch = db.batch(); count = 0; }
    }
  });
  if (count > 0) await batch.commit();
  console.log("✅ Backfill eventId sur " + total + " réservation(s)");
}

main().then(function () { console.log("Migration terminée."); process.exit(0); })
  .catch(function (e) { console.error(e); process.exit(1); });
```

- [ ] **Step 2 : Commit (sans exécuter — l'exécution se fait au déploiement)**

```bash
git add outils-export/migration-multi-seances.js
git commit -m "feat: script de migration multi-seances (idempotent)"
```

> L'exécution (`node migration-multi-seances.js`) est faite par le contrôleur au moment du déploiement (voir Task 9), pas pendant l'implémentation.

---

### Task 6 : Page séance 28/07 (déplacement + paramétrage)

**Files:**
- Create: `public/seance-2026-07-28.html` (copie de l'`index.html` actuel, paramétrée)
- Modify: (l'`index.html` actuel sera remplacé en Task 8 ; ici on le COPIE, on ne le supprime pas encore)

**Interfaces:**
- Consumes: fiche `events/opio-2026-07-28` (jauge). Appelle `createReservation` avec `eventId`.

- [ ] **Step 1 : Copier le fichier**

```bash
cp public/index.html public/seance-2026-07-28.html
```

- [ ] **Step 2 : Ajouter la constante d'événement**

Dans `public/seance-2026-07-28.html`, juste après `var createReservation = httpsCallable(functions, 'createReservation');`, ajouter :

```js
  var EVENT_ID = "opio-2026-07-28";
  var eventRef = doc(db, 'events', EVENT_ID);
```

- [ ] **Step 3 : Lire la jauge depuis la fiche event**

Remplacer :

```js
  onSnapshot(doc(db, 'meta', 'gauge'), function (snap) {
    var data = snap.data();
    renderGauge(data ? data.reserved : 0);
  });
```

par :

```js
  onSnapshot(eventRef, function (snap) {
    var data = snap.data();
    renderGauge(data ? (data.reserved || 0) : 0);
  });
```

- [ ] **Step 4 : Envoyer l'eventId à la réservation**

Dans l'appel `createReservation({ ... })`, ajouter la première propriété :

```js
      createReservation({
        eventId: EVENT_ID,
        prenom: form.prenom.value.trim(),
```

- [ ] **Step 5 : Menu de navigation partagé**

Remplacer le bloc `<nav class="site-nav glass" ...>...</nav>` par :

```html
<nav class="site-nav glass" aria-label="Navigation principale">
  <a href="/" class="brand" style="text-decoration:none;">Cinéma <span>Plein Air</span></a>
  <span style="flex:1"></span>
  <a href="/" class="btn-ghost" style="margin-right:12px;">Programme</a>
  <a href="#reservation" class="btn">Réserver</a>
</nav>
```

> Si la classe `.btn-ghost` n'existe pas, utiliser `class="nav-link"` avec le style inline `style="color:var(--c-ivory);text-decoration:none;margin-right:14px;"`.

- [ ] **Step 6 : Vérifier le rendu (ouvrir la page)**

Run: `open public/seance-2026-07-28.html`
Expected: la page s'affiche (la jauge restera à 0 en local sans connexion Firebase — normal ; vérifier la mise en page et le menu).

- [ ] **Step 7 : Commit**

```bash
git add public/seance-2026-07-28.html
git commit -m "feat: page seance 28/07 parametree par eventId + menu partage"
```

---

### Task 7 : Page séance 18/08 (Jumanji)

**Files:**
- Create: `public/seance-2026-08-18.html` (copie paramétrée de la page 28/07, contenu Jumanji)

**Interfaces:** identiques à la page 28/07 mais `EVENT_ID = "opio-2026-08-18"`.

- [ ] **Step 1 : Copier la page 28/07**

```bash
cp public/seance-2026-07-28.html public/seance-2026-08-18.html
```

- [ ] **Step 2 : Changer l'eventId**

Dans `public/seance-2026-08-18.html`, remplacer `var EVENT_ID = "opio-2026-07-28";` par `var EVENT_ID = "opio-2026-08-18";`.

- [ ] **Step 3 : Remplacer le contenu texte de la séance**

Effectuer ces remplacements (tous en respectant le texte exact) :
- `<title>` et meta description : « Un p'tit truc en plus » → « Jumanji : Bienvenue dans la jungle » ; date 28 juillet → 18 août.
- Compte à rebours `EVENT_DATE` : `new Date(2026, 6, 28, ...)` → `new Date(2026, 7, 18, 20, 30, 0)` (mois 7 = août).
- Hero : titre du film → « Jumanji <br>Bienvenue dans la jungle », `.by` → « de Jake Kasdan », date → « Mardi 18 août 2026 ».
- Section « Le film » (`#film`) : remplacer le descriptif de « Un p'tit truc en plus » par un descriptif de Jumanji (2-3 phrases, comédie d'aventure familiale, sans reproduire de texte protégé — rédaction originale). Exemple neutre :
  « Quatre lycéens se retrouvent aspirés dans un jeu vidéo et deviennent leurs avatars en pleine jungle. Pour rentrer chez eux, ils devront survivre à mille dangers et terminer l'aventure. Une comédie d'action drôle et trépidante, parfaite pour toute la famille. »
- `affiche.jpg` (fond de la section film) → `affiche-jumanji.jpg` (chercher les occurrences de `affiche.jpg` dans le fichier et remplacer).
- Toute autre mention « 28 juillet » restante → « 18 août ».

- [ ] **Step 4 : Vérifier le rendu**

Run: `grep -c "28 juillet\|affiche.jpg\|p'tit truc\|opio-2026-07-28" public/seance-2026-08-18.html`
Expected: `0` (plus aucune référence à l'ancienne séance).
Puis : `open public/seance-2026-08-18.html`.

- [ ] **Step 5 : Commit**

```bash
git add public/seance-2026-08-18.html
git commit -m "feat: page seance 18/08 (Jumanji)"
```

---

### Task 8 : Page d'accueil « Programme »

**Files:**
- Modify: `public/index.html` (remplacer entièrement par la page Programme)

**Interfaces:**
- Consumes: collection `events` (Firestore, lecture). Lie chaque séance à `<slug>.html`.

- [ ] **Step 1 : Écrire la nouvelle page d'accueil**

Remplacer tout le contenu de `public/index.html` par une page Programme réutilisant la charte (variables CSS, polices). Structure : `<head>` (mêmes polices/couleurs/analytics+bandeau cookies que les pages séance), `<nav>` partagé, hero « Cinéma en plein air · Opio », section « À venir », section « Séances passées ». Le JS lit la collection `events`, trie par `dateISO`, et rend les cartes.

JS de rendu (module, à placer en fin de body) :

```html
<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
  import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
  var firebaseConfig = {
    apiKey: "AIzaSyBB-WiFkZfrHQD9rXDQ6KjbeNQyMlO4VbA",
    authDomain: "cinema-en-pleine-air-opi-ac81e.firebaseapp.com",
    projectId: "cinema-en-pleine-air-opi-ac81e",
    storageBucket: "cinema-en-pleine-air-opi-ac81e.firebasestorage.app",
    messagingSenderId: "245777069404",
    appId: "1:245777069404:web:8478506b55ec08fb8abd99",
    measurementId: "G-R66JNXKKPZ"
  };
  var app = initializeApp(firebaseConfig);
  var db = getFirestore(app);

  function carte(ev, passe) {
    var complet = (ev.reserved || 0) >= ev.gaugeMax;
    var ouvert = ev.ouvertResa === true && !complet;
    var bouton;
    if (passe) {
      bouton = '<a class="prog-link" href="/' + ev.slug + '.html">Voir la séance</a>';
    } else if (ouvert) {
      bouton = '<a class="btn" href="/' + ev.slug + '.html">Réserver</a>';
    } else {
      bouton = '<a class="btn is-full" href="/' + ev.slug + '.html">' + (complet ? 'Complet' : 'Réservations fermées') + '</a>';
    }
    return '<article class="prog-card glass">' +
      '<img src="/' + ev.afficheImg + '" alt="Affiche ' + ev.filmTitre + '" class="prog-affiche" onerror="this.style.display=\'none\'">' +
      '<div class="prog-body"><h3>' + ev.filmTitre + '</h3>' +
      '<p class="prog-date">' + ev.dateLabel + '</p>' +
      '<p class="prog-lieu">' + ev.lieu + '</p>' + bouton + '</div></article>';
  }

  getDocs(collection(db, 'events')).then(function (snap) {
    var events = [];
    snap.forEach(function (d) { events.push(Object.assign({ id: d.id }, d.data())); });
    events.sort(function (a, b) { return a.dateISO.toMillis() - b.dateISO.toMillis(); });
    var now = Date.now();
    var avenir = events.filter(function (e) { return e.dateISO.toMillis() >= now; });
    var passe = events.filter(function (e) { return e.dateISO.toMillis() < now; }).reverse();
    document.getElementById('prog-avenir').innerHTML =
      avenir.length ? avenir.map(function (e) { return carte(e, false); }).join("") : '<p class="prog-empty">Prochaine séance bientôt annoncée.</p>';
    var passeWrap = document.getElementById('prog-passe-wrap');
    if (passe.length) {
      document.getElementById('prog-passe').innerHTML = passe.map(function (e) { return carte(e, true); }).join("");
    } else if (passeWrap) {
      passeWrap.style.display = 'none';
    }
  });
</script>
```

Corps HTML minimal des sections (dans `<main>`) :

```html
<section class="prog-section">
  <h2 class="section-title">À venir</h2>
  <div id="prog-avenir" class="prog-grid"></div>
</section>
<section class="prog-section" id="prog-passe-wrap">
  <h2 class="section-title">Séances passées</h2>
  <div id="prog-passe" class="prog-grid"></div>
</section>
```

Ajouter dans le `<style>` de la page les classes `.prog-grid` (grille responsive : `display:grid; gap:24px; grid-template-columns:repeat(auto-fit,minmax(260px,1fr));`), `.prog-card`, `.prog-affiche` (`width:100%; aspect-ratio:2/3; object-fit:cover;`), `.prog-body`, `.prog-date`, `.prog-lieu`, `.is-full` (bouton grisé non cliquable visuellement : `opacity:.6;`), `.prog-link`, `.prog-empty`, en réutilisant les variables `--c-*` existantes. Conserver le bandeau cookies + analytics (copier le bloc consentement de la page séance).

- [ ] **Step 2 : Vérifier le rendu**

Run: `open public/index.html`
Expected: la page Programme s'affiche (les cartes se rempliront une fois en ligne avec Firestore ; en local, les sections sont vides mais la mise en page et le menu sont corrects).

- [ ] **Step 3 : Commit**

```bash
git add public/index.html
git commit -m "feat: page d'accueil Programme (liste des seances a venir/passees)"
```

---

### Task 9 : Note de version + guide

**Files:**
- Create: `releases/v14.md`
- Modify: `releases/README.md`, `GUIDE.md`

- [ ] **Step 1 : Note de version**

Créer `releases/v14.md` :

```markdown
# v14 — 2026-07-27

Site multi-séances : page d'accueil « Programme » + réservations par événement.

## Nouveautés

- **Page d'accueil « Programme »** listant les séances à venir et passées.
- **Une page par séance** (28/07 et 18/08 « Jumanji »), chacune avec sa jauge,
  son formulaire et ses emails à la bonne date.
- **Menu de navigation** partagé (logo → Programme, bouton Réserver).
- Backend rendu **multi-événements** : collection `events`, chaque réservation
  porte un `eventId`, jauge et emails par séance.

## Technique

- Collection Firestore `events` (une fiche par séance) ; `reserved` par événement
  remplace `meta/gauge`.
- `createReservation`/`cancelReservation` et les emails deviennent event-aware.
- Migration idempotente (`outils-export/migration-multi-seances.js`) : fiches
  events créées, `eventId` backfillé sur les réservations existantes.
- Règle Firestore : lecture publique de `events`.

## Ajouter une future séance

1. Créer sa fiche dans la collection `events` (via script/console).
2. Dupliquer une page `seance-AAAA-MM-JJ.html` avec le bon `EVENT_ID` et le
   contenu du film.
3. Déployer le hosting. La page d'accueil l'affiche automatiquement.
```

- [ ] **Step 2 : Index des versions**

Dans `releases/README.md`, ajouter en haut de la liste `## Versions` :

```markdown
- [v14](v14.md) — 2026-07-27 — Site multi-séances (accueil Programme, page par séance, réservations par événement).
```

- [ ] **Step 3 : Mettre à jour le guide**

Dans `GUIDE.md`, mettre à jour la section « En une phrase » / structure pour mentionner la page d'accueil Programme et les pages par séance, et ajouter une sous-section « Ajouter une nouvelle séance » reprenant les 3 étapes ci-dessus.

- [ ] **Step 4 : Commit**

```bash
git add releases/v14.md releases/README.md GUIDE.md
git commit -m "docs: note de version v14 + guide multi-seances"
```

---

## Déploiement (contrôleur, après implémentation — hors tâches)

1. `cd functions && npm test` (tout vert).
2. `firebase deploy --only functions,firestore:rules,hosting`.
3. **Immédiatement après** : `cd outils-export && node migration-multi-seances.js`.
4. Vérifs : accueil affiche 2 séances ; jauge 28/07 correcte (= reserved migré) ;
   réservation test sur 18/08 puis annulée/nettoyée ; annulation 28/07 OK.
5. Déposer `public/affiche-jumanji.jpg` (affiche fournie) avant/juste après le
   déploiement hosting.

## Notes

- Ne pas lancer `firebase functions:secrets:access`.
- `meta/gauge` devient inutilisé après migration (laisser tel quel).
