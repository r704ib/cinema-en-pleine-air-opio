# Spec — Page d'avis publics + écran d'administration modéré

**Date :** 2026-07-27
**Statut :** design validé (maquette approuvée), prêt pour relecture puis plan

## Contexte et objectif

Le site recueille déjà des avis après séance (collection `avis`, privée, avec un
champ de consentement `publication_autorisee`). On veut :

1. Une **page publique** montrant les avis approuvés (« Ils en parlent »), pour
   rassurer les visiteurs et valoriser le cinéma — affichés en **prénom +
   initiale + séance**, étoiles et commentaire, comme des avis Google.
2. Un **écran d'administration protégé** où l'exploitant (Oria) voit les avis
   reçus et décide, un par un, lesquels publier (**modération**).

Il n'y a **aucun avis aujourd'hui** (système d'avis inerte). La page publique
affichera donc un **état vide** élégant, et sera prête à recevoir les avis plus
tard.

**Contrainte de confidentialité centrale :** la page publique ne doit **jamais**
exposer l'email ni le nom complet. Seules des données nettoyées (prénom +
initiale) transitent vers le public.

## Périmètre

**Dans le périmètre :**
- Collection publique `avis_publics` (données nettoyées) + règles de sécurité.
- Logique pure de nettoyage/formatage (prénom+initiale, libellé de séance), testée.
- Fonctions Cloud réservées à l'admin : lister, publier, retirer.
- Page publique `avis-publics.html` (charte, note moyenne, cartes, état vide).
- Écran d'admin `admin.html` protégé par **Firebase Authentication**
  (login/mot de passe, un seul compte : Oria).
- Lien **« Avis »** ajouté au menu de navigation partagé.

**Hors périmètre :**
- Modifier la logique de recueil des avis (`submitFeedback`, page `avis.html`) —
  inchangée. On ajoute seulement un champ `publie` sur les docs `avis`.
- Activer l'envoi automatique des demandes d'avis (reste inerte).
- Réponses de l'exploitant aux avis, tri/recherche avancés dans l'admin (YAGNI).

## Modèle de données

### `avis` (existante, privée) — ajout minimal
On ajoute (via les fonctions) un champ **`publie`** (booléen) pour tracer l'état.
Tous les autres champs inchangés. La collection reste **verrouillée** en lecture
et écriture côté client (accès admin uniquement via fonctions authentifiées).

### `avis_publics` (NOUVELLE, lecture publique)
Un document par avis publié, **id identique à celui de l'avis** (publier/retirer
idempotents). Champs — **uniquement du nettoyé** :

