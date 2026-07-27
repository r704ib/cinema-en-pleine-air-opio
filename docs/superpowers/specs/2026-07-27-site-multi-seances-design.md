# Spec — Site multi-séances (Programme + réservations par événement)

**Date :** 2026-07-27
**Statut :** design validé, prêt pour relecture puis plan d'implémentation

## Contexte et objectif

Le site est aujourd'hui une **page unique** câblée pour la séance du 28 juillet
2026 : la jauge (`meta/gauge`), les réservations et les emails supposent tous un
seul événement. Une **deuxième séance** arrive (mardi 18 août 2026, « Jumanji :
Bienvenue dans la jungle »), et d'autres suivront.

On fait évoluer le site vers un modèle **multi-séances** (approche « pages
statiques par séance + backend par événement ») :

- une page d'accueil **« Programme »** listant les séances à venir et passées ;
- **une page par séance** (design actuel préservé), avec sa propre jauge, son
  formulaire et ses emails à la bonne date ;
- un **menu de navigation** partagé.

La séance du 28/07 est **complète (sold out)** : aucune nouvelle réservation
attendue. On peut donc faire évoluer le backend maintenant. Des **annulations**
de dernière minute restent possibles → le flux d'annulation du 28/07 doit rester
fonctionnel pendant et après la migration.

## Approche retenue

**Approche A** — pages HTML statiques par séance (clonées du template actuel,
contenu propre), backend rendu multi-événements. Choisie pour préserver la
qualité artisanale du design tout en séparant proprement les réservations. (Rejet
de l'approche 100 % dynamique : réusinage lourd de la page animée, risque sur le
design ; rejet de la config centralisée : templating superflu pour quelques
séances/an.)

## Modèle de données

### Nouvelle collection Firestore `events`

Une fiche par séance, id = `eventId` (format `opio-AAAA-MM-JJ`) :

| Champ | Type | Exemple |
|---|---|---|
| `filmTitre` | string | « Jumanji : Bienvenue dans la jungle » |
| `filmAuteur` | string | « de Jake Kasdan » |
| `dateLabel` | string | « Mardi 18 août 2026 » |
| `dateISO` | timestamp | 2026-08-18T18:30:00Z (pour tri + passé/à-venir + compte à rebours) |
| `lieu` | string | « Cœur du village à Opio 06650 » |
| `portes` / `filmHeure` / `finHeure` | string | « 20h30 » / « 21h30 » / « ~23h15 » |
| `gaugeMax` | number | 150 |
| `maxParResa` | number | 10 |
| `reserved` | number | compteur live (remplace `meta/gauge`) |
| `afficheImg` | string | « affiche-jumanji.jpg » |
| `slug` | string | « seance-2026-08-18 » (base du nom de fichier de page) |
| `ouvertResa` | boolean | true = réservations ouvertes (permet de fermer indépendamment de la date) |

Statut « à venir / passée » **dérivé** de `dateISO` (< maintenant = passée).

### Réservations

Chaque document `reservations` reçoit un champ **`eventId`** (string). Tous les
autres champs restent identiques.

### Suppression de `meta/gauge`

Le compteur unique `meta/gauge` est remplacé par le champ `reserved` de chaque
fiche `events`. `meta/gauge` sera conservé en lecture le temps de la migration
puis n'est plus utilisé (peut être laissé tel quel, ignoré).

## Migration (script ponctuel, exécuté au déploiement)

Ordre strict :

1. Créer la fiche `events/opio-2026-07-28` (film « Un p'tit truc en plus »,
   `dateLabel` « Mardi 28 juillet 2026 », `gaugeMax` 150, `maxParResa` 10,
   `afficheImg` « affiche.jpg », `ouvertResa` false, `reserved` = valeur actuelle
   de `meta/gauge.reserved`).
2. Créer la fiche `events/opio-2026-08-18` (Jumanji, mêmes horaires/jauge/tarifs,
   `afficheImg` « affiche-jumanji.jpg », `ouvertResa` true, `reserved` 0).
3. Backfill : ajouter `eventId: "opio-2026-07-28"` à **toutes** les réservations
   existantes (batch).

