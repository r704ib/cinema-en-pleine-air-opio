# Jauge de réservation partagée via Firebase

Date : 2026-06-17 (révisé le 2026-06-18 : écritures déplacées côté serveur, voir note ci-dessous)
Statut : approuvé, en attente du plan d'implémentation

> **Révision du 2026-06-18** : la revue de la Tâche 3 a démontré que des
> règles Firestore basées sur la confiance du client (le client écrit
> directement `reservations` et `meta/gauge`, les règles bornent juste
> chaque écriture individuellement) ne peuvent pas garantir le plafond de
> 150 places : un client malveillant peut écrire dans l'une des deux
> collections sans toucher à l'autre, désynchronisant la jauge affichée du
> nombre réel de réservations actives. La création et l'annulation de
> réservation passent donc désormais par des **Cloud Functions "callable"**
> (code serveur de confiance, jamais exécuté ni modifiable côté client) qui
> sont les seules autorisées à écrire dans `reservations` et `meta/gauge`.
> Les règles Firestore client deviennent : lecture publique, écriture
> refusée (`allow create, update, delete: if false`). Le reste de la
> conception (modèle de données, emails, jauge en temps réel) est inchangé.

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
   ├─► Cloud Function callable "createReservation" ─┐
   ├─► Cloud Function callable "cancelReservation"  ─┤
   │                                                  ▼
   │                                  Transaction Firestore (Admin SDK,
   │                                  immune aux règles client) :
   │                                  écrit "reservations/{id}" et
   │                                  incrémente/décrémente "meta/gauge"
   │
   └─► (lecture seule) onSnapshot sur "meta/gauge" → jauge mise à jour en direct

Firestore (trigger automatique, indépendant du navigateur)
   │
   └─► Cloud Functions "onReservationCreated" / "onReservationCancelled"
          └─► API Brevo → email de confirmation au visiteur
                          → email de notification au comité des fêtes

Lien d'annulation (envoyé par email au visiteur)
   │
   └─► Page "annuler.html?id=<id-du-document>"
          └─► Appelle la Cloud Function "cancelReservation"
```

Le client ne lit Firestore que pour la jauge (`meta/gauge`, lecture seule —
les règles refusent toute écriture client). Toute écriture (création ou
annulation d'une réservation) passe par une Cloud Function callable, qui
s'exécute côté serveur avec les privilèges Admin SDK : c'est le seul endroit
où le plafond de 150 places et la limite de 10 places/réservation sont
réellement garantis, puisque ce code n'est jamais sous le contrôle du
visiteur. L'envoi d'email reste géré par des Cloud Functions déclenchées par
les écritures Firestore, comme avant — ces écritures passant maintenant par
l'Admin SDK plutôt que par le client, elles déclenchent les triggers Firestore
exactement de la même façon.

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

Toute la validation (formats, plafond de 150, maximum 10 places/réservation,
honeypot) est désormais faite côté serveur dans les Cloud Functions callable
(voir plus bas), pas dans les règles. Les règles se contentent de fermer
l'accès en écriture direct :

- **`reservations/{id}`** : `allow get: if true;` (un client peut lire un
  document s'il en connaît déjà l'ID — utile pour la page d'annulation) ;
  `allow list: if false;` (impossible de lister les réservations des autres
  visiteurs) ; `allow create, update, delete: if false;` (toute écriture
  passe par l'Admin SDK depuis une Cloud Function, qui ignore les règles
  Firestore par conception — un client ne peut donc jamais écrire ce
  document directement).
- **`meta/gauge`** : `allow get: if true;` (lecture publique pour la jauge
  en temps réel) ; `allow write: if false;` (même raisonnement : seule une
  Cloud Function, via l'Admin SDK, peut le modifier).

## Flux de réservation

1. Le visiteur remplit le formulaire existant (prénom, nom, email, téléphone,
   quantités via les boutons +/-).
2. Au clic sur « Réserver ma place », le JS du site appelle la Cloud Function
   callable **`createReservation`** avec les données du formulaire (y compris
   le champ honeypot).
3. Côté serveur, la fonction :
   - valide les champs (formats, `totalPlaces` entre 1 et 10, honeypot vide) ;
   - lit `meta/gauge.reserved` et vérifie que `reserved + totalPlaces ≤ 150` ;
   - si tout est valide : crée le document `reservations` (`status: "active"`)
     et incrémente `meta/gauge.reserved` du même montant, en une seule
     transaction Firestore (Admin SDK).
4. Si l'appel réussit : le formulaire est remplacé par le message de
   confirmation existant. L'écriture déclenche en parallèle la Cloud Function
   `onReservationCreated` (trigger Firestore), qui envoie les emails (voir
   plus bas).
5. Si la fonction renvoie une erreur "jauge pleine" (quelqu'un d'autre a
   réservé les dernières places entre-temps, ou la demande dépasse la place
   restante) : le formulaire est remplacé par le message « jauge atteinte »
   déjà existant sur le site.
6. En cas d'erreur réseau ou d'échec de l'appel (pas de connexion, etc.) : un
   message d'erreur clair est affiché (« Impossible d'envoyer votre
   réservation, réessayez. ») et le bouton de soumission est réactivé pour
   permettre une nouvelle tentative.

## Flux d'annulation

1. Le visiteur reçoit par email (voir plus bas) un lien personnel de la forme
   `https://<domaine-du-site>/annuler.html?id=<id-du-document>`.
