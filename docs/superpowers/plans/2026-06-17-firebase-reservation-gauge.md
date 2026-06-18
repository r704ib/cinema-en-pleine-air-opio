# Jauge de réservation partagée via Firebase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-browser `localStorage` reservation gauge and Netlify Forms submission with a real shared gauge backed by Firestore, including online self-service cancellation and automatic email notifications.

**Architecture:** Visitors call callable Cloud Functions (`createReservation`, `cancelReservation`) instead of writing to Firestore directly — these run server-side with the Admin SDK and are the only code path that can write `reservations` or `meta/gauge`, so the 150-place cap and the 10-place-per-reservation cap are enforced where a client cannot bypass them. Firestore security rules only allow public reads and deny all direct client writes. Two more Cloud Functions, triggered by the resulting Firestore writes, send transactional emails via the Brevo API. A new static page (`annuler.html`) lets a visitor cancel their own reservation using the secret document ID from their confirmation email. (Revised 2026-06-18 from an earlier client-transaction design — see Task 3's note.)

**Tech Stack:** Firebase (Firestore + Cloud Functions v2, Node.js 20), Firebase JS SDK v10 (modular, loaded from CDN, no build step), Brevo transactional email API, Jest + `@firebase/rules-unit-testing` + Firebase Local Emulator Suite for automated tests. No changes to the existing static-HTML/vanilla-JS approach of the site.

## Global Constraints

- Jauge globale : 150 places maximum (`MAX_PLACES = 150`).
- Maximum 10 places par réservation individuelle.
- Tarifs : 5 € par adulte, 3 € par enfant de 3 à 10 ans, gratuit pour les moins de 3 ans.
- Aucun paiement en ligne — réglement sur place (inchangé).
- Adresse email du comité des fêtes pour les notifications : `Oria.ei@outlook.fr`.
- URL de production du site : `https://cinema-en-pleine-air-opio.netlify.app`.
- Pas d'authentification visiteur, pas d'interface d'administration dédiée : le comité utilise la console Firebase si besoin d'une intervention manuelle.
- Le plan Firebase **Blaze** (carte bancaire enregistrée) est requis pour déployer des Cloud Functions ; le volume de cet événement reste dans les quotas gratuits (2M invocations/mois Cloud Functions, 300 emails/jour Brevo).

---

## Task 1: Prérequis — créer le projet Firebase et le compte Brevo

**Files:** aucun (actions manuelles dans les consoles Firebase et Brevo).

**Interfaces:**
- Produces: un *Project ID* Firebase, un objet de configuration web Firebase à 6 champs (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`), et une clé API Brevo. Ces 3 éléments sont réutilisés tels quels dans les tâches 2, 4, 5 et 6.

- [ ] **Step 1: Créer le projet Firebase**

Aller sur https://console.firebase.google.com, cliquer sur « Ajouter un projet », nommer le projet (ex: `cinema-plein-air-opio`), désactiver Google Analytics (non nécessaire ici).

Expected: un nouveau projet Firebase est créé ; noter son **Project ID** affiché dans les paramètres du projet (icône engrenage → Paramètres du projet) — il sert dans la Tâche 2.

- [ ] **Step 2: Activer Firestore**

Dans le menu de gauche, « Firestore Database » → « Créer une base de données » → mode **production** → région **eur3 (europe-west)** (proche de la France).

Expected: la base Firestore est active, vide, avec l'onglet « Données » accessible.

- [ ] **Step 3: Passer au plan Blaze**

Paramètres du projet → Utilisation et facturation → « Modifier le plan » → choisir **Blaze (Pay as you go)**, enregistrer une carte bancaire.

Expected: le projet affiche le plan « Blaze » actif. Aucune charge ne sera émise à ce volume d'utilisation (quotas gratuits largement suffisants), mais la carte est requise pour activer les Cloud Functions.

- [ ] **Step 4: Créer une application web et récupérer la configuration**

Paramètres du projet → onglet « Général » → section « Vos applications » → icône `</>` (Web) → nommer l'app (ex: `site-vitrine`) → ne pas cocher Firebase Hosting (le site reste sur Netlify) → « Enregistrer l'application ».

Expected: Firebase affiche un objet `firebaseConfig` JavaScript avec 6 champs (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`). **Copier ces 6 valeurs dans un fichier texte temporaire** — elles sont réutilisées exactement telles quelles dans les Tâches 5 et 6.

- [ ] **Step 5: Créer le compte Brevo et vérifier l'adresse expéditrice**

Aller sur https://www.brevo.com, créer un compte gratuit. Une fois connecté : Paramètres → « Expéditeurs et IP » → ajouter `Oria.ei@outlook.fr` comme expéditeur vérifié (Brevo envoie un email de confirmation à cette adresse — cliquer sur le lien de validation reçu).

Expected: `Oria.ei@outlook.fr` apparaît avec le statut « Vérifié » dans la liste des expéditeurs Brevo.

- [ ] **Step 6: Générer la clé API Brevo**

Dans Brevo : icône de profil → « SMTP & API » → onglet « Clés API » → « Générer une nouvelle clé API » → nommer-la (ex: `cinema-opio-cloud-functions`).

Expected: une clé API (chaîne commençant par `xkeysib-...`) est affichée une seule fois. **Copier cette clé dans le même fichier texte temporaire** — elle est utilisée dans la Tâche 4 (jamais committée dans le code).

---

## Task 2: Structure du projet Firebase en local

**Files:**
- Create: `firebase.json`
- Create: `.firebaserc`
- Create: `firestore.indexes.json`
- Create: `.gitignore`

**Interfaces:**
- Consumes: le *Project ID* Firebase obtenu à la Tâche 1, Étape 1.
- Produces: un projet Firebase CLI fonctionnel en local, capable de lancer l'émulateur Firestore ; un document `meta/gauge` initialisé à `{ reserved: 0 }` dans le projet Firebase réel (utilisé par les Tâches 5, 6, 7).

- [ ] **Step 1: Installer Firebase CLI**

Run: `npm install -g firebase-tools`
Expected: `firebase --version` affiche une version ≥ 13.0.0.

- [ ] **Step 2: Se connecter à Firebase**

Run: `firebase login`
Expected: ouverture du navigateur, connexion avec le compte Google utilisé à la Tâche 1, message `Success! Logged in as <email>`.

- [ ] **Step 3: Créer `.firebaserc`**

Remplacer `VOTRE_PROJECT_ID` par le Project ID exact noté à la Tâche 1, Étape 1.

```json
{
  "projects": {
    "default": "VOTRE_PROJECT_ID"
  }
}
```

- [ ] **Step 4: Créer `firebase.json`**

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "runtime": "nodejs20"
    }
  ],
  "emulators": {
    "firestore": {
      "port": 8080
    },
    "functions": {
      "port": 5001
    },
    "ui": {
      "enabled": true,
      "port": 4000
    }
  }
}
```

- [ ] **Step 5: Créer `firestore.indexes.json`**

```json
{
  "indexes": [],
  "fieldOverrides": []
}
```

- [ ] **Step 6: Créer un `firestore.rules` temporaire (sera réécrit en Tâche 3)**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 7: Créer `.gitignore`**

```
node_modules/
.firebase/
*.log
```

- [ ] **Step 8: Vérifier que l'émulateur Firestore démarre**

Run: `firebase emulators:start --only firestore`
Expected: la console affiche `✔  firestore: Emulator started` et `View Emulator UI at http://127.0.0.1:4000`. Ouvrir cette URL dans un navigateur confirme que l'émulateur tourne. Arrêter avec `Ctrl+C`.

