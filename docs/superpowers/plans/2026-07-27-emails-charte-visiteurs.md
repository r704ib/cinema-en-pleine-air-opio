# Emails visiteurs à la charte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner aux 4 emails visiteurs (confirmation, annulation, demande d'avis, relance) une charte graphique commune via un gabarit HTML partagé, ajouter l'email d'annulation visiteur, et réserver l'emplacement d'un futur QR code d'entrée.

**Architecture:** Un nouveau module `functions/email-layout.js` fournit le gabarit (en-tête violet/or, corps clair, pied Oria) et des helpers purs. `functions/email-content.js` construit le contenu de chaque email via ce gabarit. `functions/index.js` câble le nouvel email d'annulation dans le déclencheur `onReservationCancelled`.

**Tech Stack:** Node.js (Cloud Functions v2), Jest. HTML email en tableaux + styles en ligne, aucune police web, aucune dépendance nouvelle.

## Global Constraints

- HTML en **tableaux** (`role="presentation"`), **styles en ligne uniquement**, largeur 600px centrée, `max-width:100%`.
- **Aucune police web** : `Georgia, serif` (titres), `Arial, Helvetica, sans-serif` (corps, via body du client).
- Couleurs charte (verbatim) : violet `#241A38`, or `#E8A33D`, or foncé `#C98A2B`, crème `#FBF7EF`, ivoire `#F6F1E7`, lavande `#9B86C9`, texte corps `#3b3152`, muted `#B8AFC9`.
- Site : `https://cinema-en-pleine-air-opio.oria-events.fr` · Contact : `contact@opio.oria-events.fr`.
- Chaque builder retourne `{ to, subject, htmlContent }` (contrat inchangé).
- Émojis pictos via entités HTML (`&#128205;` etc.).
- Commits fréquents. `cwd` de test = `functions/`. Commande de test : `npm test`.

---

### Task 1 : Module gabarit `email-layout.js`

**Files:**
- Create: `functions/email-layout.js`
- Test: `functions/test/email-layout.test.js`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `referenceDepuisId(reservationId: string) → string` (6 premiers car., majuscules)
  - `bouton(texte: string, url: string) → string` (HTML `<a>` doré)
  - `blocBillet({ reference: string, lignesHtml: string, qrDataUri?: string }) → string`
  - `blocInfos(lignes: Array<{ picto: string, texteHtml: string }>) → string`
  - `emailShell({ titre: string, preheader?: string, corpsHtml: string, piedExtraHtml?: string }) → string`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `functions/test/email-layout.test.js` :

