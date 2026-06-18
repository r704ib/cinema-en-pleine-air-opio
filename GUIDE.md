# 🎬 Guide du site — Cinéma en plein air d'Opio

Guide à l'usage du comité des fêtes pour comprendre et gérer le site de
réservation. Aucune compétence technique nécessaire.

---

## 📌 En une phrase

Les visiteurs réservent leurs places sur le site, le nombre de places
restantes se met à jour en direct pour tout le monde, ils reçoivent un email
de confirmation, et le comité reçoit un email à chaque réservation — le tout
enregistré dans une base de données sécurisée.

- **Adresse du site :** https://cinema-en-pleine-air-opio.netlify.app
- **Événement :** projection « Un p'tit truc en plus » — lundi 28 juillet 2026
- **Jauge :** 150 places maximum · max 10 places par réservation
- **Tarifs :** 5 € / adulte · 3 € / enfant 3-10 ans · gratuit moins de 3 ans
  (réglement **sur place**, aucun paiement en ligne)

---

## 🧩 Les outils utilisés et leur rôle

Imagine le projet comme un petit commerce — chaque service a un rôle :

| Service | À quoi il sert | Analogie |
|---|---|---|
| **GitHub** | Range le code du site et garde l'historique de chaque version. | Le **classeur** d'archives |
| **Netlify** | Affiche le site sur internet. | La **vitrine** du magasin |
| **Firebase** (Google) | Stocke les réservations et fait respecter les règles (max 150, etc.). | L'**arrière-boutique** + l'employé qui vérifie chaque commande |
| **Brevo** | Envoie les emails automatiques. | Le **facteur** |

**Firebase est en deux parties :**
- **Firestore** = la base de données (les « tableaux » des réservations et le compteur de places).
- **Cloud Functions** = de petits programmes qui enregistrent les réservations, vérifient qu'il reste de la place, et déclenchent les emails. Ce sont **eux seuls** qui écrivent dans la base — jamais le navigateur du visiteur — pour que personne ne puisse tricher sur le nombre de places.

---

## 🔄 Ce qui se passe quand quelqu'un réserve

1. Le visiteur remplit le formulaire sur le **site** et clique « Réserver ».
2. Un programme **Cloud Function** vérifie les infos et qu'il reste de la place.
3. Si tout est bon : la réservation est **enregistrée dans Firestore** et le compteur augmente.
4. La **jauge se met à jour en direct** sur l'écran de tous les visiteurs.
5. **Brevo** envoie 2 emails : un au visiteur (avec son lien d'annulation), un au comité.

L'**annulation** fonctionne pareil à l'envers : le visiteur clique le lien reçu
par email → sa place est libérée → le compteur baisse → le comité est notifié.

---

## 👀 Consulter la liste des personnes qui ont réservé

Tout est dans **Firebase**. Chemin exact :

1. Aller sur **https://console.firebase.google.com** et se connecter avec `oria.ei@outlook.fr`.
2. Ouvrir le projet **« Cinema-en-pleine-air-Opio »**.
3. Menu de gauche → **« Firestore Database »**.
4. Cliquer sur la collection **`reservations`**.
5. Chaque **document** = **une réservation**. Cliquer dessus pour voir :

| Champ | Signification |
|---|---|
| `prenom`, `nom` | Identité du réservant |
| `email`, `telephone` | Contact |
| `nb_adultes`, `nb_enfants_3_10`, `nb_enfants_moins_3` | Détail des places |
| `totalPlaces` | Nombre total de places |
| `montantEstime` | Montant à régler sur place (en €) |
| `status` | `active` (valide) ou `cancelled` (annulée) |
| `createdAt` | Date/heure de la réservation |
| `cancelledAt` | Date/heure d'annulation (si annulée) |

> 💡 Pas besoin d'ouvrir Firebase au quotidien : tu reçois **un email à chaque
> réservation**. Firebase sert à voir la **liste complète** d'un coup d'œil.

Il existe aussi une collection **`meta`** avec un document `gauge` = le
**compteur de places**. N'y touche pas, sauf pour le remettre à 0 (voir plus bas).

---

## ✅ À faire avant d'ouvrir les réservations au public

Pendant la mise en place, des réservations de **test** ont été créées. Avant le
lancement réel, repartir d'une jauge propre :

1. Firebase → Firestore → collection `reservations` → **supprimer les
   réservations de test** (icône poubelle sur chaque document de test).
2. Firebase → Firestore → collection `meta` → document `gauge` → mettre le champ
   `reserved` à **`0`**.

> Tu peux me demander de te guider pas à pas le moment venu.

---

## ✏️ Modifier le site plus tard

Tu n'as **rien de technique à gérer**. Pour tout changement (texte, date, image,
design…), il suffit de **me le demander** : je modifie, et le site se met à jour
tout seul en ligne (déploiement automatique). Une **note de version** est créée
à chaque fois dans le dossier `releases/` pour garder une trace.

---

## 🔗 Liens et comptes utiles

| Quoi | Lien | Compte |
|---|---|---|
| Le site en ligne | https://cinema-en-pleine-air-opio.netlify.app | — (public) |
| Base de données (réservations) | https://console.firebase.google.com | `oria.ei@outlook.fr` |
| Emails (Brevo) | https://app.brevo.com | `oria.ei@outlook.fr` |
| Hébergement (Netlify) | https://app.netlify.com | `oria.ei@outlook.fr` |
| Code du site (GitHub) | https://github.com/r704ib/cinema-en-pleine-air-opio | `r704ib` |

*Notes de version : dossier [`releases/`](releases/).*