- [ ] **Step 9: Initialiser le document `meta/gauge` dans le vrai projet Firebase**

Dans la console Firebase (projet réel, pas l'émulateur) → Firestore Database → « Démarrer une collection » → ID de collection : `meta` → ID du document : `gauge` → ajouter un champ `reserved` de type `number`, valeur `0` → ajouter un champ `updatedAt` de type `timestamp`, valeur actuelle → Enregistrer.

Expected: le document `meta/gauge` existe dans Firestore avec `reserved: 0`. C'est ce document que liront tous les visiteurs du site en production.

- [ ] **Step 10: Commit**

```bash
git add firebase.json .firebaserc firestore.indexes.json firestore.rules .gitignore
git commit -m "chore: initialise la structure du projet Firebase"
```

---

## Task 3: Règles de sécurité Firestore (lecture seule pour le client, TDD avec l'émulateur)

> **Révisé le 2026-06-18** : la revue de cette tâche a montré qu'une règle
> client qui valide et borne chaque écriture individuellement ne peut pas
> garantir le plafond global de 150 places, car `reservations` et
> `meta/gauge` restent deux documents écrits indépendamment l'un de l'autre
> — rien n'empêche un client malveillant d'écrire l'un sans l'autre. La
> validation et le plafond sont donc déplacés côté serveur, dans les Cloud
> Functions callable de la Tâche 4. Les règles Firestore client n'ont plus
> qu'un rôle : autoriser la lecture publique et refuser toute écriture
> directe.

**Files:**
- Modify: `firestore.rules`
- Create: `package.json` (racine du projet)
- Create: `test/firestore.rules.test.js`

**Interfaces:**
- Consumes: le schéma de données défini dans la spec (`reservations/{id}` avec `prenom`, `nom`, `email`, `telephone`, `nb_adultes`, `nb_enfants_3_10`, `nb_enfants_moins_3`, `totalPlaces`, `montantEstime`, `status`, `createdAt`, `cancelledAt`, `hp` ; `meta/gauge` avec `reserved`, `updatedAt`).
- Produces: un fichier `firestore.rules` validé par tests, garantissant que `reservations` et `meta/gauge` sont lisibles publiquement mais jamais modifiables directement par un client (seul l'Admin SDK, utilisé par les Cloud Functions de la Tâche 4, peut les écrire — l'Admin SDK ignore ces règles par conception). La Tâche 6 (page d'annulation) lit `reservations/{id}` en s'appuyant sur ces règles.

- [ ] **Step 1: Créer `package.json` à la racine**

```json
{
  "name": "cinema-plein-air-opio-tests",
  "private": true,
  "scripts": {
    "test:rules": "firebase emulators:exec --only firestore \"jest test/firestore.rules.test.js\""
  },
  "devDependencies": {
    "@firebase/rules-unit-testing": "^3.0.4",
    "firebase": "^10.13.0",
    "jest": "^29.7.0"
  }
}
```

- [ ] **Step 2: Installer les dépendances**

Run: `npm install`
Expected: un dossier `node_modules` est créé, aucune erreur.

- [ ] **Step 3: Écrire les tests des règles (ils doivent échouer avec les règles temporaires)**

Create `test/firestore.rules.test.js`:

```js
const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  collection,
} = require("firebase/firestore");

let testEnv;

function sampleReservation(overrides) {
  return Object.assign(
    {
      prenom: "Jean",
      nom: "Dupont",
      email: "jean@example.com",
      telephone: "0600000000",
      nb_adultes: 2,
      nb_enfants_3_10: 1,
      nb_enfants_moins_3: 0,
      totalPlaces: 3,
      montantEstime: 13,
      status: "active",
      createdAt: new Date(),
      cancelledAt: null,
      hp: "",
    },
    overrides || {}
  );
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "cinema-opio-test",
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "meta/gauge"), { reserved: 0, updatedAt: new Date() });
    await setDoc(doc(db, "reservations/r1"), sampleReservation());
  });
});

test("a visitor can read the gauge document", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(visitor, "meta/gauge")));
});

test("a visitor can read a reservation by id", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(visitor, "reservations/r1")));
});

test("listing all reservations is rejected", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDocs(collection(visitor, "reservations")));
});

test("a visitor cannot create a reservation directly", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(visitor, "reservations/r2"), sampleReservation()));
});

test("a visitor cannot update a reservation directly", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(updateDoc(doc(visitor, "reservations/r1"), { status: "cancelled" }));
});

test("a visitor cannot delete a reservation directly", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(deleteDoc(doc(visitor, "reservations/r1")));
});

test("a visitor cannot write the gauge directly", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(updateDoc(doc(visitor, "meta/gauge"), { reserved: 150 }));
});
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm run test:rules`
Expected: les deux tests `assertSucceeds(...)` (lecture de `meta/gauge` et de `reservations/r1`) échouent, puisque les règles temporaires bloquent tout (y compris la lecture). Les 5 tests `assertFails(...)` passent déjà. Au global, la commande sort en erreur (`Tests: ... failed`).

- [ ] **Step 5: Écrire les règles définitives**

Replace `firestore.rules`:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    match /reservations/{reservationId} {
      allow get: if true;
      allow list: if false;
      allow create, update, delete: if false;
    }

    match /meta/gauge {
      allow get: if true;
      allow list: if false;
      allow create, update, delete: if false;
    }
  }
}
```

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils passent**

Run: `npm run test:rules`
Expected: `Tests: 7 passed, 7 total`.

- [ ] **Step 7: Commit**

```bash
git add firestore.rules package.json test/firestore.rules.test.js package-lock.json
git commit -m "feat: règles de sécurité Firestore en lecture seule pour reservations et meta/gauge"
```

---

## Task 4: Cloud Functions — réservation, annulation, et emails

> **Révisé le 2026-06-18** : cette tâche inclut maintenant deux Cloud
> Functions callable supplémentaires, `createReservation` et
> `cancelReservation`, qui sont les seules autorisées à écrire dans
> `reservations` et `meta/gauge` (voir la révision de la Tâche 3). Toute la
> validation et l'enforcement du plafond de 150 places se fait ici, côté
> serveur, dans une transaction Firestore via l'Admin SDK.

**Files:**
- Create: `functions/package.json`
- Create: `functions/reservation-logic.js`
- Create: `functions/test/reservation-logic.test.js`
- Create: `functions/email-content.js`
- Create: `functions/test/email-content.test.js`
- Create: `functions/index.js`

**Interfaces:**
- Consumes: le schéma de données de la Tâche 3 (`reservations/{id}`, `meta/gauge`) ; la clé API Brevo et l'adresse vérifiée `Oria.ei@outlook.fr` de la Tâche 1 ; l'URL de production `https://cinema-en-pleine-air-opio.netlify.app`.
- Produces: quatre Cloud Functions déployées — `createReservation(data)` callable, retourne `{ id }` ou lève une `HttpsError` (`code: "invalid-argument"` si les données sont invalides, `code: "resource-exhausted"` si la jauge est pleine) ; `cancelReservation({ reservationId })` callable, retourne `{ success: true }` ou lève une `HttpsError` (`code: "failed-precondition"` si déjà annulée/introuvable) ; `onReservationCreated`/`onReservationCancelled` (triggers Firestore, inchangées) qui envoient les emails. Les Tâches 5 et 6 appellent `createReservation` et `cancelReservation` depuis le navigateur via le SDK Firebase Functions.