```js
const {
  referenceDepuisId,
  bouton,
  blocBillet,
  blocInfos,
  emailShell,
} = require("../email-layout");

test("referenceDepuisId prend 6 caracteres en majuscules", () => {
  expect(referenceDepuisId("ZreOWUFAg5SY8y0jR6Ik")).toBe("ZREOWU");
});

test("bouton contient le texte et l'url", () => {
  const html = bouton("Cliquer ici", "https://exemple.fr/x");
  expect(html).toContain("Cliquer ici");
  expect(html).toContain('href="https://exemple.fr/x"');
});

test("blocBillet sans qr affiche la mention futur QR et aucune image", () => {
  const html = blocBillet({ reference: "ABC123", lignesHtml: "<strong>3 places</strong>" });
  expect(html).toContain("ABC123");
  expect(html).toContain("3 places");
  expect(html).toContain("futur QR code");
  expect(html).not.toContain("<img");
});

test("blocBillet avec qr affiche une image et pas la mention pointillee", () => {
  const html = blocBillet({ reference: "ABC123", lignesHtml: "x", qrDataUri: "data:image/png;base64,ZZ" });
  expect(html).toContain("<img");
  expect(html).toContain("data:image/png;base64,ZZ");
  expect(html).not.toContain("futur QR code");
});

test("blocInfos rend une ligne par entree avec picto et texte", () => {
  const html = blocInfos([
    { picto: "P1", texteHtml: "Ligne un" },
    { picto: "P2", texteHtml: "Ligne deux" },
  ]);
  expect(html).toContain("Infos pratiques");
  expect(html).toContain("P1");
  expect(html).toContain("Ligne un");
  expect(html).toContain("P2");
  expect(html).toContain("Ligne deux");
});

test("emailShell contient titre, preheader, corps et pied Oria", () => {
  const html = emailShell({
    titre: "Mon titre",
    preheader: "Apercu masque",
    corpsHtml: "<p>Contenu</p>",
  });
  expect(html).toContain("Mon titre");
  expect(html).toContain("Apercu masque");
  expect(html).toContain("<p>Contenu</p>");
  expect(html).toContain("Oria");
  expect(html).toContain("contact@opio.oria-events.fr");
});

test("emailShell insere le pied additionnel (opt-out) quand fourni", () => {
  const html = emailShell({
    titre: "T",
    corpsHtml: "x",
    piedExtraHtml: '<a href="https://exemple.fr/stop">Ne plus recevoir</a>',
  });
  expect(html).toContain("https://exemple.fr/stop");
  expect(html).toContain("Ne plus recevoir");
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier l'échec**

Run: `cd functions && npm test -- email-layout`
Expected: FAIL (`Cannot find module '../email-layout'`).

- [ ] **Step 3 : Écrire le module**

Créer `functions/email-layout.js` :

```js
"use strict";

const SITE_URL = "https://cinema-en-pleine-air-opio.oria-events.fr";
const CONTACT_EMAIL = "contact@opio.oria-events.fr";

const C = {
  violet: "#241A38",
  or: "#E8A33D",
  orFonce: "#C98A2B",
  creme: "#FBF7EF",
  ivoire: "#F6F1E7",
  lavande: "#9B86C9",
  texte: "#3b3152",
  muted: "#B8AFC9",
};

function referenceDepuisId(reservationId) {
  return String(reservationId).slice(0, 6).toUpperCase();
}

function bouton(texte, url) {
  return (
    '<a href="' + url + '" style="display:inline-block; background:' + C.or +
    "; color:" + C.violet +
    '; font-size:15px; font-weight:bold; text-decoration:none; padding:13px 30px; border-radius:8px;">' +
    texte + "</a>"
  );
}

function blocBillet(options) {
  const zoneQr = options.qrDataUri
    ? '<div style="margin-top:18px; text-align:center;"><img src="' + options.qrDataUri +
      '" width="180" height="180" alt="QR code d\'entree" style="width:180px; height:180px;"></div>'
    : '<div style="margin-top:18px; padding:16px; border:1px dashed #cbb892; border-radius:10px; ' +
      'text-align:center; color:#9a8a6a; font-size:13px; font-style:italic;">' +
      "&#9744;&nbsp; Emplacement réservé au futur QR code d'entrée</div>";
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid ' +
    C.or + '; border-radius:12px; background:#fff;"><tr><td style="padding:22px 26px;">' +
    '<div style="font-size:12px; letter-spacing:2px; color:' + C.orFonce +
    '; font-weight:bold; text-transform:uppercase;">Votre billet</div>' +
    '<div style="font-family:Georgia,serif; font-size:24px; color:' + C.violet +
    '; margin:8px 0 14px;">Réf. <strong>' + options.reference + "</strong></div>" +
    '<div style="font-size:15px; line-height:1.6; color:' + C.texte + ';">' + options.lignesHtml + "</div>" +
    zoneQr +
    "</td></tr></table>"
  );
}