Le script est idempotent autant que possible (ne pas doubler `reserved` si relancé
— vérifier l'existence avant création).

## Backend (Cloud Functions)

Constante `DEFAULT_EVENT_ID = "opio-2026-07-28"` pour la robustesse.

- **`createReservation(data)`** : `data` inclut désormais `eventId`. Transaction
  sur `events/{eventId}` : la fiche doit exister, `ouvertResa === true`, et
  `reserved + totalPlaces <= gaugeMax` (sinon `resource-exhausted` "FULL"). Écrit
  la réservation avec `eventId`, incrémente `events/{eventId}.reserved`. Si
  `eventId` absent/inconnu → `invalid-argument`.
- **`cancelReservation(data)`** : lit la réservation, récupère son `eventId` (à
  défaut `DEFAULT_EVENT_ID`), décrémente `events/{eventId}.reserved`.
- **Emails event-aware** : les builders de `email-content.js`
  (`buildVisitorConfirmationEmail`, `buildVisitorCancellationEmail`,
  `buildFeedbackRequestEmail`, `buildFeedbackReminderEmail`) reçoivent un objet
  `event` (ou ses champs) et utilisent `event.dateLabel`, `event.filmTitre`,
  `event.lieu`, `event.portes`/`filmHeure`/`finHeure` à la place des chaînes en
  dur « mardi 28 juillet 2026 » / « Un p'tit truc en plus ». Le gabarit
  `email-layout.js` est inchangé.
- **`onReservationCreated` / `onReservationCancelled`** : chargent la fiche
  `events/{eventId}` de la réservation et la passent aux builders.
- **`reservation-logic.js`** : `MAX_PLACES` (150) et `maxParResa` ne sont plus des
  constantes globales mais viennent de la fiche event ; la validation d'entrée
  accepte et exige `eventId`.

## Frontend

### Page d'accueil « Programme » (`index.html`, réécrite)

- Menu de navigation partagé (voir plus bas) + hero « Cinéma en plein air · Opio ».
- Section **« À venir »** : lit `events` avec `dateISO ≥ aujourd'hui`, triés par
  date. Une **carte** par séance : affiche, titre du film, date, lieu. Le bouton
  dépend de l'état : **« Réserver »** (→ page séance) si `ouvertResa === true` ET
  `reserved < gaugeMax` ; sinon un état **« Complet »** / **« Réservations
  fermées »** (la carte reste visible, elle ne disparaît pas). Cas 28/07 :
  complet, affiché « Complet », toujours cliquable vers sa page.
- Section **« Séances passées »** : `events` avec `dateISO < aujourd'hui`, cartes
  sans bouton de réservation (mention « Séance passée », lien vers la page
  consultable).
- Lecture Firestore côté client (collection `events` en lecture seule).

### Pages par séance

- `public/seance-2026-08-18.html` (Jumanji) et `public/seance-2026-07-28.html`
  (le contenu actuel de `index.html`, déplacé). Clones du template animé actuel,
  contenu propre à la séance.
- Chaque page **embarque son `eventId`** (constante JS en tête de page).
- La **jauge live** et le **compte à rebours** lisent `events/{eventId}` (au lieu
  de `meta/gauge`). Le formulaire appelle `createReservation` avec `eventId`.
- `annuler.html` et `avis.html` restent (annulation/avis identifiés par
  `reservationId` ; l'email d'annulation est event-aware via la fonction).

### Menu de navigation partagé

Présent sur toutes les pages, cohérent :

- **Logo / marque** « Cinéma Plein Air · Opio » → page d'accueil (Programme).
- Lien **« Programme »** → `/`.
- Sur une page séance : bouton **« Réserver »** → ancre `#reservation`.

Structure HTML identique sur chaque page (bloc `<nav>` copié), styles dans la
charte existante (`.site-nav.glass`).

## Règles de sécurité Firestore

- `events/{eventId}` : `allow get, list: if true;` (lecture publique pour rendre
  le programme et la jauge) ; `create, update, delete: if false;` (écrit
  uniquement par les fonctions).
- `reservations`, `avis`, `meta/*` : règles existantes inchangées.

## Contenu de la séance du 18 août (fourni)

- **Film :** Jumanji : Bienvenue dans la jungle (réalisé par Jake Kasdan).
- **Horaires :** identiques (portes 20h30 · film 21h30 · fin ~23h15).
- **Jauge :** 150 · max 10 par réservation.
- **Tarifs :** 5 € adulte · 3 € enfant 3-10 ans · gratuit < 3 ans (règlement sur
  place).
- **Affiche :** fichier `public/affiche-jumanji.jpg` — **à fournir** (affiche
  officielle du film, fournie par l'exploitant ou téléchargée avec son accord
  explicite). Le reste peut être construit sans elle (placeholder neutre en
  attendant).

## Tests

- **`reservation-logic.js`** : validation exige `eventId` (string non vide) ;
  jauge/max viennent de paramètres event ; cas limites (event fermé, jauge
  dépassée). Mise à jour des tests existants qui supposaient `MAX_PLACES` global.
- **`email-content.js`** : les builders produisent la bonne `dateLabel`/`filmTitre`
  fournis en paramètre (plus de « 28 juillet » en dur). Les tests existants sont
  adaptés pour passer un objet `event` d'exemple.
- **Backend transactionnel** : non testé unitairement (déjà le cas), vérifié en
  intégration.
- **Migration** : script vérifié sur les données réelles (fiche 28/07 avec le bon
  `reserved`, toutes les résas avec `eventId`).

## Déploiement et séquencement

1. Construire + tester sur une **branche dédiée** `feature/multi-seances`.
2. Déployer functions + règles + hosting **ensemble**, puis lancer le **script de
   migration** immédiatement après (fenêtre de transition de quelques secondes ;
   `cancelReservation` tolère l'absence d'`eventId` via `DEFAULT_EVENT_ID`).
3. Vérifier : programme affiche les 2 séances, jauge 28/07 correcte, réservation
   de test sur le 18/08 (puis nettoyée), annulation 28/07 fonctionnelle.
4. Note de version `releases/v14.md` + mise à jour `GUIDE.md` (nouvelle structure,
   comment j'ajoute une future séance).

## Hors périmètre

- Interface d'administration pour que l'exploitant crée lui-même des séances
  (j'ajoute les fiches via script/console pour l'instant).
- Sous-domaines d'autres communes (déjà couvert par la stratégie oria-events.fr,
  pas d'impact ici).
- Modification du système d'avis (reste inerte, juste rendu event-aware pour la
  date dans l'email).

## Risques

- **Transition de migration** : bref instant où les nouvelles fonctions tournent
  avant/pendant le backfill. Atténué par `DEFAULT_EVENT_ID` et le fait que le
  28/07 est complet (pas de création de résa attendue). Idéalement migration juste
  après le déploiement.
- **Perte de la jauge 28/07** : le script doit lire `meta/gauge.reserved` AVANT de
  créer la fiche et ne jamais le doubler (vérif d'existence).
- **Affiche sous droits** : usage standard pour annoncer une projection, mais
  fichier fourni/validé par l'exploitant.
