# Spec — Emails visiteurs à la charte (gabarit commun)

**Date :** 2026-07-27
**Statut :** validé, prêt pour le plan d'implémentation

## Contexte et objectif

Les emails envoyés aux visiteurs sont aujourd'hui en **texte brut**, sans mise en
forme ni cohérence graphique avec le site. On veut leur donner une **charte
commune** (en-tête violet/or, corps clair, pied signé Oria), et en profiter pour
**ajouter un email d'annulation** destiné au visiteur (inexistant aujourd'hui) et
**réserver la place d'un futur QR code d'entrée** dans l'email de confirmation.

Le look a été validé sur maquette HTML (aperçu des 4 emails).

## Périmètre

**Dans le périmètre** — 4 emails visiteurs, tous au même gabarit :

1. **Confirmation** (après réservation) — refonte, contenu enrichi + bloc billet.
2. **Annulation visiteur** (NOUVEAU) — envoyé quand le visiteur annule.
3. **Demande d'avis** — habillage au gabarit (logique inchangée).
4. **Relance d'avis** — habillage au gabarit (logique inchangée).

**Hors périmètre :**

- Les emails **internes à Oria** (`buildOriaNewReservationEmail`,
  `buildOriaCancellationEmail`) restent en texte brut (usage interne, non exposé).
- La **génération réelle du QR code d'entrée** et le contrôle d'entrée (voir la
  section « Améliorations à venir » du GUIDE) — ici on réserve seulement
  l'emplacement dans l'email.
- L'**activation** de l'envoi automatique des avis (reste inerte pour Opio :
  `meta/session.feedbackEnabled = false`).
- Tout changement de la **logique** de réservation/annulation/planification.

## Architecture

### Nouveau module `functions/email-layout.js`

Le « contenant » (gabarit) isolé du « contenu ». Fonctions pures, testables seules :

- `emailShell({ titre, preheader, corpsHtml })` → chaîne HTML complète : structure
  en tableaux, styles en ligne, largeur 600px centrée, en-tête violet + corps clair
  + pied violet signé Oria. Inclut le texte d'aperçu (preheader) masqué.
- `bouton(texte, url)` → bouton doré cliquable (lien stylé « bulletproof »).
- `blocBillet({ reference, lignesHtml, qrDataUri })` → bloc « Votre billet »
  encadré d'or. Si `qrDataUri` est fourni, affiche le QR ; sinon affiche
  l'encadré pointillé « Emplacement réservé au futur QR code d'entrée ».
  **Le paramètre `qrDataUri` est le point d'extension pour le futur.**
- `blocInfos(lignes)` → tableau « Infos pratiques » (`lignes` = liste de
  `{ picto, texteHtml }`).
- `referenceDepuisId(reservationId)` → `reservationId.slice(0, 6).toUpperCase()`
  (référence courte lisible affichée dans le billet).

### Module existant `functions/email-content.js`

Chaque builder retourne toujours `{ to, subject, htmlContent }` (contrat inchangé)
mais construit `htmlContent` via `emailShell(...)` et les helpers.

- `buildVisitorConfirmationEmail(reservation, reservationId)` — refait.
- `buildVisitorCancellationEmail(reservation, reservationId)` — NOUVEAU.
- `buildFeedbackRequestEmail(reservation, reservationId)` — habillé.
- `buildFeedbackReminderEmail(reservation, reservationId)` — habillé.

### Câblage `functions/index.js`

- `onReservationCreated` : inchangé côté appel — envoie déjà
  `buildVisitorConfirmationEmail(reservation, reservationId)`.
- `onReservationCancelled` : AJOUT — après (ou avant) l'email à Oria, envoyer aussi
  `buildVisitorCancellationEmail(after, event.params.reservationId)` à l'adresse du
  visiteur. Un échec d'envoi visiteur ne doit pas empêcher la notification à Oria
  (chaque envoi dans son propre try/catch, journalisé).

## Contenu détaillé des emails

Constantes réutilisées : lieu « Cœur du village, Opio 06650 » ; horaires « Portes
20h30 · Film 21h30 · Fin ~23h15 » ; parking « Carrefour et Salle polyvalente » ;
« Buvette sur place · chaises fournies » ; « Prévoyez de quoi vous couvrir » ;
contact `contact@opio.oria-events.fr` ; site
`https://cinema-en-pleine-air-opio.oria-events.fr`. Film « Un p'tit truc en plus »,
date « mardi 28 juillet 2026 ».

### 1. Confirmation

- **Titre :** « Réservation confirmée ✦ »
- **Preheader :** « Votre réservation pour le Cinéma en plein air d'Opio est confirmée. »
- Salutation « Bonjour {prenom}, », phrase de confirmation (film + date).
- **Bloc billet :** `Réf. {reference}` ; `{totalPlaces} places · {détail adultes /
  enfants 3-10 / moins de 3}` ; `À régler sur place : {montantEstime} €` ; encadré
  pointillé futur QR.
