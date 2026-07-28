# Spec — Bloc « Nos prochaines séances » dans les emails d'avis

**Date :** 2026-07-28
**Statut :** design + maquette validés, prêt pour plan

## Objectif

Ajouter, en bas des emails de **demande d'avis** et de **relance**, un bloc
« ✦ Nos prochaines séances » qui présente les séances à venir (encore ouvertes à
la réservation) avec affiche, film, date, lieu et un bouton « Réserver ma place »
vers la page de la séance. But : faire revenir les spectateurs (public déjà
conquis). Le bloc **disparaît** s'il n'y a aucune séance à venir.

## Portée / timing

- Doit être **déployé aujourd'hui** pour être présent dans l'envoi automatique de
  demain 9h (avis du 28/07 → promotion du 18/08).
- Ne touche **que** les 2 builders d'avis + le passage des données depuis
  `sendFeedbackRequests`. Aucune autre logique modifiée.

## Modèle de données

Aucune nouvelle donnée. Les « séances à venir » sont dérivées de la collection
`events` déjà lue par `sendFeedbackRequests` : événements dont `dateISO` est dans
le futur ET `ouvertResa === true`, triés par date croissante. Champs utilisés par
carte : `filmTitre`, `dateLabel`, `lieu`, `afficheImg`, `slug`.

## Contenu / rendu (email-content.js)

- Nouveau helper `blocProchainesSeances(upcomingEvents)` → chaîne HTML (ou `""`
  si liste vide). Une carte par séance (affiche `SITE_URL + "/" + afficheImg`,
  titre, `&#128197; dateLabel`, `&#128205; lieu`, bouton « Réserver ma place »
  vers `SITE_URL + "/" + slug + ".html"`), à la charte email (encadré or, fond
  blanc), précédée du titre « ✦ Nos prochaines séances » et suivie de « Au plaisir
  de vous revoir sous les étoiles ! ». HTML en tableaux, styles en ligne.
- `buildFeedbackRequestEmail(reservation, reservationId, event, upcomingEvents)`
  et `buildFeedbackReminderEmail(reservation, reservationId, event, upcomingEvents)`
  reçoivent un 4ᵉ argument `upcomingEvents` (défaut `[]`) et **ajoutent** le bloc à
  la fin du corps, avant le pied. Les autres emails et le gabarit sont inchangés.
- Les champs proviennent des fiches `events` (contrôlées, pas d'entrée
  utilisateur) → pas d'échappement requis.

## Câblage (index.js — sendFeedbackRequests)

- Après avoir construit `eventMap`, calculer `upcomingEvents` = valeurs de
  `eventMap` où `dateISO.toMillis() > Date.now()` ET `ouvertResa === true`, triées
  par `dateISO` croissant, réduites aux champs `{ filmTitre, dateLabel, lieu,
  afficheImg, slug }`.
- Passer `upcomingEvents` en 4ᵉ argument à `buildFeedbackRequestEmail` /
  `buildFeedbackReminderEmail`.

## Tests (email-content.test.js)

- Demande d'avis avec `upcomingEvents` non vide ⇒ le HTML contient le titre du
  film, « Réserver ma place » et le lien `slug.html`.
- Demande d'avis avec `upcomingEvents` vide (ou absent) ⇒ **pas** de
  « prochaines séances » dans le HTML.
- Idem relance (contient toujours le lien d'avis + `stop=1` + le bloc quand
  fourni).

## Déploiement

`firebase deploy --only functions` **aujourd'hui**. Vérifier par les tests. Le
28/07 (avis) montrera le 18/08 (à venir, ouvert) ; le 18/08 est exclu de sa propre
liste (il est la séance en cours d'avis, pas « à venir »).

## Risques

- **Re-toucher le code qui part demain** : atténué par des tests dédiés + une
  relecture, et par le fait que le changement est purement additif (bloc optionnel,
  défaut vide).
- **Affiche non affichée** par certaines messageries : le texte + le bouton
  restent visibles ; dégradation acceptable.