function blocInfos(lignes) {
  const rows = lignes
    .map(function (l) {
      return (
        '<tr><td style="padding:6px 0; width:30px; vertical-align:top;">' + l.picto +
        '</td><td style="padding:6px 0;">' + l.texteHtml + "</td></tr>"
      );
    })
    .join("");
  return (
    '<div style="font-size:12px; letter-spacing:2px; color:' + C.orFonce +
    '; font-weight:bold; text-transform:uppercase; margin-bottom:12px;">Infos pratiques</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px; line-height:1.5; color:' +
    C.texte + ';">' + rows + "</table>"
  );
}

function pied(piedExtraHtml) {
  return (
    '<tr><td style="background:' + C.violet + '; padding:26px 40px; text-align:center;">' +
    '<div style="font-family:Georgia,serif; font-size:16px; font-style:italic; color:' + C.ivoire +
    ';">À très vite sous les étoiles d\'Opio <span style="color:' + C.or + ';">&#10022;</span></div>' +
    '<div style="font-size:12px; color:' + C.lavande + '; margin-top:14px; line-height:1.7;">' +
    'Cinéma en plein air · Opio — une prestation <strong style="color:' + C.or + ';">Oria</strong><br>' +
    '<a href="mailto:' + CONTACT_EMAIL + '" style="color:' + C.muted + '; text-decoration:underline;">' +
    CONTACT_EMAIL + "</a> &nbsp;·&nbsp; " +
    '<a href="' + SITE_URL + '" style="color:' + C.muted + '; text-decoration:underline;">le site</a>' +
    (piedExtraHtml || "") +
    "</div></td></tr>"
  );
}

function emailShell(options) {
  const preheader = options.preheader || "";
  return (
    '<div style="display:none; max-height:0; overflow:hidden; opacity:0;">' + preheader + "</div>" +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center" style="width:600px; max-width:100%; margin:0 auto; background:' +
    C.creme + '; border-radius:14px; overflow:hidden;">' +
    '<tr><td style="background:' + C.violet + '; padding:34px 40px 30px; text-align:center;">' +
    '<div style="font-size:12px; letter-spacing:3px; color:' + C.or +
    '; font-weight:bold; text-transform:uppercase;">Cinéma en plein air · Opio</div>' +
    '<div style="font-family:Georgia,serif; font-size:30px; font-style:italic; color:' + C.ivoire +
    '; margin-top:12px;">' + options.titre + "</div>" +
    "</td></tr>" +
    '<tr><td style="padding:34px 40px 30px; color:' + C.violet + ';">' + options.corpsHtml + "</td></tr>" +
    pied(options.piedExtraHtml) +
    "</table>"
  );
}

module.exports = {
  SITE_URL,
  CONTACT_EMAIL,
  referenceDepuisId,
  bouton,
  blocBillet,
  blocInfos,
  emailShell,
};
```

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `cd functions && npm test -- email-layout`
Expected: PASS (7 tests).

- [ ] **Step 5 : Commit**

```bash
git add functions/email-layout.js functions/test/email-layout.test.js
git commit -m "feat: gabarit email partage (email-layout)"
```

---

### Task 2 : Refonte de l'email de confirmation

**Files:**
- Modify: `functions/email-content.js` (imports en tête ; remplacer `buildVisitorConfirmationEmail`)
- Modify: `functions/test/email-content.test.js:27-32` (mettre à jour l'assertion « 3 place(s) »)

**Interfaces:**
- Consumes: `emailShell`, `bouton`, `blocBillet`, `blocInfos`, `referenceDepuisId` de `./email-layout`.
- Produces: `buildVisitorConfirmationEmail(reservation, reservationId) → { to, subject, htmlContent }` (signature inchangée), plus les helpers internes `detailPlaces(reservation) → string` et la constante `INFOS_PRATIQUES`.

- [ ] **Step 1 : Mettre à jour le test existant + ajouter les nouvelles assertions**

Dans `functions/test/email-content.test.js`, remplacer le test `buildVisitorConfirmationEmail` (lignes 27-32) par :

```js
test("buildVisitorConfirmationEmail : billet, infos pratiques et lien d'annulation", () => {
  const email = buildVisitorConfirmationEmail(sampleReservation, "abc123");
  expect(email.to).toBe("jean@example.com");
  expect(email.htmlContent).toContain("3 places");
  expect(email.htmlContent).toContain("2 adultes");
  expect(email.htmlContent).toContain("1 enfant (3-10 ans)");
  expect(email.htmlContent).toContain("ABC123"); // reference
  expect(email.htmlContent).toContain("13 €"); // montant
  expect(email.htmlContent).toContain("Opio 06650");
  expect(email.htmlContent).toContain("21h30");
  expect(email.htmlContent).toContain("annuler.html?id=abc123");
});
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run: `cd functions && npm test -- email-content`
Expected: FAIL (le contenu actuel dit « 3 place(s) », pas « 3 places » ni « ABC123 »).

