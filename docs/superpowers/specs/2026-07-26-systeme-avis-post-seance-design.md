# Système de retour d'expérience (avis) post-séance — Design

**Date :** 2026-07-26
**Auteur :** Oria (Raphaël Lambert) + Claude
**Statut :** Validé (design), spec en revue

---

## 1. Objectif

Après une séance de cinéma, solliciter automatiquement les personnes ayant
réservé pour recueillir leur retour d'expérience, via un email les invitant à
remplir un court formulaire d'avis hébergé sur le site. Les réponses sont
stockées dans Firebase et exportables en Excel, comme les réservations.

Ce système est une brique du produit « Oria » destiné à être réutilisé pour
plusieurs communes.

---

## 2. Décisions de conception (validées)

| Sujet | Choix retenu |
|---|---|
| Échelle de note | Étoiles **1 à 5** |
| Questions du formulaire | Note (⭐1-5) + commentaire libre + « Quel film aimeriez-vous voir ? » |
| Anonymat | Avis **lié à la réservation** (prénom/nom connus, non affichés publiquement) |
| Adresse expéditeur | `reservations@opio.oria-events.fr` (déjà authentifiée DKIM/DMARC) |
| Activation | Construit et testé maintenant ; **envoi automatique inerte pour Opio**, armé pour les prochaines séances |
| Limite d'envoi | **50 emails/jour** (configurable), étalement automatique sur plusieurs jours si dépassement |
| Heure d'envoi | **9h00**, fuseau `Europe/Paris` |

---

## 3. Architecture

Le système reprend le modèle de sécurité existant : **les navigateurs ne font
que lire** (ou appeler des fonctions), **toutes les écritures passent par des
Cloud Functions** (Admin SDK, immunisé aux règles client).

### 3.1 Composants

1. **Page `public/avis.html`** — page autonome (modèle `annuler.html`), mais
   habillée à la charte du site principal (variables CSS `--c-bg`, `--c-gold`,
   polices Fraunces/Outfit, carte `.glass`, champs `.field`).
   - URL : `https://cinema-en-pleine-air-opio.oria-events.fr/avis.html?id=<reservationId>`
   - Lit la réservation (`getDoc`, autorisé par `allow get: if true`) pour
     accueillir la personne par son prénom.
   - Formulaire : sélecteur d'étoiles 1-5, `textarea` commentaire, `textarea`
     film souhaité, bouton « Envoyer mon avis ».
   - Appelle la fonction `submitFeedback`.
   - Gère les états : formulaire → merci ; déjà répondu → message ; lien
     invalide → message d'erreur.

2. **Collection Firestore `avis`** — un document par réponse :
   ```
   {
     reservationId: string,      // lien vers la réservation
     prenom: string,             // recopié pour lisibilité de l'export
     nom: string,
     note: number,               // entier 1..5
     commentaire: string,        // peut être vide
     film_souhaite: string,      // peut être vide
     createdAt: timestamp
   }
   ```

3. **Cloud Function `submitFeedback`** (callable) — valide et enregistre l'avis.
   - Vérifie que `reservationId` existe et correspond à une réservation.
   - Vérifie qu'aucun avis n'existe déjà pour ce `reservationId` (anti-doublon) ;
     sinon `HttpsError("failed-precondition", "ALREADY_SUBMITTED")`.
   - Valide la note (entier 1..5) et borne la longueur des textes (ex. 2000
     caractères) ; sinon `HttpsError("invalid-argument", ...)`.
   - Écrit le document dans `avis` avec `createdAt = serverTimestamp()`.

4. **Cloud Function programmée `sendFeedbackRequests`** (`onSchedule`,
   `"0 9 * * *"`, `timeZone: "Europe/Paris"`, `secrets: [BREVO_API_KEY]`).
   - Lit `meta/session`. Si `feedbackEnabled !== true`, **ne fait rien** (état
     inerte — cas d'Opio).
   - Si activé et que la date du jour est ≥ `sessionDate` + 1 jour :
     - Récupère **toutes** les réservations `status === "active"` (triées par
       `createdAt` ascendant), puis **filtre en mémoire** celles dont
       `avisRequestSent !== true`. (On évite la requête Firestore `!= true`, qui
       ignore les documents où le champ est absent ; le volume est faible.)
     - En prend **jusqu'à 50** (limite configurable `MAX_FEEDBACK_EMAILS_PER_DAY`).
     - Pour chacune : envoie l'email de demande d'avis via Brevo, puis met
       `avisRequestSent = true` et `avisRequestSentAt = serverTimestamp()` sur la
       réservation.
   - Les réservations restantes seront traitées au prochain réveil (J+2, J+3…),
     réalisant l'étalement automatique.
   - Idempotence : le marquage `avisRequestSent` garantit qu'une personne n'est
     jamais sollicitée deux fois, même si la fonction est relancée.

5. **Document de configuration `meta/session`** :
   ```
   {
     sessionDate: timestamp,      // date/heure de la séance
     feedbackEnabled: boolean     // interrupteur d'envoi automatique des avis
   }
   ```
   - Pour Opio : `feedbackEnabled: false` (inerte). Le document peut être créé
     avec la date du 28/07/2026 et l'interrupteur à `false`.

6. **Constructeur d'email `buildFeedbackRequestEmail`** (dans
   `functions/email-content.js`) — email au visiteur contenant le lien
   `SITE_URL + "/avis.html?id=" + reservationId`, ton chaleureux, cohérent avec
   les autres emails.

