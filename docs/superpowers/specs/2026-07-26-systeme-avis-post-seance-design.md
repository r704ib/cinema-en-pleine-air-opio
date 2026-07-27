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
| Consentement de publication | Case à cocher opt-in « J'autorise la publication de mon avis (prénom) ». Publication future en **prénom + initiale** (« Marie D. »), uniquement pour les avis consentis |
| Relance | **Une seule** relance automatique des non-répondants, **3 jours** après la 1ʳᵉ demande (configurable) ; lien de désinscription inclus |
| Canal QR sur place | Page d'avis générique accessible par QR code ; l'utilisateur saisit **seulement son email**. Le système déduit prénom/nom en cherchant l'email dans les réservations (et relie l'avis si trouvé) |
| Adresse expéditeur | `reservations@opio.oria-events.fr` (déjà authentifiée DKIM/DMARC) |
| Activation | Construit et testé maintenant ; **envoi automatique inerte pour Opio**, armé pour les prochaines séances |
| Limite d'envoi | **50 emails/jour** (configurable), étalement automatique sur plusieurs jours ; relances incluses dans ce quota |
| Heure d'envoi | **9h00**, fuseau `Europe/Paris` |

---

## 3. Architecture

Le système reprend le modèle de sécurité existant : **les navigateurs ne font
que lire** (ou appeler des fonctions), **toutes les écritures passent par des
Cloud Functions** (Admin SDK, immunisé aux règles client).

### 3.1 Composants

1. **Page `public/avis.html`** — page autonome (modèle `annuler.html`), mais
   habillée à la charte du site principal (variables CSS `--c-bg`, `--c-gold`,
   polices Fraunces/Outfit, carte `.glass`, champs `.field`). **Deux modes :**
   - **Mode email** : URL `…/avis.html?id=<reservationId>`. Lit la réservation
     (`getDoc`, autorisé par `allow get: if true`) pour accueillir la personne
     par son prénom ; le prénom/nom ne sont pas saisis (déjà connus).
   - **Mode QR** : URL `…/avis.html?source=qr` (sans `id`). Affiche un champ
     **email** (requis) ; le prénom/nom seront déduits côté serveur.
   - Formulaire commun : sélecteur d'étoiles 1-5 (requis), `textarea`
     commentaire, `textarea` film souhaité, **case à cocher opt-in** « J'autorise
     la publication de mon avis (prénom) sur le site », bouton « Envoyer mon
     avis ».
   - Appelle la fonction `submitFeedback`.
   - Gère les états : formulaire → merci ; déjà répondu (mode email) → message ;
     lien invalide → message d'erreur.

2. **Collection Firestore `avis`** — un document par réponse :
   ```
   {
     source: "email" | "qr",       // origine de l'avis
     reservationId: string | null, // lien vers la réservation (null si non identifié)
     email: string,                // toujours renseigné (réservation ou saisi en QR)
     prenom: string,               // déduit de la réservation ; vide si non identifié
     nom: string,                  // idem, peut être vide
     note: number,                 // entier 1..5
     commentaire: string,          // peut être vide
     film_souhaite: string,        // peut être vide
     publication_autorisee: boolean, // consentement de publication
     createdAt: timestamp
   }
   ```

3. **Cloud Function `submitFeedback`** (callable) — valide et enregistre l'avis.
   - **Mode email** (`reservationId` fourni) : vérifie que la réservation existe ;
     vérifie qu'aucun avis n'existe déjà pour ce `reservationId` (anti-doublon) ;
     sinon `HttpsError("failed-precondition", "ALREADY_SUBMITTED")`. Recopie
     email/prénom/nom depuis la réservation (ignore ceux envoyés par le client).
   - **Mode QR** (`source === "qr"`) : exige un `email` valide. Recherche une
     réservation avec cet email (normalisé en minuscules) :
     - **Trouvée** → relie l'avis (`reservationId`), recopie prénom/nom depuis la
       réservation, marque la/les réservation(s) de cet email comme ayant répondu
       (pas de relance). Anti-doublon par email : si un avis existe déjà pour cet
       email → `ALREADY_SUBMITTED`.
     - **Non trouvée** → avis enregistré avec l'email saisi, sans prénom/nom
       (`reservationId: null`) ; restera anonyme (non publiable avec nom).
   - Valide la note (entier 1..5) et borne la longueur des textes (ex. 2000
     caractères) ; normalise `publication_autorisee` en booléen ; sinon
     `HttpsError("invalid-argument", ...)`.
   - Écrit le document dans `avis` avec `createdAt = serverTimestamp()`.

