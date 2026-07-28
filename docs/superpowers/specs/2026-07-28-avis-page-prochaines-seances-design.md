# Spec — Bloc « prochaines séances » sur la page d'avis (après envoi)

**Date :** 2026-07-28
**Statut :** design validé

## Objectif

Sur `public/avis.html`, après qu'une personne a envoyé son avis (écran « Merci
pour votre retour ») **et** sur l'écran « vous avez déjà donné votre avis »,
afficher un bloc **« ✦ Nos prochaines séances »** invitant à réserver la ou les
séances à venir. Public à fort engagement → bon moment pour le faire revenir.

## Portée

- Un seul fichier : `public/avis.html`. Aucun changement backend.
- Aucune nouvelle donnée : lecture de la collection `events` (déjà publique en
  lecture), séances où `dateISO > maintenant` ET `ouvertResa === true`, triées par
  date croissante.

## Comportement

- Ajout d'un conteneur `#prochaines-seances` (masqué par défaut), affiché
  **seulement** quand l'écran actif est `success-state` ou `already-state`.
- La fonction `show(id)` : si `id ∈ {success-state, already-state}` → appelle
  `renderProchaines()` (qui charge une fois et révèle le bloc) ; sinon masque le
  bloc.
- `renderProchaines()` : `getDocs(collection(db, 'events'))`, filtre + tri, rend
  une carte par séance (thème sombre du site) : affiche (`/<afficheImg>`), film,
  date, lieu, bouton **« Réserver dès maintenant »** → `/<slug>.html`. Charge une
  seule fois (garde). Si aucune séance à venir → le bloc reste masqué.

## Rendu (thème sombre, raccord avec la page)

Cartes sur `--c-surface` avec bordure or `--c-gold`, titre « ✦ Nos prochaines
séances » en police display, bouton doré arrondi. Échappement du texte injecté
(bien que les champs viennent des fiches `events`, contrôlées).

## Tests / vérification

Pas de test unitaire (page statique). Vérification : ouvrir la page localement
(le bloc reste masqué sans données), et après déploiement, contrôler sur la
préversion/prod qu'après un envoi d'avis le bloc apparaît avec le 18/08.

## Déploiement

`firebase deploy --only hosting` (page publique). Idéalement avant que les gens
commencent à envoyer leurs avis demain.
