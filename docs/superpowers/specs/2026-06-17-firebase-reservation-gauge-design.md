# Jauge de réservation partagée via Firebase

Date : 2026-06-17
Statut : approuvé, en attente du plan d'implémentation

## Contexte

Le site `cinema-plein-air-opio/index.html` propose un formulaire de réservation
pour la projection du 28 juillet 2026 (jauge limitée à 150 personnes). Le site
est déjà déployé sur Netlify.

Aujourd'hui, le formulaire soumet les données via Netlify Forms
(`data-netlify="true"`), et la jauge affichée à l'écran est calculée à partir
d'un compteur stocké en `localStorage` du navigateur. Ce compteur n'est donc
**pas partagé entre visiteurs** : chaque appareil a sa propre jauge locale, ce
qui ne reflète pas le nombre réel de réservations. Il n'existe par ailleurs
aucun moyen pour un visiteur d'annuler sa réservation en ligne — l'annulation
se fait aujourd'hui uniquement par contact manuel avec le comité des fêtes.

## Objectif

Remplacer ce système par une jauge réellement partagée entre tous les
visiteurs, alimentée par de vraies réservations stockées côté serveur, avec :
- une mise à jour de la jauge en temps réel pour tous les visiteurs ;
- un moyen pour chaque visiteur d'annuler sa propre réservation en ligne ;
- une notification automatique par email au comité des fêtes à chaque
  réservation et annulation, ainsi qu'un email de confirmation au visiteur
  contenant son lien d'annulation.

## Non-objectifs

- Pas de paiement en ligne (inchangé : règlement sur place).
- Pas d'interface d'administration dédiée : le comité consulte/gère les
  réservations directement depuis la console Firebase si besoin (ex : sur
  un cas particulier en dehors du flux normal).
- Pas de compte utilisateur / authentification pour les visiteurs.

## Architecture générale

```
Navigateur visiteur
   │
   ├─► Firestore (écriture directe via SDK JS, sécurisée par règles)
   │      ├─ collection "reservations" (un document par réservation)
   │      └─ document "meta/gauge" (compteur total, lu en temps réel par tous)
   │
   └─► (lecture) onSnapshot sur "meta/gauge" → jauge mise à jour en direct

Firestore (trigger automatique, indépendant du navigateur)
   │
   └─► Cloud Functions "onReservationCreated" / "onReservationCancelled"
          └─► API Brevo → email de confirmation au visiteur
                          → email de notification au comité des fêtes

Lien d'annulation (envoyé par email au visiteur)
   │
   └─► Page "annuler.html?id=<id-du-document>"
          └─► Transaction Firestore : statut → "cancelled", décrément de la jauge
```

Aucun serveur applicatif à maintenir : les écritures/lectures passent par le
SDK Firebase JS côté client (sécurisées par les règles Firestore), à
l'exception de l'envoi d'email qui passe par des Cloud Functions afin de
garder la clé API Brevo secrète (jamais exposée côté client).

## Modèle de données Firestore

### Collection `reservations`

Un document par réservation. L'ID du document est généré automatiquement par
Firestore (chaîne aléatoire non devinable) et sert aussi de jeton secret pour
le lien d'annulation — pas besoin d'un champ ou d'un système de jetons séparé.

| Champ | Type | Détail |
|---|---|---|
| `prenom` | string | requis, non vide |
| `nom` | string | requis, non vide |
| `email` | string | requis, format email |
| `telephone` | string | requis, non vide |
| `nb_adultes` | number | entier ≥ 0 |
| `nb_enfants_3_10` | number | entier ≥ 0 |
| `nb_enfants_moins_3` | number | entier ≥ 0 |
| `totalPlaces` | number | = somme des 3 quantités ci-dessus ; doit être compris entre 1 et 10 |
| `montantEstime` | number | = `nb_adultes * 5 + nb_enfants_3_10 * 3` (en euros) |
| `status` | string | `"active"` ou `"cancelled"` |
| `createdAt` | timestamp | horodatage serveur Firestore (`serverTimestamp()`) |
| `cancelledAt` | timestamp \| null | rempli uniquement au moment de l'annulation |
| `hp` | string | champ honeypot anti-bot, doit être une chaîne vide |

### Document unique `meta/gauge`

| Champ | Type | Détail |
|---|---|---|
| `reserved` | number | total des places actuellement actives (somme des `totalPlaces` des réservations `"active"`) |
| `updatedAt` | timestamp | horodatage serveur de la dernière mise à jour |