4. **Cloud Function programmée `sendFeedbackRequests`** (`onSchedule`,
   `"0 9 * * *"`, `timeZone: "Europe/Paris"`, `secrets: [BREVO_API_KEY]`).
   - Lit `meta/session`. Si `feedbackEnabled !== true`, **ne fait rien** (état
     inerte — cas d'Opio).
   - Si activé et que le jour calendaire courant est strictement postérieur au jour
     de la séance (envoi dès **le lendemain matin**, pas J+2) :
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
   - **Relances** : lors du même réveil quotidien, la fonction sélectionne aussi
     les réservations `active` où `avisRequestSent === true`, dont
     `avisRequestSentAt` remonte à **≥ 3 jours** (`FEEDBACK_REMINDER_DELAY_DAYS`,
     configurable), qui **n'ont pas d'avis enregistré** (aucun document `avis`
     avec ce `reservationId`) et où `avisRelanceSent !== true`. Elle envoie **une
     seule** relance (email de rappel avec lien d'avis + lien de désinscription),
     puis met `avisRelanceSent = true` et `avisRelanceSentAt`. Les relances
     comptent dans le quota quotidien (priorité aux 1ʳᵉˢ demandes, puis relances).

5. **Document de configuration `meta/session`** :
   ```
   {
     sessionDate: timestamp,      // date/heure de la séance
     feedbackEnabled: boolean     // interrupteur d'envoi automatique des avis
   }
   ```
   - Pour Opio : `feedbackEnabled: false` (inerte). Le document peut être créé
     avec la date du 28/07/2026 et l'interrupteur à `false`.

6. **Constructeurs d'emails** (dans `functions/email-content.js`) :
   - `buildFeedbackRequestEmail` — 1ʳᵉ demande d'avis, lien
     `SITE_URL + "/avis.html?id=" + reservationId`, ton chaleureux.
   - `buildFeedbackReminderEmail` — relance (rappel), même lien + **lien de
     désinscription** (`SITE_URL + "/avis.html?id=" + reservationId + "&stop=1"`
     ou mécanisme équivalent) pour ne plus être sollicité.

7. **Outil d'export** — `outils-export/export-avis.js` (ou extension de
   l'existant) pour exporter la collection `avis` en `.xlsx` : source, note,
   commentaire, film souhaité, prénom/nom, consentement de publication, date.

8. **QR code** — génération d'une image (`outils-export/genere-qr.js` ou
   équivalent) encodant l'URL `SITE_URL + "/avis.html?source=qr"`, fournie en
   `.png` à imprimer/afficher sur place. (Un seul QR, valable pour toute séance.)

9. **Désinscription** — un lien `&stop=1` (ou route dédiée) qui, via une
   petite Cloud Function callable `stopFeedback`, marque la réservation
   `avisOptOut = true` : elle ne recevra plus ni demande ni relance. Le
   sélecteur d'envoi (composant 4) exclut les réservations `avisOptOut === true`.

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

Pour permettre l'anti-doublon **côté page** (informer l'utilisateur avant envoi
en mode email), la vérification d'existence d'un avis se fait dans la fonction
`submitFeedback` (Admin SDK, immunisé aux règles) — le client ne lit jamais la
collection `avis`.

`meta/session` suit le modèle de `meta/gauge` : `allow get: if true;` (la page
pourrait éventuellement lire la date), `list` et écritures `false`.

---

## 4. Flux de données

```
Séance (soir J)
   │
   ▼  meta/session.feedbackEnabled == true  ET  aujourd'hui >= sessionDate + 1j
sendFeedbackRequests (9h Paris, quotidien) — exclut avisOptOut == true
   │  1ʳᵉ demande : jusqu'à 50 réservations "avisRequestSent != true"
   │  relances    : sollicitées depuis >=3j, sans avis, avisRelanceSent != true
   ▼
Brevo → email (demande OU relance, lien avis.html?id=…) → marque le repère
   │
   ▼
Visiteur clique → avis.html (mode email : prénom pré-rempli) → remplit ⭐+texte+consentement
   │
   ▼
submitFeedback (callable) → valide + anti-doublon → écrit dans "avis"
   │
   ▼
Oria consulte / exporte "avis" en Excel


Parcours QR (sur place) :
QR affiché → avis.html?source=qr → l'utilisateur saisit son EMAIL + ⭐+texte
   → submitFeedback (source="qr") → recherche l'email dans les réservations
   → si trouvé : relie + déduit prénom/nom + marque "a répondu"
   → si non trouvé : avis anonyme avec email → écrit dans "avis"
```