- **Bloc infos pratiques** (lieu, horaires, parking, buvette/chaises, couvrir).
- **Annulation :** phrase + `bouton("Annuler ma réservation", cancelUrl)` où
  `cancelUrl = SITE_URL + "/annuler.html?id=" + reservationId`.
- Pied : « À très vite sous les étoiles d'Opio ✦ » + contact + site.

Le détail des places n'affiche que les catégories non nulles (ex. « 2 adultes,
1 enfant (3-10 ans) » ; on n'écrit pas « 0 enfant »).

### 2. Annulation visiteur (NOUVEAU)

- **Titre :** « Annulation confirmée »
- **Preheader :** « Votre annulation est bien prise en compte. »
- « Bonjour {prenom}, » + « Votre annulation pour la séance du mardi 28 juillet
  2026 est bien prise en compte. Vos {totalPlaces} places ont été libérées — merci
  de nous avoir prévenus. » + « On espère vous retrouver à une prochaine
  projection sous les étoiles d'Opio ! »
- `bouton("Voir les prochaines séances", SITE_URL)`.
- Pas de bloc billet. Pied identique.

### 3. Demande d'avis

- **Titre :** « Votre avis compte ✦ »
- « Bonjour {prenom}, » + remerciement + invitation.
- `bouton("Donner mon avis", SITE_URL + "/avis.html?id=" + reservationId)`.

### 4. Relance d'avis

- **Titre :** « Petit rappel ✦ »
- Même structure que la demande, texte de relance.
- Même bouton d'avis.
- **En plus :** lien discret de désinscription dans le pied :
  `SITE_URL + "/avis.html?id=" + reservationId + "&stop=1"`.

## Contraintes techniques (robustesse email)

- HTML en **tableaux** (`role="presentation"`), **styles en ligne** uniquement.
- **Aucune police web** : repli `Georgia, serif` (titres) / `Arial, Helvetica,
  sans-serif` (corps).
- Largeur **600px**, centré, `max-width:100%` pour le mobile.
- Boutons « bulletproof » (lien `<a>` stylé, pas de dépendance CSS externe).
- Couleurs charte : violet `#241A38`, fond `#15101F`/`#241A38` en-tête, or
  `#E8A33D`, crème `#FBF7EF`, ivoire `#F6F1E7`, lavande `#9B86C9`, texte corps
  `#3b3152`.
- Preheader masqué (`display:none; max-height:0; overflow:hidden`).

## Tests (TDD)

Tests unitaires sur fonctions pures (pas d'envoi réseau). Conserver les
assertions existantes de `email-content.test.js` (elles doivent continuer à
passer : `3 place(s)` — attention, voir ci-dessous — id de réservation présent,
liens avis/stop).

> ⚠️ Point de compatibilité : le test actuel vérifie la sous-chaîne exacte
> `"3 place(s)"`. Le nouveau libellé du billet dira « 3 places » (sans `(s)`).
> On **met à jour ce test** pour refléter le nouveau contenu (assertion sur
> « 3 places » et sur la présence du détail), plutôt que de contraindre la
> rédaction. Ce n'est pas une régression : le contrat `{to, subject, htmlContent}`
> est conservé, seul le libellé change.

Nouveaux tests :

- `email-layout.js` : `emailShell` contient titre + preheader + corps ; `bouton`
  contient texte + href ; `blocBillet` sans `qrDataUri` contient la mention
  « futur QR » et **pas** de balise `<img>` ; `blocBillet` avec `qrDataUri`
  contient `<img` et **pas** la mention pointillée ; `referenceDepuisId("ZreOWU...")`
  = `"ZREOWU"`.
- `buildVisitorCancellationEmail` : `to` = email visiteur ; contient
  « Annulation » et le nombre de places ; contient le lien vers le site.
- Confirmation : contient la référence, le montant, le lieu, l'horaire, le lien
  d'annulation.
- Avis (demande/relance) : inchangés côté logique, mais contiennent désormais le
  bouton stylé (href correct) et, pour la relance, le lien `stop=1`.

## Validation / déploiement

- Vérification locale : `npm test` (toutes suites vertes).
- Aperçu HTML régénéré pour contrôle visuel avant déploiement.
- Déploiement des Cloud Functions (le contenu des emails vit dans les functions,
  pas dans `public/`). Aucun crédit Netlify consommé.
- Pas de note de version « site » nécessaire côté `public/`, mais on ajoute une
  note `releases/vN.md` (convention du projet) décrivant la refonte des emails.

## Risques et points d'attention

- **Rendu Outlook** : le choix en-tête sombre + corps clair limite les soucis ;
  éviter les propriétés non supportées (flexbox, background-image critiques).
- **Emojis pictos** : rendus comme caractères Unicode ; acceptables et testés
  visuellement. Repli : si un picto passe mal, le texte reste lisible sans lui.
- **Référence courte** : 6 caractères d'un id Firestore ne sont pas garantis
  uniques, mais la référence est **indicative** (support/échange), pas une clé —
  la clé reste l'id complet (lien d'annulation). Acceptable.