- [ ] **Step 3 : Modifier `email-content.js`**

En tête de fichier, sous `const SITE_URL = ...`, ajouter l'import et les helpers, et remplacer la fonction `buildVisitorConfirmationEmail`.

Imports (après la ligne `const ORIA_EMAIL = ...`) :

```js
const {
  emailShell,
  bouton,
  blocBillet,
  blocInfos,
  referenceDepuisId,
} = require("./email-layout");

function detailPlaces(r) {
  const parts = [];
  if (r.nb_adultes > 0) {
    parts.push(r.nb_adultes + (r.nb_adultes > 1 ? " adultes" : " adulte"));
  }
  if (r.nb_enfants_3_10 > 0) {
    parts.push(r.nb_enfants_3_10 + (r.nb_enfants_3_10 > 1 ? " enfants" : " enfant") + " (3-10 ans)");
  }
  if (r.nb_enfants_moins_3 > 0) {
    parts.push(r.nb_enfants_moins_3 + (r.nb_enfants_moins_3 > 1 ? " enfants" : " enfant") + " (moins de 3 ans)");
  }
  return parts.join(", ");
}

const INFOS_PRATIQUES = [
  { picto: "&#128205;", texteHtml: "Cœur du village, <strong>Opio 06650</strong>" },
  { picto: "&#128368;", texteHtml: "Portes <strong>20h30</strong> · Film <strong>21h30</strong> · Fin ~23h15" },
  { picto: "&#128663;", texteHtml: "Parking à proximité (Carrefour et Salle polyvalente)" },
  { picto: "&#127871;", texteHtml: "Buvette sur place · chaises fournies" },
  { picto: "&#129509;", texteHtml: "Prévoyez de quoi vous couvrir si les températures baissent" },
];
```

Remplacer entièrement `buildVisitorConfirmationEmail` par :

```js
function buildVisitorConfirmationEmail(reservation, reservationId) {
  const cancelUrl = buildCancelUrl(reservationId);
  const billet = blocBillet({
    reference: referenceDepuisId(reservationId),
    lignesHtml:
      "<strong>" + reservation.totalPlaces + " places</strong> · " + detailPlaces(reservation) + "<br>" +
      "À régler sur place : <strong>" + reservation.montantEstime + " €</strong>",
  });
  const corps =
    '<p style="font-size:17px; line-height:1.5; margin:0 0 14px;">Bonjour <strong>' +
    reservation.prenom + "</strong>,</p>" +
    '<p style="font-size:16px; line-height:1.6; color:#3b3152; margin:0 0 26px;">' +
    "Votre réservation pour la projection de <strong>« Un p'tit truc en plus »</strong> le " +
    "<strong>mardi 28 juillet 2026</strong> est bien confirmée. On a hâte de vous accueillir " +
    "sous les étoiles d'Opio&nbsp;!</p>" +
    billet +
    '<div style="margin:30px 0 6px;">' + blocInfos(INFOS_PRATIQUES) + "</div>" +
    '<p style="font-size:15px; color:#3b3152; margin:26px 0 16px; text-align:center;">' +
    "Un empêchement&nbsp;? Merci de libérer votre place pour d'autres spectateurs.</p>" +
    '<div style="text-align:center;">' + bouton("Annuler ma réservation", cancelUrl) + "</div>";
  return {
    to: reservation.email,
    subject: "Votre réservation pour le Cinéma en plein air d'Opio",
    htmlContent: emailShell({
      titre: 'Réservation confirmée <span style="color:#E8A33D;">&#10022;</span>',
      preheader: "Votre réservation pour le Cinéma en plein air d'Opio est confirmée.",
      corpsHtml: corps,
    }),
  };
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `cd functions && npm test -- email-content`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add functions/email-content.js functions/test/email-content.test.js
git commit -m "feat: email de confirmation a la charte (billet + infos pratiques)"
```

