# Spec — Demandes d'avis automatiques pilotées par les événements

**Date :** 2026-07-28
**Statut :** design validé, prêt pour plan

## Contexte et objectif

Aujourd'hui, les demandes d'avis automatiques s'activent **manuellement** par
séance : on écrit un document `meta/session` (`sessionDate`, `eventId`,
`feedbackEnabled`) puis la fonction programmée de 9h l'utilise. On veut rendre ça
**automatique** : piloté par la collection `events`. Créer la fiche d'une séance
suffit — le lendemain de la séance, les demandes d'avis partent toutes seules,
aux réservants de cette séance.

## Comportement voulu

Chaque matin à 9h (Europe/Paris), la fonction programmée parcourt les `events` et,
pour **chaque séance éligible**, envoie les demandes d'avis à **ses** réservants,
avec les garde-fous existants inchangés.

Une séance est **éligible** si les trois conditions sont réunies :
1. **Activée** : le champ `feedbackEnabled` de la fiche `events` n'est pas `false`
   (absent ou `true` = activé — c'est l'« interrupteur » par séance).
2. **Passée** : on est le lendemain (jour calendaire) de sa date ou plus
   (`jour(maintenant) > jour(dateISO)`).
3. **Récente** : sa date est dans la **fenêtre de 14 jours** précédant aujourd'hui
   (`jour(dateISO) >= jour(maintenant) − 14`). Passé 14 jours, la séance est
   « close » pour les avis (évite de rescanner d'anciennes séances et d'envoyer un
   avis très tardif à une réservation ajoutée après coup).

## Périmètre

**Dans le périmètre :**
- Champ optionnel `feedbackEnabled` sur les fiches `events` (défaut : activé).
- Refonte de la sélection des destinataires (`feedback-logic.js`) pour être
  **multi-événements** et intégrer les 3 conditions ci-dessus + fenêtre.
- Refonte de `sendFeedbackRequests` (`index.js`) : piloté par `events`, plus par
  `meta/session`.
- Emails toujours event-aware (date/film de la bonne séance).

**Hors périmètre :**
- Le recueil d'avis (`submitFeedback`, page `avis.html`) — inchangé.
- La modération/publication (`admin.html`, `avis_publics`) — inchangée.
- `meta/session` n'est plus utilisé (laissé en base, ignoré — peut être supprimé
  plus tard).

## Modèle de données

- `events/{id}` : ajout optionnel de **`feedbackEnabled`** (booléen). Absent ⇒
  traité comme activé. `false` ⇒ séance exclue des demandes d'avis.
- `reservations` : inchangé (portent déjà `eventId`, et les drapeaux
  `avisRequestSent` / `avisRequestSentAt` / `avisRelanceSent` / `avisOptOut`).

## Logique pure — `functions/feedback-logic.js`

`selectFeedbackRecipients(params)` est refactorée pour prendre **plusieurs
événements** au lieu d'un seul `sessionDate`/`eventId` :

- **Entrées :** `reservations` (chacune avec `id`, `eventId`, `status`, `email`,
  `prenom`, `avisOptOut`, `avisRequestSent`, `avisRelanceSent`,
  `avisRequestSentAt`), `events` (liste de `{ id, sessionDate, feedbackEnabled }`),
  `avisReservationIds` (Set), `now`, `maxPerDay` (défaut 50),
  `reminderDelayDays` (défaut 3), `windowDays` (défaut 14).
- **Éligibilité des événements** : construire l'ensemble des `eventId` éligibles
  selon les 3 conditions (activé, passé au jour calendaire, dans la fenêtre de
  `windowDays`).
- **Sélection** : pour chaque réservation dont l'`eventId` est éligible et qui
  passe les règles existantes (`status === "active"`, pas `avisOptOut`, pas dans
  `avisReservationIds`) :
  - si `avisRequestSent !== true` → candidat **request** ;
  - sinon si `avisRelanceSent !== true` et `now − avisRequestSentAt >= 3 jours` →
    candidat **reminder**.