- [ ] **Step 1: Créer `functions/package.json`**

```json
{
  "name": "functions",
  "private": true,
  "engines": { "node": "20" },
  "main": "index.js",
  "scripts": {
    "test": "jest"
  },
  "dependencies": {
    "firebase-admin": "^12.0.0",
    "firebase-functions": "^5.0.0"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

- [ ] **Step 2: Installer les dépendances**

Run: `cd functions && npm install && cd ..`
Expected: `functions/node_modules` créé, aucune erreur.

- [ ] **Step 3: Écrire les tests de validation des réservations (ils doivent échouer, le module n'existe pas encore)**

Create `functions/test/reservation-logic.test.js`:

```js
const { validateReservationInput, MAX_PLACES, MAX_PER_RESERVATION } = require("../reservation-logic");

function validInput(overrides) {
  return Object.assign(
    {
      prenom: "Jean",
      nom: "Dupont",
      email: "jean@example.com",
      telephone: "0600000000",
      nb_adultes: 2,
      nb_enfants_3_10: 1,
      nb_enfants_moins_3: 0,
      hp: "",
    },
    overrides || {}
  );
}

test("MAX_PLACES and MAX_PER_RESERVATION match the global constraints", () => {
  expect(MAX_PLACES).toBe(150);
  expect(MAX_PER_RESERVATION).toBe(10);
});

test("a valid input is accepted and computes totalPlaces and montantEstime", () => {
  const result = validateReservationInput(validInput());
  expect(result.valid).toBe(true);
  expect(result.reservation.totalPlaces).toBe(3);
  expect(result.reservation.montantEstime).toBe(13);
  expect(result.reservation.status).toBe("active");
  expect(result.reservation.cancelledAt).toBeNull();
});