Ce document est initialisé manuellement une fois à `{ reserved: 0 }` lors de la
mise en place du projet Firebase.

### Règles de sécurité Firestore (résumé fonctionnel)

- **Création d'une réservation** (`reservations/{id}`, `create`) : autorisée
  uniquement si :
  - `totalPlaces` est un entier entre 1 et 10 et égal à la somme des 3
    quantités fournies ;
  - `hp` est une chaîne vide ;
  - `prenom`, `nom`, `email`, `telephone` sont des chaînes non vides ;
  - `status` vaut `"active"` ;
  - la même requête met à jour `meta/gauge.reserved` en l'incrémentant
    exactement de `totalPlaces`, sans dépasser 150.
- **Annulation** (`reservations/{id}`, `update`) : autorisée uniquement si :
  - le document existe et son `status` actuel est `"active"` ;
  - les seuls champs modifiés sont `status` (→ `"cancelled"`) et
    `cancelledAt` ;
  - la même requête décrémente `meta/gauge.reserved` de `totalPlaces`.
- **`meta/gauge`** : lecture publique libre ; écriture uniquement dans le
  cadre des deux transactions ci-dessus (jamais de modification arbitraire
  directe par un client).
- Aucune lecture publique de la collection `reservations` dans son ensemble
  (un client ne peut lire un document de réservation que s'il en connaît déjà
  l'ID — utile pour la page d'annulation, mais empêche de lister les
  réservations des autres visiteurs).

## Flux de réservation

1. Le visiteur remplit le formulaire existant (prénom, nom, email, téléphone,
   quantités via les boutons +/-).
2. Au clic sur « Réserver ma place », le JS du site lance une **transaction
   Firestore** qui :
   - lit `meta/gauge.reserved` ;
   - vérifie que `reserved + totalPlaces ≤ 150` ;
   - si oui : crée le document `reservations` (`status: "active"`) et
     incrémente `meta/gauge.reserved` du même montant, en une seule opération
     atomique.
3. Si la transaction réussit : le formulaire est remplacé par le message de
   confirmation existant. La Cloud Function `onReservationCreated` se déclenche
   en arrière-plan et envoie les emails (voir plus bas).
4. Si la transaction échoue car la jauge est désormais pleine (quelqu'un
   d'autre a réservé les dernières places entre-temps) : le formulaire est
   remplacé par le message « jauge atteinte » déjà existant sur le site.
5. En cas d'erreur réseau/Firestore (pas de connexion, etc.) : un message
   d'erreur clair est affiché (« Impossible d'envoyer votre réservation,
   réessayez. ») et le bouton de soumission est réactivé pour permettre une
   nouvelle tentative.

## Flux d'annulation

1. Le visiteur reçoit par email (voir plus bas) un lien personnel de la forme
   `https://<domaine-du-site>/annuler.html?id=<id-du-document>`.
2. La page `annuler.html` (nouvelle page statique du site) lit le paramètre
   `id`, charge le document `reservations/{id}` correspondant et affiche un
   récapitulatif (« Annuler la réservation de 4 places au nom de Jean
   Dupont ? ») avec un bouton de confirmation.
3. Si l'`id` n'existe pas ou que le statut est déjà `"cancelled"` : un message
   clair est affiché (« Cette réservation est introuvable ou a déjà été
   annulée. ») plutôt qu'une erreur technique brute.
4. Au clic sur le bouton de confirmation, une transaction Firestore passe le
   `status` du document à `"cancelled"`, renseigne `cancelledAt`, et
   décrémente `meta/gauge.reserved` du `totalPlaces` correspondant — atomique.
5. Une confirmation s'affiche sur la page. La jauge se met à jour en temps
   réel chez tous les visiteurs ayant le site ouvert. La Cloud Function
   `onReservationCancelled` se déclenche en arrière-plan et notifie le
   comité.

## Notifications email (Cloud Functions + Brevo)

Deux Cloud Functions Firebase, déclenchées automatiquement par les écritures
Firestore (donc fiables même si le visiteur ferme son onglet juste après son
action) :

- **`onReservationCreated`** (trigger `onDocumentCreated` sur
  `reservations/{id}`) :
  - envoie un email de confirmation au visiteur (adresse du champ `email` du
    document), avec le récapitulatif de sa réservation et son lien
    d'annulation personnel ;
  - envoie un email de notification au comité des fêtes, à
    **Oria.ei@outlook.fr**, listant la nouvelle réservation (nom, contact,
    quantités, montant estimé).