- **Plafond global** : d'abord tous les **requests** (toutes séances confondues),
  puis les **reminders**, le tout tronqué à `maxPerDay` (50). Les requests sont
  donc prioritaires sur les relances quand le quota est atteint.
- **Sortie** : liste de `{ reservationId, type, email, prenom, eventId }` (ajout de
  `eventId` pour que l'appelant retrouve la date/film de la séance pour l'email).

## Fonction programmée — `functions/index.js` (`sendFeedbackRequests`)

- Ne lit plus `meta/session`. Lit :
  - la collection `events` → construit la liste `{ id, sessionDate: dateISO,
    feedbackEnabled }` et une **table `eventId → fiche`** (pour les emails) ;
  - toutes les `reservations` (avec `eventId`) et tous les `avis` (comme
    aujourd'hui).
- Appelle `selectFeedbackRecipients({ reservations, events, avisReservationIds,
  now: new Date() })`.
- Pour chaque destinataire : envoie `buildFeedbackRequestEmail` ou
  `buildFeedbackReminderEmail` avec la fiche event correspondante
  (`eventMap[rec.eventId]`), puis marque les drapeaux
  `avisRequestSent`/`avisRequestSentAt` ou `avisRelanceSent`/`avisRelanceSentAt`
  **après** un envoi réussi (comme aujourd'hui). Échec isolé, journalisé.

## Sécurisation de la séance du 28/07 (envoi de demain)

La fiche `events/opio-2026-07-28` a `dateISO` = 28/07/2026 et **pas** de champ
`feedbackEnabled` ⇒ éligible par défaut. Demain 29/07 à 9h : jour(29/07) >
jour(28/07) et dans la fenêtre 14 j ⇒ la séance est retenue et les demandes
partent à ses réservants (filtrées par `eventId`). Comportement **identique** à
l'activation manuelle actuelle. Garanti par les tests ci-dessous.

## Tests (`functions/test/feedback-logic.test.js`)

Adapter les tests existants à la nouvelle signature (passer `events` au lieu de
`sessionDate`/`eventId`), et ajouter :
- **28/07 déclenche à J+1** : un event 28/07 + une réservation active de ce
  événement, `now` = 29/07 9h ⇒ 1 request.
- **18/08 exclu avant sa date** : un event 18/08 (futur) + réservation ⇒ rien
  (pas encore passé).
- **Interrupteur** : event avec `feedbackEnabled: false` ⇒ ses réservants exclus.
- **Fenêtre** : event passé de plus de 14 jours ⇒ exclu.
- **Plafond global 50** : > 50 candidats répartis sur 2 events ⇒ exactement 50,
  requests prioritaires.
- **Multi-événements** : 2 events éligibles ⇒ chaque réservation reçoit selon sa
  propre séance (bon `eventId` dans la sortie).

## Déploiement / séquencement

1. Construire + tester (TDD) sur une branche.
2. `firebase deploy --only functions` **aujourd'hui**, bien avant demain 9h.
3. Vérifier par les tests que le 28/07 reste couvert. `meta/session` peut rester
   (ignoré) ; on pourra le supprimer plus tard.
4. Note de version + mise à jour du GUIDE (« les avis partent automatiquement le
   lendemain de chaque séance ; interrupteur `feedbackEnabled` par séance »).

## Risques

- **Régression sur l'envoi du 28/07** : couverte par un test dédié + déploiement
  anticipé (≥ 12 h avant l'envoi).
- **Double envoi** : impossible — les drapeaux par réservation
  (`avisRequestSent`/`avisRelanceSent`) sont conservés et vérifiés.
- **Fuseau horaire** : la comparaison jour-calendaire utilise le fuseau du process
  (UTC sur Cloud Functions). OK pour des séances en soirée (28/07 20h30 Paris =
  18h30 UTC ⇒ jour = 28/07 ; envoi 29/07 9h Paris = 7h UTC ⇒ jour = 29/07 >
  28/07). Comportement déjà validé sur la version mono-séance.