7. **Outil d'export** — `outils-export/export-avis.js` (ou extension de
   l'existant) pour exporter la collection `avis` en `.xlsx` : note, commentaire,
   film souhaité, prénom/nom, date.

### 3.2 Règles de sécurité Firestore (`firestore.rules`)

Ajouter la collection `avis` en **lecture seule impossible côté client** (les
données d'avis restent privées ; le client n'a jamais besoin de les lire, il ne
fait qu'appeler `submitFeedback`) :

```
match /avis/{avisId} {
  allow get, list: if false;
  allow create, update, delete: if false;
}
```

`meta/session` suit le modèle de `meta/gauge` : `allow get: if true;` (la page
pourrait éventuellement lire la date), `list` et écritures `false`.

---

## 4. Flux de données

```
Séance (soir J)
   │
   ▼  meta/session.feedbackEnabled == true  ET  aujourd'hui >= sessionDate + 1j
sendFeedbackRequests (9h Paris, quotidien)
   │  prend jusqu'à 50 réservations "avisRequestSent != true"
   ▼
Brevo → email "donnez votre avis" (lien avis.html?id=…)  → marque avisRequestSent
   │
   ▼
Visiteur clique → avis.html lit la réservation (prénom) → remplit ⭐+texte
   │
   ▼
submitFeedback (callable) → valide + anti-doublon → écrit dans "avis"
   │
   ▼
Oria consulte / exporte "avis" en Excel
```

---

## 5. Gestion des erreurs

| Cas | Comportement |
|---|---|
| Lien `avis.html` sans `id` ou id inconnu | Message « lien invalide » (comme `annuler.html`) |
| Avis déjà soumis pour cette réservation | Message « Vous avez déjà donné votre avis, merci ! » |
| Note absente / hors 1..5 | Bouton d'envoi bloqué côté page + rejet `invalid-argument` côté fonction |
| Échec d'envoi Brevo (une réservation) | L'email en échec n'est **pas** marqué `avisRequestSent` (retenté au prochain réveil) ; les autres continuent (pas de blocage global) |
| `meta/session` absent ou `feedbackEnabled=false` | La fonction programmée ne fait rien (état normal inerte) |

---

## 6. Tests

- **Unitaires (Jest, côté functions) :**
  - Validation de l'avis : note valide/invalide, textes trop longs, champs
    optionnels vides acceptés.
  - `buildFeedbackRequestEmail` : destinataire = email visiteur, lien
    `avis.html?id=…` présent.
  - Logique de sélection : ne prend que les `active` + `avisRequestSent != true`,
    respecte la limite de 50.
- **Manuel bout-en-bout :** créer une réservation de test → déclencher l'envoi
  (via un chemin de test contrôlé) → ouvrir `avis.html` → soumettre → vérifier
  le document dans `avis` + l'anti-doublon → export Excel.

---

## 7. Hors périmètre (YAGNI)

- Pas de relance automatique des non-répondants (idée notée pour plus tard).
- Pas de tableau de bord statistique intégré (l'export Excel suffit au départ).
- Pas de gestion multi-communes dans ce lot (le modèle `meta/session` unique
  suffit pour l'événement courant ; la généralisation multi-événements fera
  l'objet d'un projet distinct).
- Pas de QR code sur place (idée notée pour plus tard).
- Envoi manuel pour Opio : non automatisé ; si souhaité, déclenché
  ponctuellement via l'outil admin, hors de ce lot.

---

## 8. Impact & coûts

- **Stockage :** ~1 Ko/avis, négligeable vs 1 Go gratuit Firestore.
- **Écritures :** ~50/jour max, vs 20 000 gratuites/jour.
- **Cloud Scheduler :** 1 tâche, gratuit (jusqu'à 3).
- **Brevo :** ≤ 50 emails/jour, très en dessous des 300/jour du plan gratuit.
- **Coût total : 0 €.**