---

### Task 3 : Email d'annulation visiteur + câblage

**Files:**
- Modify: `functions/email-content.js` (ajouter `buildVisitorCancellationEmail`, l'exporter)
- Modify: `functions/index.js:17-23` (import) et `functions/index.js:212-223` (déclencheur)
- Modify: `functions/test/email-content.test.js` (ajouter un test)

**Interfaces:**
- Consumes: `emailShell`, `bouton`, `SITE_URL` de `./email-layout`.
- Produces: `buildVisitorCancellationEmail(reservation, reservationId) → { to, subject, htmlContent }`.

- [ ] **Step 1 : Écrire le test qui échoue**

Dans `functions/test/email-content.test.js`, ajouter dans les imports (haut du fichier) `buildVisitorCancellationEmail`, puis ajouter :

```js
test("buildVisitorCancellationEmail : destine au visiteur, mentionne les places liberees", () => {
  const email = buildVisitorCancellationEmail(sampleReservation, "abc123");
  expect(email.to).toBe("jean@example.com");
  expect(email.htmlContent).toContain("Annulation");
  expect(email.htmlContent).toContain("3 places");
  expect(email.htmlContent).toContain("cinema-en-pleine-air-opio.oria-events.fr");
});
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run: `cd functions && npm test -- email-content`
Expected: FAIL (`buildVisitorCancellationEmail is not a function`).

- [ ] **Step 3 : Ajouter la fonction et l'exporter**

Dans `functions/email-content.js`, ajouter avant `buildFeedbackRequestEmail` :

```js
function buildVisitorCancellationEmail(reservation, reservationId) {
  const corps =
    '<p style="font-size:17px; line-height:1.5; margin:0 0 14px;">Bonjour <strong>' +
    reservation.prenom + "</strong>,</p>" +
    '<p style="font-size:16px; line-height:1.6; color:#3b3152; margin:0 0 14px;">' +
    "Votre annulation pour la séance du <strong>mardi 28 juillet 2026</strong> est bien prise " +
    "en compte. Vos <strong>" + reservation.totalPlaces + " places</strong> ont été libérées — " +
    "merci de nous avoir prévenus.</p>" +
    '<p style="font-size:16px; line-height:1.6; color:#3b3152; margin:0 0 28px;">' +
    "On espère vous retrouver à une prochaine projection sous les étoiles d'Opio&nbsp;!</p>" +
    '<div style="text-align:center;">' + bouton("Voir les prochaines séances", SITE_URL) + "</div>";
  return {
    to: reservation.email,
    subject: "Votre annulation — Cinéma en plein air d'Opio",
    htmlContent: emailShell({
      titre: "Annulation confirmée",
      preheader: "Votre annulation est bien prise en compte.",
      corpsHtml: corps,
    }),
  };
}
```

> Note : `SITE_URL` est déjà défini en haut de `email-content.js` (constante locale identique à celle du gabarit). Réutiliser la constante locale existante.

Dans `module.exports` de `email-content.js`, ajouter `buildVisitorCancellationEmail,`.

- [ ] **Step 4 : Lancer le test pour vérifier le succès**

Run: `cd functions && npm test -- email-content`
Expected: PASS.

- [ ] **Step 5 : Câbler dans `index.js`**

Dans l'import depuis `./email-content` (lignes 17-23), ajouter `buildVisitorCancellationEmail,`.

Remplacer le corps du déclencheur `onReservationCancelled` (lignes 214-222) par :

```js
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (before.status === "active" && after.status === "cancelled") {
      const apiKey = BREVO_API_KEY.value();
      const reservationId = event.params.reservationId;
      try {
        await sendEmail(apiKey, buildVisitorCancellationEmail(after, reservationId));
      } catch (err) {
        logger.error("Cancellation visitor email failed", { reservationId, error: String(err) });
      }
      try {
        await sendEmail(apiKey, buildOriaCancellationEmail(after));
      } catch (err) {
        logger.error("Cancellation Oria email failed", { reservationId, error: String(err) });
      }
      logger.info("Cancellation emails processed", { reservationId });
    }
  }