2. La page `annuler.html` (nouvelle page statique du site) lit le paramètre
   `id`, charge le document `reservations/{id}` correspondant (lecture seule,
   autorisée par les règles) et affiche un récapitulatif (« Annuler la
   réservation de 4 places au nom de Jean Dupont ? ») avec un bouton de
   confirmation.
3. Si l'`id` n'existe pas ou que le statut est déjà `"cancelled"` : un message
   clair est affiché (« Cette réservation est introuvable ou a déjà été
   annulée. ») plutôt qu'une erreur technique brute.
4. Au clic sur le bouton de confirmation, le JS appelle la Cloud Function
   callable **`cancelReservation`** avec l'`id`. Côté serveur, la fonction
   vérifie que la réservation existe et est `"active"`, puis passe son
   `status` à `"cancelled"`, renseigne `cancelledAt`, et décrémente
   `meta/gauge.reserved` du `totalPlaces` correspondant — toujours en une
   seule transaction Firestore (Admin SDK).
5. Une confirmation s'affiche sur la page. La jauge se met à jour en temps
   réel chez tous les visiteurs ayant le site ouvert. L'écriture déclenche la
   Cloud Function `onReservationCancelled` (trigger Firestore), qui notifie
   le comité.

## Cloud Functions

Quatre Cloud Functions au total :
- **`createReservation`** et **`cancelReservation`** (callable, voir
  ci-dessus) : seules autorisées à écrire `reservations` et `meta/gauge`.
- **`onReservationCreated`** et **`onReservationCancelled`** (triggers
  Firestore, inchangées) : envoient les emails, décrites ci-dessous.

### Notifications email (Brevo)

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
  Firestore exécutée côté serveur dans `createReservation` (pas seulement
  par une vérification optimiste côté client avant l'appel), donc fiable
  même en cas de réservations quasi-simultanées.
- **Lien d'annulation invalide ou déjà utilisé** : message clair sur la page
  `annuler.html`, pas d'erreur technique brute affichée au visiteur.

## Plan de test avant mise en ligne

- Réservation simple (1 à 10 places) : document créé, jauge incrémentée,
  emails reçus (visiteur + comité).
- Réservation qui amène exactement la jauge à 150 : acceptée.
- Tentative de réservation au-delà de 150 (jauge déjà pleine ou dépassement
  par la demande) : refusée, message « jauge atteinte » affiché.
- Tentative de réservation de plus de 10 places en une fois : refusée par la
  validation côté serveur dans `createReservation`.
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