| Champ | Exemple |
|---|---|
| `prenomInitiale` | « Jean D. » |
| `note` | 5 (1–5) |
| `commentaire` | « Une soirée magique ! … » |
| `seanceLabel` | « séance du 18 août 2026 » (ou "" si inconnue) |
| `avisCreatedAt` | timestamp (repris de l'avis, pour l'ordre d'affichage) |
| `publishedAt` | timestamp serveur |

**Jamais** d'email ni de nom complet dans cette collection.

## Logique pure (testable) — nouveau module `functions/avis-public-logic.js`

- `prenomInitiale(prenom, nom)` → `prenom` + " " + première lettre de `nom` en
  majuscule + "." ; si `nom` vide → `prenom` seul ; si `prenom` vide → « Un
  spectateur ». Ex. `("Jean","Dupont")` → « Jean D. ».
- `seanceLabelFromDateLabel(dateLabel)` → retire le jour de la semaine initial :
  « Mardi 18 août 2026 » → « séance du 18 août 2026 » ; si `dateLabel` vide → "".
- `avisPublicFromAvis(avis, seanceLabel)` → objet `{ prenomInitiale, note,
  commentaire, seanceLabel, avisCreatedAt }` prêt à écrire (sans PII).

## Backend — fonctions Cloud (callable, réservées à l'admin)

Constante `ADMIN_EMAIL = "oria.ei@outlook.fr"`. Garde d'accès sur **chaque**
fonction :
```
if (!request.auth || (request.auth.token.email || "").toLowerCase() !== ADMIN_EMAIL)
  throw new HttpsError("permission-denied", "Accès réservé à l'administrateur");
```

- **`adminListAvis()`** → renvoie tous les avis pour l'écran d'admin, avec les
  champs de modération : `{ id, prenom, nom, email, note, commentaire,
  film_souhaite, publication_autorisee, publie, seanceLabel, createdAt }`.
  `seanceLabel` résolu par avis (avis → `reservationId` → réservation →
  `eventId` → fiche `events` → `dateLabel` → `seanceLabelFromDateLabel`) ;
  "" si l'avis n'est lié à aucune réservation.
- **`adminPublishAvis(data.avisId)`** → charge l'avis ; **exige**
  `publication_autorisee === true` (sinon `failed-precondition`
  "CONSENT_REQUIRED") ; résout `seanceLabel` ; écrit `avis_publics/{avisId}` via
  `avisPublicFromAvis` ; met `avis.publie = true`.
- **`adminUnpublishAvis(data.avisId)`** → supprime `avis_publics/{avisId}` ; met
  `avis.publie = false`.

## Écran d'administration — `public/admin.html`

- **Protégé par Firebase Authentication** (fournisseur Email/Mot de passe). Un
  seul compte : celui de l'exploitant.
- Adresse **non listée** dans la navigation (accès par lien direct + login).
- Comportement :
  - Non connecté → formulaire **email + mot de passe** (`signInWithEmailAndPassword`).
  - Connecté → appelle `adminListAvis`, affiche un **tableau** : Séance · Note ·
    Commentaire · Prénom Nom · Email · Consentement (✓/✗) · État (Publié/Non) ·
    Action.
  - Bouton **« Publier »** (désactivé si pas de consentement) / **« Retirer »**
    selon l'état → appelle `adminPublishAvis` / `adminUnpublishAvis` → recharge.
  - Bouton **Déconnexion**.
- **Mise en place par l'exploitant (documentée, non automatisable par Claude) :**
  activer le fournisseur « Email/Mot de passe » dans Firebase Authentication et
  créer le compte admin (email de l'exploitant + mot de passe). Claude ne crée
  pas de compte et ne saisit pas de mot de passe.

## Page publique — `public/avis-publics.html`

- Charte du site (thème sombre, polices Fraunces/Outfit), menu partagé avec
  l'onglet **« Avis »** actif, bandeau cookies + Analytics (comme les autres
  pages).
- Lit `avis_publics` (`getDocs`), trie par `avisCreatedAt` décroissant.
- **Bloc note moyenne** : moyenne des `note` (1 décimale, ex. « 4,8/5 ») +
  « sur N avis publiés ». Masqué s'il n'y a aucun avis.
- **Cartes** : étoiles (pleines/vides selon la note), commentaire, pastille
  initiale + « Prénom I. » + `seanceLabel`.
- **État vide** élégant si aucun avis : « Les premiers avis arriveront bientôt ».

## Navigation

Ajouter un lien **« Avis »** → `/avis-publics.html` dans le `<nav>` partagé de :
`index.html`, `seance-2026-07-28.html`, `seance-2026-08-18.html`. (Les pages
utilitaires `avis.html`, `annuler.html`, `admin.html` ne reçoivent pas ce lien.)

## Règles Firestore

```
match /avis_publics/{id} {
  allow get, list: if true;
  allow create, update, delete: if false;
}
```
`avis` reste `get, list, create, update, delete: if false` (accès via fonctions
admin authentifiées, immunes aux règles). Autres collections inchangées.

## Tests

- **Unitaires (module pur)** : `prenomInitiale` (nom présent/absent, prénom
  vide), `seanceLabelFromDateLabel` (avec/sans jour, vide), `avisPublicFromAvis`
  (n'inclut ni email ni nom complet — vérifier l'absence de ces clés).
- Les fonctions admin (auth + Firestore) ne sont pas testées unitairement
  (nécessiteraient l'émulateur) — vérifiées en intégration + test manuel via
  l'écran d'admin.

## Déploiement / séquencement

1. Construire + tester sur une branche dédiée `feature/avis-publics`.
2. Déployer functions + règles + hosting.
3. **Mise en place Auth par l'exploitant** (fournisseur + compte admin) — guidée.
4. Vérifs : `avis-publics.html` affiche l'état vide ; connexion à `admin.html`
   OK ; (quand un avis de test existe) publier → apparaît en public en prénom+
   initiale, retirer → disparaît ; un avis sans consentement ne peut pas être
   publié.
5. Note de version `releases/v15.md` + section GUIDE (« Modérer et publier les
   avis », mise en place du compte admin).

## Risques et points d'attention

- **Fuite de données perso** : mitigée par l'architecture — la page publique lit
  seulement `avis_publics` (nettoyée) ; l'email/nom complet ne quittent jamais le
  backend. Les fonctions admin exigent l'authentification par l'email admin.
- **Sécurité de l'admin** : repose sur Firebase Auth (login/mot de passe) +
  garde par email dans chaque fonction. L'URL non listée n'est pas une sécurité
  en soi — c'est l'auth qui protège.
- **Compte admin à créer** par l'exploitant (action manuelle en console) avant
  que l'écran d'admin fonctionne.
- **Consentement** : `adminPublishAvis` refuse tout avis sans
  `publication_autorisee` — le consentement RGPD reste la condition sine qua non.
