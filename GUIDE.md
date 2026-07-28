# 🎬 Guide du site — Cinéma en plein air d'Opio

Guide à l'usage du comité des fêtes pour comprendre et gérer le site de
réservation. **Aucune compétence technique nécessaire** — tout est expliqué avec
des mots simples.

---

## 📌 En une phrase

Le site est désormais **multi-séances** : une page d'accueil « Programme »
liste les séances à venir et passées, et **chaque séance a sa propre page**
avec sa jauge, son formulaire et ses emails à la bonne date. Les visiteurs
réservent leurs places sur la page de la séance choisie, le nombre de places
restantes se met à jour **en direct** pour tout le monde, ils reçoivent un
email de confirmation, et **toi (Oria)** reçois un email à chaque réservation
— le tout enregistré dans une base de données sécurisée.

- **Adresse du site :** https://cinema-en-pleine-air-opio.oria-events.fr
- **Séances :** « Un p'tit truc en plus » — **mardi 28 juillet 2026** ·
  « Jumanji : Bienvenue dans la jungle » — **mardi 18 août 2026**
- **Horaires :** portes à **20h30** · film à **21h30** · fin ~**23h15**
- **Jauge :** 150 places maximum par séance · max 10 places par réservation
- **Tarifs :** 5 € / adulte · 3 € / enfant 3-10 ans · gratuit moins de 3 ans
  (règlement **sur place**, aucun paiement en ligne)

---

## 🧩 Les outils utilisés et leur rôle

Imagine le projet comme un petit commerce — chaque service a un rôle précis :

| Service | À quoi il sert | Analogie |
|---|---|---|
| **GitHub** | Range le code du site et garde l'historique de chaque version. | Le **classeur d'archives** |
| **Firebase Hosting** (Google) | Affiche le site sur internet. | La **vitrine** du magasin |
| **Firebase** (Firestore + Functions) | Stocke les réservations et fait respecter les règles (max 150 places, etc.). | L'**arrière-boutique** + l'employé qui vérifie chaque commande |
| **OVH** | Détient ton nom de domaine `oria-events.fr` et le relie à Firebase. | Le **panneau d'adresse** devant le magasin |
| **Brevo** | Envoie les emails automatiques (confirmation, notification). | Le **facteur** |
| **Google Analytics** | Compte le nombre de visiteurs du site. | Le **compteur de passages** à l'entrée |
| **Netlify** | Ancienne adresse du site (`.netlify.app`), gardée uniquement pour rediriger automatiquement vers la nouvelle adresse. | Le **panneau « a déménagé »** sur l'ancienne vitrine |

**Firebase est en deux parties :**

- **Firestore** = la base de données. Ce sont les « tableaux » qui contiennent
  les réservations et le compteur de places.
- **Cloud Functions** = de petits programmes automatiques qui enregistrent les
  réservations, vérifient qu'il reste de la place, et déclenchent les emails.
  Ce sont **eux seuls** qui écrivent dans la base — **jamais** le navigateur du
  visiteur — pour que personne ne puisse tricher sur le nombre de places.

---

## 🔄 Ce qui se passe quand quelqu'un réserve

```
   Visiteur             Firebase Hosting       Firebase                Brevo
  (téléphone)             (le site)      (Functions + base)        (emails)
      │                      │                  │                     │
      │  1. remplit le       │                  │                     │
      │     formulaire  ───► │                  │                     │
      │                      │  2. envoie la    │                     │
      │                      │     demande ───► │                     │
      │                      │                  │ 3. vérifie qu'il    │
      │                      │                  │    reste de la place│
      │                      │                  │ 4. enregistre +     │
      │                      │                  │    compteur +1      │
      │  5. jauge mise à     │ ◄── en direct ── │                     │
      │     jour à l'écran   │                  │ 6. déclenche ─────► │
      │                      │                  │                     │ 7. envoie
      │ ◄────────────────────┼──────────────────┼─────────────────── │  2 emails :
      │   email confirmation │                  │                     │  visiteur
      │                      │                  │  email à Oria ◄──────┤  + Oria
```

1. Le visiteur remplit le formulaire sur le **site** et clique « Réserver ».
2. Un programme **Cloud Function** reçoit la demande.
3. Il **vérifie** les infos et qu'il reste assez de places.
4. Si tout est bon : la réservation est **enregistrée dans Firestore** et le
   compteur de places augmente.