test("a missing prenom is rejected", () => {
  const result = validateReservationInput(validInput({ prenom: "" }));
  expect(result.valid).toBe(false);
  expect(result.errors).toContain("prenom");
});

test("an invalid email is rejected", () => {
  const result = validateReservationInput(validInput({ email: "not-an-email" }));
  expect(result.valid).toBe(false);
  expect(result.errors).toContain("email");
});

test("a reservation of 0 places is rejected", () => {
  const result = validateReservationInput(validInput({ nb_adultes: 0, nb_enfants_3_10: 0, nb_enfants_moins_3: 0 }));
  expect(result.valid).toBe(false);
  expect(result.errors).toContain("totalPlaces");
});

test("a reservation above 10 places is rejected", () => {
  const result = validateReservationInput(validInput({ nb_adultes: 11 }));
  expect(result.valid).toBe(false);
  expect(result.errors).toContain("totalPlaces");
});

test("a filled honeypot is rejected", () => {
  const result = validateReservationInput(validInput({ hp: "im-a-bot" }));
  expect(result.valid).toBe(false);
  expect(result.errors).toContain("hp");
});
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd functions && npx jest test/reservation-logic.test.js && cd ..`
Expected: échec avec `Cannot find module '../reservation-logic'`.

- [ ] **Step 5: Implémenter `functions/reservation-logic.js`**

```js
"use strict";

const MAX_PLACES = 150;
const MAX_PER_RESERVATION = 10;
const PRICE_ADULTE = 5;
const PRICE_ENFANT = 3;

