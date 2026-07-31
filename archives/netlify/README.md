# Archive — Netlify (retiré)

Ce dossier conserve, pour mémoire, ce qui concernait **Netlify**. Netlify
**n'est plus utilisé** : le site est entièrement hébergé sur **Firebase Hosting**,
au domaine `cinema-en-pleine-air-opio.oria-events.fr`.

## Historique
- **Au départ** : le site était hébergé sur **Netlify** (auto-déploiement depuis
  GitHub), à l'adresse `cinema-en-pleine-air-opio.netlify.app`.
- **Migration** : le site a été déplacé vers **Firebase Hosting** + le domaine
  `oria-events.fr` (voir `releases/v9.md`). Netlify a alors été **conservé
  uniquement** pour **rediriger** les anciens liens `.netlify.app` vers la
  nouvelle adresse (redirection 301).
- **Retrait** : Netlify n'étant plus nécessaire (tout — emails, QR, réservations
  — utilise le domaine `oria-events.fr`), le site Netlify a été **supprimé** et
  la config retirée du dépôt.

## Contenu de ce dossier
- `netlify.toml` — l'ancienne configuration Netlify (dossier publié + redirection
  301 vers le domaine Firebase). **Archivée**, plus utilisée.

## Conséquence
- L'ancien lien `cinema-en-pleine-air-opio.netlify.app` ne fonctionne plus (plus
  de redirection). Ce n'est pas gênant : plus rien ne pointe vers cet ancien lien.

## Si un jour tu voulais revenir sur Netlify
Il suffirait de recréer un site Netlify relié au dépôt GitHub et de remettre le
`netlify.toml` de ce dossier à la racine du projet.