5. La **jauge se met à jour en direct** sur l'écran de tous les visiteurs
   (personne n'a besoin de recharger la page).
6. et 7. **Brevo** envoie 2 emails : un au **visiteur** (avec son lien
   d'annulation personnel), un à **toi (Oria)**.

L'**annulation** fonctionne pareil, à l'envers : le visiteur clique le lien reçu
par email → sa place est libérée → le compteur baisse → **tu es notifié(e)**.

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
| `eventId` | Séance concernée (ex. `opio-2026-08-18`) |
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

Le **compteur de places** de chaque séance est désormais le champ `reserved`
directement dans le document de la séance concernée, collection **`events`**
(chemin `events/<id-de-la-séance>`, ex. `events/opio-2026-08-18`) — **une
jauge par séance**. N'y touche pas, sauf pour le remettre à 0 (voir plus bas).

---

## 📊 Voir le nombre de visiteurs du site

Le site compte les visiteurs grâce à **Google Analytics** (dans Firebase).

1. Console Firebase → projet **Cinema-en-pleine-air-Opio**.
2. Menu de gauche → **« Analytics »** (ou « Tableau de bord Analytics »).
3. Tu y verras : nombre d'utilisateurs, pages vues, visiteurs **en temps réel**,
   pays, type d'appareil (mobile/ordinateur)…

**Bon à savoir :**

- Un petit **bandeau cookies** s'affiche sur le site. Les statistiques ne
  comptent que les visiteurs qui cliquent **« Accepter »** (c'est la règle RGPD :
  un visiteur qui refuse n'est pas suivi, donc pas compté).
- Le tableau de bord met **24 à 48 h** à afficher les données complètes, mais
  l'onglet **« Temps réel »** fonctionne presque tout de suite.
- Ces statistiques sont **séparées** des réservations : elles comptent les
  **visites** de la page, pas les places réservées.

---

## ✅ À faire avant d'ouvrir les réservations au public

Pendant la mise en place, des réservations de **test** ont été créées. Avant le
lancement réel, repartir d'une jauge propre — **pour chaque séance concernée**
(chaque séance a sa propre jauge) :

1. Firebase → Firestore → collection `reservations` → **supprimer les
   réservations de test** de cette séance (icône poubelle sur chaque document
   de test).
2. Firebase → Firestore → collection `events` → **document de la séance
   concernée** (ex. `opio-2026-08-18`) → mettre le champ `reserved` à **`0`**.

> Tu peux me demander de te guider pas à pas le moment venu.

---

## ✏️ Modifier le site plus tard

Tu n'as **rien de technique à gérer**. Pour tout changement (texte, date, image,
design…), il suffit de **me le demander** : je modifie le code puis je le
déploie sur Firebase Hosting. Une **note de version** est créée à chaque fois
dans le dossier `releases/` pour garder une trace de ce qui a changé.

---

## 🎬 Ajouter une nouvelle séance

Là aussi, rien de technique à faire toi-même — il suffit de me demander
d'ajouter la séance. Pour information, voici les 3 étapes que je réalise :

1. **Créer sa fiche** dans la collection Firestore `events` (via script ou
   console).
2. **Dupliquer une page** `seance-AAAA-MM-JJ.html` existante, avec le bon
   `EVENT_ID` et le contenu du nouveau film (titre, affiche, description).
3. **Déployer le hosting.** La page d'accueil « Programme » affiche alors
   automatiquement la nouvelle séance.

---

## ✉️ Adresses email

Le domaine `opio.oria-events.fr` est maintenant authentifié auprès de Brevo
(DKIM). Deux adresses dédiées à la prestation Opio ont été créées, toutes deux
redirigées automatiquement vers ta boîte `oria.ei@outlook.fr` (rien à changer
dans tes habitudes) :

| Adresse | Usage |
|---|---|
| `contact@opio.oria-events.fr` | Contact public, affiché sur le site |
| `reservations@opio.oria-events.fr` | Expéditeur des emails automatiques (confirmation, annulation) |

Le domaine racine `oria-events.fr` reste disponible pour de futurs événements
organisés directement par Oria, sans commune cliente.

> 💡 Pour trier automatiquement ces emails dans Outlook, crée des règles basées
> sur le champ "À" (voir avec Claude si besoin d'aide pour les configurer).

### 📧 Apparence des emails — limite connue (mode sombre Outlook)

Les emails envoyés aux visiteurs (confirmation, annulation, avis) sont mis en
forme à la charte du site (en-tête violet/or, fond crème, bouton doré). Ils
s'affichent correctement sur **Gmail, Apple Mail, iOS, Outlook Web** et
**Outlook en mode clair**.

**Limite connue et acceptée :** en **mode sombre sur l'application Outlook
bureau (Windows)**, les couleurs peuvent rester légèrement altérées (fond
recoloré). C'est dû au moteur de rendu de Microsoft Word utilisé par Outlook,
qui ignore en partie les réglages standards anti-inversion (`color-scheme`,
`bgcolor`) que nous avons pourtant ajoutés. **Aucune technique ne permet un
contrôle à 100 %** sur ce client précis — c'est une limite générale de l'email,
pas un bug du projet. Le texte reste **lisible** et l'email reste **fonctionnel**
dans tous les cas. Décision : on laisse tel quel (impact marginal).

---

## 💬 Recueillir les avis après une séance

Un système d'avis est en place pour recueillir les retours des participants.

**Deux façons pour les gens de donner leur avis :**
- **Par email** : un lien personnel leur est envoyé (ils sont reconnus
  automatiquement).
- **Par QR code sur place** : ils scannent l'affichette et saisissent leur
  email ; le système retrouve leur nom. L'image du QR se génère avec
  `outils-export/genere-qr.js` (fichier `qr-avis-opio.png` à imprimer).

**Voir les avis :** lance `node export-avis.js` dans `outils-export/` → un
fichier Excel `avis-….xlsx` est créé (note moyenne incluse).

**⚠️ État actuel (Opio) :** l'**envoi automatique des emails d'avis est
DÉSACTIVÉ** (`meta/session.feedbackEnabled = false`) — rien ne part tout seul.
Le QR code, lui, reste utilisable sur place indépendamment.

**Activer l'envoi automatique pour une prochaine séance :** mettre la date de la
séance dans `meta/session.sessionDate` et passer `feedbackEnabled` à `true`
(demande-moi, ou via la console Firebase). Le lendemain matin à 9h, les demandes
d'avis partiront automatiquement (par lots de 50/jour), avec une relance unique
3 jours après.

---

## 💬 Publier et modérer les avis

Les avis reçus ne s'affichent pas automatiquement sur le site : ils passent
d'abord par une étape de **modération**, pour garder le contrôle sur ce qui est
publié.

- **Page publique `avis-publics.html`** (lien **« Avis »** dans le menu du
  site) : affiche les avis que tu as choisi de publier — étoiles, commentaire,
  et « Prénom I. — séance du … ».
- **Écran d'administration `admin.html`** : c'est là que tu vois tous les avis
  reçus et que tu décides de les **publier** ou de les **retirer**. Son adresse
  n'apparaît nulle part dans le menu du site — **garde-la pour toi** (elle
  ressemble à `https://cinema-en-pleine-air-opio.oria-events.fr/admin.html`) —
  et elle est de toute façon **protégée par une connexion** (email + mot de
  passe).

### 🔑 Mise en place du compte admin (une seule fois)

Avant de pouvoir te connecter à `admin.html`, il faut créer ton compte :

1. Aller sur **https://console.firebase.google.com**, ouvrir le projet
   **« Cinema-en-pleine-air-Opio »**.
2. Menu de gauche → **« Authentication »**.
3. Onglet **« Sign-in method »** → activer le fournisseur **« Email/Mot de
   passe »**.
4. Onglet **« Users »** → **« Add user »** → renseigner ton email (celui de
   l'exploitant) et un mot de passe de ton choix.

Une fois ce compte créé, tu peux te connecter sur `admin.html` avec cet email
et ce mot de passe.

### ✅ Ce qui rend un avis public

Un avis n'apparaît sur la page publique que si **les deux conditions** sont
réunies :

1. La personne a **coché la case de consentement** en déposant son avis.
2. Toi, depuis `admin.html`, tu as cliqué sur **« Publier »** pour cet avis.

Sans consentement, le bouton « Publier » reste bloqué, même si tu le souhaites.
Tu peux à tout moment **retirer** un avis déjà publié.

**Confidentialité :** la page publique ne montre jamais l'email ni le nom
complet de la personne — uniquement ses **initiales** (prénom + première
lettre du nom, ex. « Julie D. »).

---

## 🚀 Améliorations à venir (idées notées)

Idées validées comme faisables, à construire plus tard (à froid, après une
séance) :

### Contrôle des entrées par QR code

Chaque réservation recevrait un **QR unique** dans son email de confirmation.
Le soir, un bénévole muni d'un téléphone/tablette ouvrirait une **page de
contrôle** (`controle.html`) qui scanne le QR et affiche en direct :
« nom · nombre de places · valide », marque la personne comme **entrée**
(anti double-scan), et signale les billets annulés ou inconnus.

- **Coût :** quasi nul (mêmes outils Firebase, quotas gratuits).
- **Points à trancher en conception :**
  - 🔒 **Sécurité** : la page affiche des noms → protéger par un code d'accès
    (PIN) ou une adresse secrète (pas publique).
  - 📶 **Réseau** : en plein air le signal peut être faible → prévoir un repli
    (recherche manuelle par nom, ou liste pré-chargée en début de soirée).
  - 📱 **Sans QR** : certains arriveront sans email → recherche par nom/email
    en secours sur la même page.

> Statut : **idée notée, non commencée.** Demander à Claude de lancer une phase
> de conception le moment venu.

---

## 🔗 Liens et comptes utiles

| Quoi | Lien | Compte |
|---|---|---|
| Le site en ligne | https://cinema-en-pleine-air-opio.oria-events.fr | — (public) |
| Base de données + statistiques | https://console.firebase.google.com | `oria.ei@outlook.fr` |
| Emails (Brevo) | https://app.brevo.com | `oria.ei@outlook.fr` |
| Réception des emails du site (redirigés) | — | `oria.ei@outlook.fr` |
| Nom de domaine (OVH) | https://www.ovh.com/manager/ | `oria.ei@outlook.fr` |
| Ancien lien (redirige automatiquement) | https://cinema-en-pleine-air-opio.netlify.app | `oria.ei@outlook.fr` |
| Code du site (GitHub) | https://github.com/r704ib/cinema-en-pleine-air-opio | `r704ib` |

*Notes de version : dossier [`releases/`](releases/).*