```

- [ ] **Step 6 : Lancer toute la suite**

Run: `cd functions && npm test`
Expected: PASS (toutes suites).

- [ ] **Step 7 : Commit**

```bash
git add functions/email-content.js functions/index.js functions/test/email-content.test.js
git commit -m "feat: email d'annulation visiteur (nouveau) + cablage onReservationCancelled"
```

---

### Task 4 : Habillage des emails d'avis (demande + relance)

**Files:**
- Modify: `functions/email-content.js` (remplacer `buildFeedbackRequestEmail` et `buildFeedbackReminderEmail`)
- Test: `functions/test/email-content.test.js` (les tests existants lignes 46-58 doivent continuer à passer ; ajouter 2 assertions)

**Interfaces:**
- Consumes: `emailShell`, `bouton` de `./email-layout`.
- Produces: signatures inchangées de `buildFeedbackRequestEmail(reservation, reservationId)` et `buildFeedbackReminderEmail(reservation, reservationId)`.

- [ ] **Step 1 : Ajouter les assertions de charte aux tests existants**

Dans `functions/test/email-content.test.js`, dans le test `buildFeedbackRequestEmail` ajouter :

```js
  expect(email.htmlContent).toContain("Donner mon avis"); // bouton
```

Dans le test `buildFeedbackReminderEmail` ajouter :

```js
  expect(email.htmlContent).toContain("Ne plus recevoir"); // lien opt-out habille
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run: `cd functions && npm test -- email-content`
Expected: FAIL (le texte actuel ne contient ni le bouton « Donner mon avis » ni « Ne plus recevoir »).

- [ ] **Step 3 : Remplacer les deux fonctions**

Dans `functions/email-content.js`, remplacer `buildFeedbackRequestEmail` par :

```js
function buildFeedbackRequestEmail(reservation, reservationId) {
  const url = SITE_URL + "/avis.html?id=" + reservationId;
  const corps =
    '<p style="font-size:17px; line-height:1.5; margin:0 0 14px;">Bonjour <strong>' +
    reservation.prenom + "</strong>,</p>" +
    '<p style="font-size:16px; line-height:1.6; color:#3b3152; margin:0 0 28px;">' +
    "Merci d'être venu(e) à la séance&nbsp;! Votre retour nous aide beaucoup à préparer de plus " +
    "belles projections. Cela ne prend qu'une minute.</p>" +
    '<div style="text-align:center;">' + bouton("Donner mon avis", url) + "</div>";
  return {
    to: reservation.email,
    subject: "Votre avis sur le Cinéma en plein air d'Opio",
    htmlContent: emailShell({
      titre: 'Votre avis compte <span style="color:#E8A33D;">&#10022;</span>',
      preheader: "Votre avis nous aiderait beaucoup à améliorer les prochaines séances.",
      corpsHtml: corps,
    }),
  };
}
```