---

## 5. Gestion des erreurs

| Cas | Comportement |
|---|---|
| Lien `avis.html` sans `id` **et** sans `source=qr` | Message « lien invalide » (comme `annuler.html`) |
| Avis déjà soumis pour cette réservation (mode email) | Message « Vous avez déjà donné votre avis, merci ! » |
| Mode QR : email vide ou invalide | Bouton bloqué côté page + rejet `invalid-argument` côté fonction |
| Mode QR : email inconnu (pas de réservation) | Avis enregistré, mais anonyme (sans nom) — non publiable avec nom |
| Mode QR : email déjà utilisé pour un avis | `ALREADY_SUBMITTED` (anti-doublon par email) |
| Note absente / hors 1..5 | Bouton d'envoi bloqué côté page + rejet `invalid-argument` côté fonction |
| Échec d'envoi Brevo (une réservation) | L'email en échec n'est **pas** marqué envoyé (retenté au prochain réveil) ; les autres continuent (pas de blocage global) |
| `meta/session` absent ou `feedbackEnabled=false` | La fonction programmée ne fait rien (état normal inerte) |
| Personne désinscrite (`avisOptOut=true`) | Exclue des demandes et des relances |

---

## 6. Tests

- **Unitaires (Jest, côté functions) :**
  - Validation de l'avis : note valide/invalide, textes trop longs, champs
    optionnels vides acceptés, `publication_autorisee` normalisé en booléen.
  - Mode QR : email requis ; correspondance email→réservation (trouvée = reliée
    + nom déduit ; non trouvée = avis anonyme) ; anti-doublon par email.
  - Mode email : prénom/nom recopiés de la réservation.
  - `buildFeedbackRequestEmail` / `buildFeedbackReminderEmail` : destinataire =
    email visiteur, lien `avis.html?id=…` présent ; la relance contient le lien
    de désinscription.
  - Logique de sélection : 1ʳᵉ demande ne prend que `active` +
    `avisRequestSent != true` + `avisOptOut != true`, respecte la limite de 50 ;
    relance ne prend que sollicités depuis ≥3j, sans avis, `avisRelanceSent != true`.
- **Manuel bout-en-bout :** créer une réservation de test → déclencher l'envoi
  (via un chemin de test contrôlé) → ouvrir `avis.html` (mode email) → soumettre
  → vérifier le document dans `avis` + l'anti-doublon → tester le mode QR
  (`?source=qr`) → vérifier la désinscription → export Excel.

---

## 7. Conformité RGPD — publication des avis

- Les avis sont collectés dans un cadre **privé** (email de suivi / QR). Leur
  **republication publique** (site vitrine) n'est autorisée que pour les avis
  dont `publication_autorisee === true` (consentement opt-in explicite).
- Publication recommandée en **prénom + initiale du nom** (« Marie D. »).
- Droit de retrait : une personne peut demander la suppression de son avis
  publié ; l'avis reste modifiable/supprimable via l'outil admin.
- *L'affichage effectif des avis sur le site vitrine `oria-events.fr` fera
  l'objet d'un lot ultérieur ; ce lot-ci ne fait que collecter le consentement.*

## 8. Hors périmètre (YAGNI)

- Pas de tableau de bord statistique intégré (l'export Excel suffit au départ).
- Pas de gestion multi-communes dans ce lot (le modèle `meta/session` unique
  suffit pour l'événement courant ; la généralisation multi-événements fera
  l'objet d'un projet distinct).
- Pas d'affichage public des avis dans ce lot (seulement la collecte + le
  consentement) — voir §7.
- Plus d'**une** relance : volontairement limité à une seule, pour protéger la
  réputation d'expéditeur (risque de plaintes spam).
- Envoi manuel pour Opio : non automatisé ; si souhaité, déclenché
  ponctuellement via l'outil admin, hors de ce lot.

---

## 9. Impact & coûts

- **Stockage :** ~1 Ko/avis, négligeable vs 1 Go gratuit Firestore.
- **Écritures :** ~50/jour max, vs 20 000 gratuites/jour.
- **Cloud Scheduler :** 1 tâche, gratuit (jusqu'à 3).
- **Brevo :** ≤ 50 emails/jour, très en dessous des 300/jour du plan gratuit.
- **Coût total : 0 €.**