function validateReservationInput(data) {
  data = data || {};
  const errors = [];

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
  if (!Number.isInteger(totalPlaces) || totalPlaces < 1 || totalPlaces > MAX_PER_RESERVATION) {
    errors.push("totalPlaces");
  }

  if (typeof data.hp !== "string" || data.hp !== "") errors.push("hp");

  if (errors.length > 0) {
    return { valid: false, errors: errors };
  }

  return {
    valid: true,
    reservation: {
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

module.exports = {
  validateReservationInput: validateReservationInput,
  MAX_PLACES: MAX_PLACES,
  MAX_PER_RESERVATION: MAX_PER_RESERVATION,
  PRICE_ADULTE: PRICE_ADULTE,
  PRICE_ENFANT: PRICE_ENFANT,
};
```

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils passent**

Run: `cd functions && npx jest test/reservation-logic.test.js && cd ..`
Expected: `Tests: 7 passed, 7 total`.

- [ ] **Step 7: Écrire les tests du contenu des emails (ils doivent échouer, le module n'existe pas encore)**

Create `functions/test/email-content.test.js`:

```js
const {
  buildCancelUrl,
  buildVisitorConfirmationEmail,
  buildComiteNewReservationEmail,
  buildComiteCancellationEmail,
} = require("../email-content");

const sampleReservation = {
  prenom: "Jean",
  nom: "Dupont",
  email: "jean@example.com",
  telephone: "0600000000",
  nb_adultes: 2,
  nb_enfants_3_10: 1,
  nb_enfants_moins_3: 0,
  totalPlaces: 3,
  montantEstime: 13,
};

test("buildCancelUrl includes the reservation id", () => {
  const url = buildCancelUrl("abc123");
  expect(url).toBe("https://cinema-en-pleine-air-opio.netlify.app/annuler.html?id=abc123");
});

test("buildVisitorConfirmationEmail addresses the visitor and includes the cancel link", () => {
  const email = buildVisitorConfirmationEmail(sampleReservation, "abc123");
  expect(email.to).toBe("jean@example.com");
  expect(email.htmlContent).toContain("3 place(s)");
  expect(email.htmlContent).toContain("abc123");
});

test("buildComiteNewReservationEmail is addressed to the comité and lists quantities", () => {
  const email = buildComiteNewReservationEmail(sampleReservation);
  expect(email.to).toBe("Oria.ei@outlook.fr");
  expect(email.htmlContent).toContain("Jean Dupont");
  expect(email.htmlContent).toContain("13 €");
});

test("buildComiteCancellationEmail mentions the freed places", () => {
  const email = buildComiteCancellationEmail(sampleReservation);
  expect(email.htmlContent).toContain("Places libérées : 3");
});
```

- [ ] **Step 8: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd functions && npx jest test/email-content.test.js && cd ..`
Expected: échec avec `Cannot find module '../email-content'`.

- [ ] **Step 9: Implémenter `functions/email-content.js`**

```js
"use strict";

const SITE_URL = "https://cinema-en-pleine-air-opio.netlify.app";
const COMITE_EMAIL = "Oria.ei@outlook.fr";

function buildCancelUrl(reservationId) {
  return SITE_URL + "/annuler.html?id=" + reservationId;
}

function buildVisitorConfirmationEmail(reservation, reservationId) {
  const cancelUrl = buildCancelUrl(reservationId);
  return {
    to: reservation.email,
    subject: "Votre réservation pour le Cinéma en plein air d'Opio",
    htmlContent:
      "<p>Bonjour " + reservation.prenom + ",</p>" +
      "<p>Votre réservation pour le 28 juillet 2026 est confirmée : " +
      reservation.totalPlaces + " place(s) (" +
      reservation.nb_adultes + " adulte(s), " +
      reservation.nb_enfants_3_10 + " enfant(s) 3-10 ans, " +
      reservation.nb_enfants_moins_3 + " enfant(s) moins de 3 ans).</p>" +
      "<p>Montant estimé à régler sur place : " + reservation.montantEstime + " €.</p>" +
      "<p>Si vous ne pouvez finalement pas venir, merci d'annuler votre place ici : " +
      "<a href=\"" + cancelUrl + "\">" + cancelUrl + "</a></p>" +
      "<p>À très vite sous les étoiles d'Opio !</p>",
  };
}

function buildComiteNewReservationEmail(reservation) {
  return {
    to: COMITE_EMAIL,
    subject: "Nouvelle réservation : " + reservation.prenom + " " + reservation.nom,
    htmlContent:
      "<p>Nouvelle réservation reçue.</p>" +
      "<ul>" +
      "<li>Nom : " + reservation.prenom + " " + reservation.nom + "</li>" +
      "<li>Email : " + reservation.email + "</li>" +
      "<li>Téléphone : " + reservation.telephone + "</li>" +
      "<li>Adultes : " + reservation.nb_adultes + "</li>" +
      "<li>Enfants 3-10 ans : " + reservation.nb_enfants_3_10 + "</li>" +
      "<li>Enfants moins de 3 ans : " + reservation.nb_enfants_moins_3 + "</li>" +
      "<li>Montant estimé : " + reservation.montantEstime + " €</li>" +
      "</ul>",
  };
}

function buildComiteCancellationEmail(reservation) {
  return {
    to: COMITE_EMAIL,
    subject: "Annulation : " + reservation.prenom + " " + reservation.nom,
    htmlContent:
      "<p>Une réservation vient d'être annulée.</p>" +
      "<ul>" +
      "<li>Nom : " + reservation.prenom + " " + reservation.nom + "</li>" +
      "<li>Places libérées : " + reservation.totalPlaces + "</li>" +
      "</ul>",
  };
}

module.exports = {
  buildCancelUrl,
  buildVisitorConfirmationEmail,
  buildComiteNewReservationEmail,
  buildComiteCancellationEmail,
};
```

- [ ] **Step 10: Lancer les tests pour vérifier qu'ils passent**

Run: `cd functions && npx jest test/email-content.test.js && cd ..`
Expected: `Tests: 4 passed, 4 total`.

- [ ] **Step 11: Implémenter `functions/index.js`**

```js
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { validateReservationInput, MAX_PLACES } = require("./reservation-logic");
const {
  buildVisitorConfirmationEmail,
  buildComiteNewReservationEmail,
  buildComiteCancellationEmail,
} = require("./email-content");

admin.initializeApp();
const db = admin.firestore();

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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }));
    tx.set(
      gaugeRef,
      {
        reserved: reserved + result.reservation.totalPlaces,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(
      gaugeRef,
      {
        reserved: Math.max(0, reserved - totalPlaces),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
```

- [ ] **Step 12: Configurer le secret Brevo et déployer**

Run: `firebase functions:secrets:set BREVO_API_KEY`
Expected: invite à coller la clé API Brevo notée à la Tâche 1, Étape 6 ; confirmation `Created a new secret version`.

Run: `firebase deploy --only functions,firestore:rules`
Expected: sortie se terminant par `✔  Deploy complete!`, avec les quatre fonctions `createReservation`, `cancelReservation`, `onReservationCreated` et `onReservationCancelled` listées comme déployées.

- [ ] **Step 13: Vérification manuelle du déclenchement des emails**

Dans la console Firebase → Firestore → collection `reservations` → ajouter manuellement un document avec tous les champs valides (voir `sampleReservation()` de la Tâche 3 comme modèle) et `status: "active"`. (Cette écriture passe par la console, donc par l'Admin SDK — elle contourne les règles client comme le ferait `createReservation`, ce qui suffit à vérifier que le trigger d'email réagit correctement à une écriture Admin SDK.)

Expected : dans les 30 secondes, un email arrive à l'adresse `email` du document (confirmation visiteur) et un autre à `Oria.ei@outlook.fr` (notification comité). Vérifier aussi les logs : Firebase Console → Functions → Logs → confirmer l'absence d'erreur pour `onReservationCreated`. Supprimer ensuite ce document de test.

La vérification des fonctions callable `createReservation` et `cancelReservation` elles-mêmes se fait en conditions réelles aux Tâches 5 et 6 (elles sont appelées directement depuis le navigateur).

- [ ] **Step 14: Commit**

```bash
git add functions/package.json functions/reservation-logic.js functions/test/reservation-logic.test.js functions/email-content.js functions/test/email-content.test.js functions/index.js functions/package-lock.json
git commit -m "feat: cloud functions callable createReservation/cancelReservation et envoi d'email via Brevo"
```

---

## Task 5: `index.html` — remplacer le système existant par Firebase

> **Révisé le 2026-06-18** : le formulaire n'écrit plus directement dans
> Firestore. Il appelle la Cloud Function callable `createReservation`
> (Tâche 4) via le SDK Firebase Functions ; la jauge reste en lecture seule
> via `onSnapshot`.

**Files:**
- Modify: `index.html:1052` (attributs du formulaire)
- Modify: `index.html:1114` (ajout du champ honeypot après les inputs de quantité)
- Modify: `index.html:1398-1505` (remplacement complet du bloc JS de réservation)
- Modify: `index.html:820` (ajout du script Firebase avant `</head>` ou juste avant `</body>`)

**Interfaces:**
- Consumes: le document `meta/gauge` en lecture seule (Tâche 3) ; la Cloud Function callable `createReservation(data)` de la Tâche 4, qui retourne `{ id }` ou lève une erreur avec `error.code === "resource-exhausted"` quand la jauge est pleine ; l'objet `firebaseConfig` à 6 champs obtenu à la Tâche 1, Étape 4.
- Produces: un formulaire de réservation qui appelle `createReservation` et une jauge alimentée par `onSnapshot` sur `meta/gauge`, réutilisés nulle part ailleurs (page autonome).

- [ ] **Step 1: Supprimer les attributs Netlify Forms du formulaire**

In `index.html`, find:

```html
      <form id="reservation-form" name="reservation" method="POST" data-netlify="true">
        <input type="hidden" name="form-name" value="reservation">

        <div class="form-row">
```

Replace with:

```html
      <form id="reservation-form" name="reservation">
        <div class="form-row">
```

- [ ] **Step 2: Ajouter le champ honeypot après le champ "moins de 3 ans"**

In `index.html`, find:

```html
        <input type="number" id="bebes" name="nb_enfants_moins_3" min="0" value="0" class="sr-only" aria-hidden="true" tabindex="-1">

        <div class="total-row">
```

Replace with:

```html
        <input type="number" id="bebes" name="nb_enfants_moins_3" min="0" value="0" class="sr-only" aria-hidden="true" tabindex="-1">

        <div style="position:absolute;left:-9999px;top:-9999px" aria-hidden="true">
          <label for="hp-field">Ne pas remplir ce champ</label>
          <input type="text" id="hp-field" name="hp" tabindex="-1" autocomplete="off">
        </div>

        <div class="total-row">
```

- [ ] **Step 3: Supprimer l'ancien bloc JS de réservation**

In `index.html`, delete the entire block from the comment `/* ---------- Réservation : compteurs, prix, jauge ---------- */` (starting at line 1398) through the end of the `if (form) { ... }` block (ending just before the final `})();` of the IIFE). Verify with:

Run: `grep -n "Réservation : compteurs" index.html`
Expected: aucun résultat après la suppression.

- [ ] **Step 4: Ajouter le nouveau script Firebase juste avant `</body>`**

In `index.html`, find the final `</body>` tag and insert this block immediately before it (after the existing closing `</script>` of the legacy IIFE):

```html
<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
  import {
    getFirestore, doc, onSnapshot
  } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
  import {
    getFunctions, httpsCallable
  } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

  var firebaseConfig = {
    apiKey: "REMPLACER_PAR_LA_VALEUR_DE_LA_TACHE_1",
    authDomain: "REMPLACER_PAR_LA_VALEUR_DE_LA_TACHE_1",
    projectId: "REMPLACER_PAR_LA_VALEUR_DE_LA_TACHE_1",
    storageBucket: "REMPLACER_PAR_LA_VALEUR_DE_LA_TACHE_1",
    messagingSenderId: "REMPLACER_PAR_LA_VALEUR_DE_LA_TACHE_1",
    appId: "REMPLACER_PAR_LA_VALEUR_DE_LA_TACHE_1"
  };

  var app = initializeApp(firebaseConfig);
  var db = getFirestore(app);
  var functions = getFunctions(app);
  var createReservation = httpsCallable(functions, 'createReservation');

  var MAX_PLACES = 150;
  var MAX_PER_RESERVATION = 10;
  var PRICE_ADULTE = 5;
  var PRICE_ENFANT = 3;

  var qty = { adultes: 0, enfants: 0, bebes: 0 };
  var qtyValueEls = {
    adultes: document.getElementById('adultes-value'),
    enfants: document.getElementById('enfants-value'),
    bebes: document.getElementById('bebes-value')
  };
  var qtyInputEls = {
    adultes: document.getElementById('adultes'),
    enfants: document.getElementById('enfants'),
    bebes: document.getElementById('bebes')
  };
  var totalPriceEl = document.getElementById('total-price');
  var gaugeFillEl = document.getElementById('gauge-fill');
  var gaugeTextEl = document.getElementById('gauge-text');
  var form = document.getElementById('reservation-form');
  var confirmMessage = document.getElementById('confirm-message');
  var fullMessage = document.getElementById('full-message');
  var submitBtn = document.getElementById('submit-btn');

  var currentReserved = 0;

  function totalRequested() {
    return qty.adultes + qty.enfants + qty.bebes;
  }

  function updatePrice() {
    var total = qty.adultes * PRICE_ADULTE + qty.enfants * PRICE_ENFANT;
    totalPriceEl.textContent = total + ' €';
  }

  function renderGauge(reserved) {
    currentReserved = reserved;
    var remaining = Math.max(0, MAX_PLACES - reserved);
    var pct = Math.min(100, (reserved / MAX_PLACES) * 100);
    gaugeFillEl.style.width = pct + '%';
    gaugeTextEl.textContent = reserved + ' / ' + MAX_PLACES;

    if (remaining <= 0) {
      form.style.display = 'none';
      confirmMessage.style.display = 'none';
      fullMessage.style.display = 'block';
    }
  }

  onSnapshot(doc(db, 'meta', 'gauge'), function (snap) {
    var data = snap.data();
    renderGauge(data ? data.reserved : 0);
  });

  document.querySelectorAll('.qty-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-target');
      var step = parseInt(btn.getAttribute('data-step'), 10);
      var next = qty[target] + step;
      if (next < 0) return;

      var remaining = MAX_PLACES - currentReserved;
      if (step > 0 && (totalRequested() + 1 > remaining || totalRequested() + 1 > MAX_PER_RESERVATION)) return;

      qty[target] = next;
      qtyValueEls[target].textContent = next;
      qtyInputEls[target].value = next;
      updatePrice();
    });
  });

  updatePrice();

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      if (totalRequested() <= 0) {
        alert('Merci de sélectionner au moins une place avant de réserver.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Envoi en cours…';

      createReservation({
        prenom: form.prenom.value.trim(),
        nom: form.nom.value.trim(),
        email: form.email.value.trim(),
        telephone: form.telephone.value.trim(),
        nb_adultes: qty.adultes,
        nb_enfants_3_10: qty.enfants,
        nb_enfants_moins_3: qty.bebes,
        hp: form.hp.value
      }).then(function () {
        form.style.display = 'none';
        confirmMessage.style.display = 'block';
      }).catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Réserver ma place';
        if (err && err.code === 'resource-exhausted') {
          form.style.display = 'none';
          fullMessage.style.display = 'block';
        } else {
          alert("Impossible d'envoyer votre réservation, réessayez.");
        }
      });
    });
  }
</script>
```

Replace the 6 `"REMPLACER_PAR_LA_VALEUR_DE_LA_TACHE_1"` strings with the exact 6 values copied from the Firebase console in Task 1, Step 4.

- [ ] **Step 5: Vérification manuelle avec l'émulateur**

Temporarily add these two lines for local testing only: right after `var db = getFirestore(app);`, add `connectFirestoreEmulator(db, '127.0.0.1', 8080);` (add `connectFirestoreEmulator` to the existing `firebase-firestore.js` import list); right after `var functions = getFunctions(app);`, add `connectFunctionsEmulator(functions, '127.0.0.1', 5001);` (add `connectFunctionsEmulator` to the existing `firebase-functions.js` import list).

Run, in one terminal: `firebase emulators:start --only firestore,functions`
Run, in another terminal, from the project root: `npx serve .` (or `python3 -m http.server 8000`)

Open the local site URL in a browser, open the Firestore Emulator UI (`http://127.0.0.1:4000/firestore`) in another tab. On the site: remplir le formulaire avec 2 adultes et 1 enfant, cliquer « Réserver ma place ».

Expected: le message de confirmation s'affiche ; l'émulateur UI montre un nouveau document dans `reservations` avec `totalPlaces: 3` et `meta/gauge.reserved` passé à `3` ; le texte de la jauge sur la page affiche `3 / 150`.

Une fois la vérification faite, **retirer** les deux lignes `connectFirestoreEmulator(...)`/`connectFunctionsEmulator(...)` et les imports correspondants avant de continuer (ce code ne doit pas partir en production).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: remplace la jauge localStorage/Netlify par Firestore en temps réel"
```

---

## Task 6: Nouvelle page `annuler.html`

> **Révisé le 2026-06-18** : l'annulation n'écrit plus directement dans
> Firestore. La page appelle la Cloud Function callable `cancelReservation`
> (Tâche 4) via le SDK Firebase Functions ; la lecture du récapitulatif
> reste une lecture directe (`getDoc`), autorisée par les règles.

**Files:**
- Create: `annuler.html`

**Interfaces:**
- Consumes: la lecture publique de `reservations/{id}` (Tâche 3) ; la Cloud Function callable `cancelReservation({ reservationId })` de la Tâche 4, qui retourne `{ success: true }` ou lève une erreur avec `error.code === "failed-precondition"` si déjà annulée/introuvable ; l'objet `firebaseConfig` de la Tâche 1 ; les liens `https://cinema-en-pleine-air-opio.netlify.app/annuler.html?id=<id>` générés par `buildCancelUrl` (Tâche 4).
- Produces: une page autonome, aucune autre tâche n'en dépend.

- [ ] **Step 1: Créer `annuler.html`**

```html
<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Annuler ma réservation — Cinéma en plein air d'Opio</title>
<meta name="robots" content="noindex">
<style>
  body { font-family: system-ui, sans-serif; background:#11101a; color:#f6f1e7; max-width: 560px; margin: 60px auto; padding: 0 20px; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  .card { background: rgba(255,255,255,0.06); border-radius: 12px; padding: 24px; margin-top: 24px; }
  button { background:#e8a33d; color:#11101a; border:none; border-radius:8px; padding:12px 20px; font-size:1rem; cursor:pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  a { color:#e8a33d; }
  .error, .success { display:none; }
</style>
</head>
<body>
  <h1>Annuler ma réservation</h1>
  <div class="card" id="loading-state">Chargement de votre réservation…</div>

  <div class="card" id="confirm-state" style="display:none">
    <p id="recap-text"></p>
    <button id="cancel-btn" type="button">Annuler cette réservation</button>
  </div>

  <div class="card success" id="success-state">
    <p>Votre réservation a bien été annulée. Votre place est libérée pour d'autres visiteurs.</p>
  </div>

  <div class="card error" id="error-state">
    <p>Cette réservation est introuvable ou a déjà été annulée.</p>
  </div>

  <p><a href="/">&larr; Retour au site du Cinéma en plein air d'Opio</a></p>

<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
  import {
    getFirestore, doc, getDoc
  } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
  import {
    getFunctions, httpsCallable
  } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

  var firebaseConfig = {
    apiKey: "REMPLACER_PAR_LA_VALEUR_DE_LA_TACHE_1",
    authDomain: "REMPLACER_PAR_LA_VALEUR_DE_LA_TACHE_1",
    projectId: "REMPLACER_PAR_LA_VALEUR_DE_LA_TACHE_1",
    storageBucket: "REMPLACER_PAR_LA_VALEUR_DE_LA_TACHE_1",
    messagingSenderId: "REMPLACER_PAR_LA_VALEUR_DE_LA_TACHE_1",
    appId: "REMPLACER_PAR_LA_VALEUR_DE_LA_TACHE_1"
  };

  var app = initializeApp(firebaseConfig);
  var db = getFirestore(app);
  var functions = getFunctions(app);
  var cancelReservation = httpsCallable(functions, 'cancelReservation');

  var loadingState = document.getElementById('loading-state');
  var confirmState = document.getElementById('confirm-state');
  var successState = document.getElementById('success-state');
  var errorState = document.getElementById('error-state');
  var recapText = document.getElementById('recap-text');
  var cancelBtn = document.getElementById('cancel-btn');

  var params = new URLSearchParams(window.location.search);
  var reservationId = params.get('id');
  var reservationRef = reservationId ? doc(db, 'reservations', reservationId) : null;

  function showError() {
    loadingState.style.display = 'none';
    confirmState.style.display = 'none';
    errorState.style.display = 'block';
  }

  if (!reservationRef) {
    showError();
  } else {
    getDoc(reservationRef).then(function (snap) {
      if (!snap.exists() || snap.data().status !== 'active') {
        showError();
        return;
      }
      var data = snap.data();
      recapText.textContent = 'Annuler la réservation de ' + data.totalPlaces +
        ' place(s) au nom de ' + data.prenom + ' ' + data.nom + ' ?';
      loadingState.style.display = 'none';
      confirmState.style.display = 'block';
    }).catch(showError);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Annulation en cours…';

      cancelReservation({ reservationId: reservationId }).then(function () {
        confirmState.style.display = 'none';
        successState.style.display = 'block';
      }).catch(function () {
        showError();
      });
    });
  }
</script>
</body>
</html>
```

Replace the 6 `"REMPLACER_PAR_LA_VALEUR_DE_LA_TACHE_1"` strings with the same exact values used in Task 5, Step 4.

- [ ] **Step 2: Vérification manuelle avec l'émulateur**

Avec le même émulateur lancé qu'à la Tâche 5 (`firebase emulators:start --only firestore,functions`), ajouter temporairement les mêmes deux lignes `connectFirestoreEmulator(db, '127.0.0.1', 8080)` et `connectFunctionsEmulator(functions, '127.0.0.1', 5001)` (même procédure qu'à la Tâche 5, Étape 5) dans `annuler.html`.

Dans l'émulateur UI (`http://127.0.0.1:4000/firestore`), copier l'ID d'un document `reservations` existant (créé via le formulaire à la Tâche 5, ou créé manuellement dans l'UI de l'émulateur). Ouvrir `http://localhost:8000/annuler.html?id=<id-copié>`.

Expected : la page affiche le récapitulatif avec le bon prénom/nom/nombre de places. Cliquer sur « Annuler cette réservation ».

Expected : le message de succès s'affiche ; dans l'émulateur UI, le document passe à `status: "cancelled"` et `meta/gauge.reserved` diminue du `totalPlaces` correspondant.

Recharger la même URL une seconde fois.

Expected : le message « introuvable ou déjà annulée » s'affiche (puisque le statut n'est plus `"active"`).

Retirer ensuite les deux lignes `connectFirestoreEmulator(...)`/`connectFunctionsEmulator(...)` et leurs imports avant de continuer (ne doit pas partir en production).

- [ ] **Step 3: Commit**

```bash
git add annuler.html
git commit -m "feat: ajoute la page d'annulation de réservation en libre-service"
```

---

## Task 7: Déploiement final et test de bout en bout

**Files:** aucun nouveau fichier (déploiement et vérification manuelle).

**Interfaces:**
- Consumes: l'ensemble des tâches précédentes.
- Produces: le site en production avec la jauge partagée fonctionnelle.

- [ ] **Step 1: Déployer les règles Firestore et les Cloud Functions définitives**

Run: `firebase deploy --only firestore:rules,functions`
Expected: `✔  Deploy complete!`

- [ ] **Step 2: Vérifier que `meta/gauge` est bien à `0` avant l'ouverture des réservations**

Dans la console Firebase → Firestore → `meta/gauge`, confirmer `reserved: 0` (remettre à `0` manuellement si des tests précédents l'ont modifié sur le projet réel, pas seulement sur l'émulateur).

- [ ] **Step 3: Publier `index.html` et `annuler.html` sur Netlify**

Utiliser la méthode déjà en place pour ce site (déploiement manuel par glisser-déposer du dossier sur app.netlify.com, ou `netlify deploy --prod` si la CLI Netlify est déjà configurée pour ce site).

Expected: `https://cinema-en-pleine-air-opio.netlify.app` et `https://cinema-en-pleine-air-opio.netlify.app/annuler.html` répondent avec le nouveau contenu.

- [ ] **Step 4: Test de bout en bout sur le site en production**

Effectuer, dans cet ordre, sur le site réel (pas l'émulateur) :

1. Ouvrir le site sur deux appareils ou onglets différents.
2. Sur le premier, faire une réservation de 2 places avec une adresse email que vous contrôlez.
3. Vérifier que le second onglet voit la jauge passer à `2 / 150` **sans recharger la page**.
4. Vérifier la réception de l'email de confirmation (contenant le lien d'annulation) et de l'email de notification à `Oria.ei@outlook.fr`.
5. Cliquer sur le lien d'annulation reçu par email, confirmer l'annulation.
6. Vérifier que la jauge redescend à `0 / 150` sur les deux onglets, et que l'email de notification d'annulation arrive à `Oria.ei@outlook.fr`.
7. Recharger la page d'annulation déjà utilisée : confirmer l'affichage du message « introuvable ou déjà annulée ».

Expected: les 7 vérifications passent. Si l'une échoue, consulter Firebase Console → Functions → Logs pour les erreurs d'envoi d'email, ou la console du navigateur pour les erreurs Firestore.

- [ ] **Step 5: Commit final (si des ajustements ont été faits pendant le test)**

```bash
git add -A
git commit -m "chore: ajustements post-déploiement de la jauge de réservation Firebase"
```

(Ne committer cette étape que si des fichiers ont effectivement changé pendant le Step 4.)