Remplacer `buildFeedbackReminderEmail` par :

```js
function buildFeedbackReminderEmail(reservation, reservationId) {
  const url = SITE_URL + "/avis.html?id=" + reservationId;
  const stopUrl = url + "&stop=1";
  const corps =
    '<p style="font-size:17px; line-height:1.5; margin:0 0 14px;">Bonjour <strong>' +
    reservation.prenom + "</strong>,</p>" +
    '<p style="font-size:16px; line-height:1.6; color:#3b3152; margin:0 0 28px;">' +
    "Vous n'avez pas encore donné votre avis sur la séance — votre retour compte beaucoup " +
    "pour nous&nbsp;! Une minute suffit.</p>" +
    '<div style="text-align:center;">' + bouton("Donner mon avis", url) + "</div>";
  const piedExtra =
    '<br><a href="' + stopUrl + '" style="color:#7d7196; text-decoration:underline; font-size:11px;">' +
    "Ne plus recevoir ces messages</a>";
  return {
    to: reservation.email,
    subject: "Petit rappel : votre avis sur le Cinéma en plein air d'Opio",
    htmlContent: emailShell({
      titre: 'Petit rappel <span style="color:#E8A33D;">&#10022;</span>',
      preheader: "Votre avis compte beaucoup pour nous.",
      corpsHtml: corps,
      piedExtraHtml: piedExtra,
    }),
  };
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `cd functions && npm test -- email-content`
Expected: PASS (les anciennes assertions `/avis.html?id=abc123` et `stop=1` passent toujours, plus les nouvelles).

- [ ] **Step 5 : Commit**

```bash
git add functions/email-content.js functions/test/email-content.test.js
git commit -m "feat: emails d'avis (demande + relance) a la charte"
```

---

### Task 5 : Aperçu de contrôle + note de version + vérification finale

**Files:**
- Create: `outils-export/apercu-emails.js` (génère un HTML d'aperçu des 4 emails via les vrais builders)
- Create: `releases/v13.md`
- Modify: `releases/README.md` (ajouter la ligne v13)

**Interfaces:**
- Consumes: les 4 builders de `../functions/email-content`.
- Produces: un fichier `apercu-emails.html` (ignoré par git — voir `.gitignore` : `*.html` n'est PAS ignoré ; on écrit donc dans un fichier explicitement ignoré). Utiliser le nom `apercu-emails.html` et l'ajouter au `.gitignore` d'`outils-export/`.

- [ ] **Step 1 : Ajouter l'aperçu au `.gitignore` d'outils-export**

Dans `outils-export/.gitignore`, ajouter la ligne :

```
apercu-emails.html
```

- [ ] **Step 2 : Écrire le script d'aperçu**

Créer `outils-export/apercu-emails.js` :

```js
// Génère un aperçu HTML des 4 emails visiteurs via les vrais builders.
const fs = require("fs");
const path = require("path");
const {
  buildVisitorConfirmationEmail,
  buildVisitorCancellationEmail,
  buildFeedbackRequestEmail,
  buildFeedbackReminderEmail,
} = require("../functions/email-content");

const r = {
  prenom: "Jean", nom: "Dupont", email: "jean@example.com", telephone: "0600000000",
  nb_adultes: 2, nb_enfants_3_10: 1, nb_enfants_moins_3: 0, totalPlaces: 3, montantEstime: 13,
};
const id = "ZreOWUFAg5SY8y0jR6Ik";

const emails = [
  ["1 · Confirmation", buildVisitorConfirmationEmail(r, id)],
  ["2 · Annulation", buildVisitorCancellationEmail(r, id)],
  ["3 · Demande d'avis", buildFeedbackRequestEmail(r, id)],
  ["4 · Relance d'avis", buildFeedbackReminderEmail(r, id)],
];