- **`onReservationCancelled`** (trigger `onDocumentUpdated`, déclenché
  uniquement lorsque `status` passe de `"active"` à `"cancelled"`) :
  - envoie un email au comité des fêtes, à **Oria.ei@outlook.fr**, signalant
    l'annulation (nom, nombre de places libérées) ;
  - aucun email n'est renvoyé au visiteur (il vient de confirmer l'annulation
    sur la page, il est donc déjà informé).

Implémentation technique :
- Les deux fonctions appellent l'API REST de Brevo (`api.brevo.com`) avec une
  clé API stockée en variable d'environnement Firebase (secret), jamais
  exposée côté client.
- Nécessite le plan Firebase **Blaze** (carte bancaire enregistrée) pour
  pouvoir déployer des Cloud Functions et effectuer des appels réseau
  sortants. Le coût restera nul à ce volume (quota gratuit de 2 millions
  d'invocations/mois côté Cloud Functions, et 300 emails/jour gratuits côté
  Brevo).

## Affichage de la jauge en temps réel

- Au chargement de la page, le JS du site s'abonne au document `meta/gauge`
  via `onSnapshot` du SDK Firebase JS.
- Chaque mise à jour du document pousse en direct la nouvelle valeur de
  `reserved` : la barre de progression et le texte (`reserved / 150`) sont mis
  à jour instantanément chez tous les visiteurs ayant la page ouverte, sans
  rechargement.
- Si `reserved >= 150` : le formulaire est masqué et le message « jauge
  atteinte » s'affiche, comme le comportement actuel à 150/150.

## Nettoyage du code existant

Pour ne garder qu'un seul système (toutes les données de réservation passent
par Firebase) :
- **Suppression** : l'attribut `data-netlify="true"` et le champ caché
  `form-name` du formulaire ; tout le code JS actuel basé sur `localStorage`
  (`getReservedCount`, `setReservedCount`, `STORAGE_KEY`) ; l'appel
  `fetch('/')` vers Netlify Forms.
- **Ajout** : le SDK Firebase JS (chargé via `<script type="module">`, avec
  la configuration publique du projet Firebase — cette configuration n'est
  pas secrète, la sécurité repose sur les règles Firestore) ; le nouveau code
  de transaction et d'écoute décrit ci-dessus ; la nouvelle page
  `annuler.html`.
- Le HTML du formulaire (champs, labels, sélecteurs de quantité +/-) reste
  identique — seule la logique de soumission change.

## Gestion des erreurs

- **Erreur réseau/Firestore lors d'une réservation** : message d'erreur
  affiché, bouton réactivé, aucune donnée locale perdue (les valeurs saisies
  restent dans le formulaire).
- **Jauge pleine au moment de la soumission** : détecté par la transaction
  Firestore elle-même (pas seulement par une vérification optimiste côté
  client avant l'envoi), donc fiable même en cas de réservations
  quasi-simultanées.
- **Lien d'annulation invalide ou déjà utilisé** : message clair sur la page
  `annuler.html`, pas d'erreur technique brute affichée au visiteur.

## Plan de test avant mise en ligne

- Réservation simple (1 à 10 places) : document créé, jauge incrémentée,
  emails reçus (visiteur + comité).
- Réservation qui amène exactement la jauge à 150 : acceptée.
- Tentative de réservation au-delà de 150 (jauge déjà pleine ou dépassement
  par la demande) : refusée, message « jauge atteinte » affiché.
- Tentative de réservation de plus de 10 places en une fois : refusée par les
  règles Firestore.
- Soumission avec le champ honeypot rempli (simulant un bot) : refusée.
- Annulation via un lien valide : statut mis à jour, jauge décrémentée, email
  de notification reçu par le comité.
- Annulation via un lien déjà utilisé ou un ID invalide : message clair,
  aucune modification de la jauge.
- Vérification visuelle que la jauge se met à jour en temps réel sur un
  second appareil/onglet pendant qu'une réservation est effectuée sur un
  premier.

## Hors périmètre / décisions déjà actées

- Adresse email de notification du comité : `Oria.ei@outlook.fr`.
- Hébergement : site déjà déployé sur Netlify ; Firebase et Brevo sont des
  services externes ajoutés en complément, aucun changement d'hébergeur
  nécessaire.
- Pas de protection par mot de passe ou de compte sur la page `annuler.html`
  : la sécurité repose uniquement sur le caractère secret/non devinable de
  l'ID de document transmis dans le lien.