const sections = emails.map(function (e) {
  return '<div style="max-width:640px;margin:0 auto;padding:8px 20px;"><div style="background:#241A38;color:#E8A33D;' +
    'font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;padding:8px 14px;border-radius:8px;">' +
    e[0] + " — <em>" + e[1].subject + "</em></div></div>" +
    '<div style="padding:14px 0 34px;">' + e[1].htmlContent + "</div>";
}).join("");

const page = "<!DOCTYPE html><html lang=\"fr\"><head><meta charset=\"utf-8\">" +
  '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Aperçu emails</title></head>' +
  '<body style="margin:0;padding:24px 0;background:#e9e5ef;font-family:Arial,sans-serif;">' + sections + "</body></html>";

const out = path.join(__dirname, "apercu-emails.html");
fs.writeFileSync(out, page);
console.log("✅ Aperçu généré : " + out);
```

- [ ] **Step 3 : Générer et ouvrir l'aperçu**

Run: `cd outils-export && node apercu-emails.js && open apercu-emails.html`
Expected: le fichier est créé et s'ouvre ; contrôle visuel des 4 emails.

- [ ] **Step 4 : Écrire la note de version**

Créer `releases/v13.md` :

```markdown
# v13 — 2026-07-27

Refonte graphique des emails visiteurs (charte commune).

## Nouveautés

- **Gabarit email commun** (`functions/email-layout.js`) : en-tête violet/or,
  corps clair, pied signé Oria, bouton doré — appliqué à tous les emails
  visiteurs pour une cohérence avec le site.
- **Email de confirmation enrichi** : bloc « billet » (référence + détail des
  places + montant), infos pratiques (lieu, horaires, parking, buvette, à
  prévoir), bouton d'annulation.
- **Email d'annulation visiteur (NOUVEAU)** : le visiteur reçoit désormais une
  confirmation d'annulation (avant, seule Oria était notifiée).
- **Emails d'avis** (demande + relance) habillés à la charte (logique inchangée,
  toujours inerte pour Opio).
- **Emplacement du futur QR code d'entrée** réservé dans le bloc billet
  (paramètre `qrDataUri` prêt côté gabarit).

## Technique

- Nouveau module `functions/email-layout.js` (gabarit + helpers, testé).
- `onReservationCancelled` envoie l'email visiteur puis notifie Oria, chaque
  envoi isolé (un échec n'empêche pas l'autre).
- Emails internes à Oria inchangés (texte brut, usage interne).
- HTML robuste (tableaux, styles en ligne, sans police web) pour Gmail/Outlook/
  Apple Mail. Aucune dépendance ajoutée.

## Déploiement

Contenu porté par les Cloud Functions → `firebase deploy --only functions`.
Aucun crédit Netlify consommé.
```

- [ ] **Step 5 : Mettre à jour l'index des versions**

Dans `releases/README.md`, ajouter sous `## Versions` (tout en haut de la liste) :

```markdown
- [v13](v13.md) — 2026-07-27 — Refonte graphique des emails visiteurs (charte commune, email d'annulation, place du futur QR).
```

- [ ] **Step 6 : Vérification finale complète**

Run: `cd functions && npm test`
Expected: PASS (toutes suites : reservation-logic, email-content, email-layout, feedback-logic).

- [ ] **Step 7 : Commit**

```bash
git add outils-export/apercu-emails.js outils-export/.gitignore releases/v13.md releases/README.md
git commit -m "chore: apercu emails + note de version v13"
```

---

## Notes de fin

- **Déploiement** (hors plan, sur décision de l'utilisateur) : `firebase deploy --only functions`. Ne PAS lancer `firebase functions:secrets:access` (révélerait la clé Brevo).
- **Ne jamais** committer `outils-export/cle-admin.json` ni les fichiers générés (`*.png`, `*.pdf`, `*.xlsx`, `apercu-emails.html`).
- Le futur QR d'entrée se branchera via `blocBillet({ ..., qrDataUri })` sans refonte.
