# Bloc « Nos prochaines séances » dans les emails d'avis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ajouter un bloc « Nos prochaines séances » (affiche + film + date + bouton Réserver) en bas des emails de demande d'avis et de relance, alimenté par les séances à venir encore ouvertes.

**Architecture:** Un helper de rendu dans `email-content.js` ; les 2 builders d'avis reçoivent un 4ᵉ argument `upcomingEvents` et ajoutent le bloc (rien si liste vide). `sendFeedbackRequests` calcule la liste des séances à venir depuis les `events` et la transmet.

**Tech Stack:** Node.js Cloud Functions, Jest. HTML email (tableaux, styles en ligne).

## Global Constraints

- `SITE_URL = "https://cinema-en-pleine-air-opio.oria-events.fr"` (déjà défini dans `email-content.js`).
- Bloc rendu vide (`""`) si `upcomingEvents` absent ou vide → les appels existants à 3 arguments restent valides.
- Champs par séance : `{ filmTitre, dateLabel, lieu, afficheImg, slug }` (issus des fiches `events`, pas d'entrée utilisateur).
- Bouton « Réserver ma place » → `SITE_URL + "/" + slug + ".html"`. Affiche → `SITE_URL + "/" + afficheImg`.
- Charte email : encadré or `#E8A33D`, fond blanc, texte `#3b3152`, titres Georgia. Tests depuis `functions/`.

---

### Task 1 : Helper + intégration dans les 2 builders (email-content.js)

**Files:**
- Modify: `functions/email-content.js`
- Modify: `functions/test/email-content.test.js`

**Interfaces:**
- Produces : `blocProchainesSeances(upcomingEvents) → string` ; signatures étendues
  `buildFeedbackRequestEmail(reservation, reservationId, event, upcomingEvents)` et
  `buildFeedbackReminderEmail(reservation, reservationId, event, upcomingEvents)`.

- [ ] **Step 1 : Écrire les tests (échec attendu)**

Dans `functions/test/email-content.test.js`, ajouter près des échantillons en tête :

```js
const sampleUpcoming = [{
  filmTitre: "Jumanji : Bienvenue dans la jungle",
  dateLabel: "Mardi 18 août 2026",
  lieu: "Cœur du village à Opio 06650",
  afficheImg: "affiche-jumanji.jpg",
  slug: "seance-2026-08-18",
}];
```

Puis ajouter ces tests :

```js
test("la demande d'avis affiche le bloc prochaines seances quand fourni", () => {
  const email = buildFeedbackRequestEmail({ email: "j@x.fr", prenom: "Jean" }, "abc123", sampleEvent, sampleUpcoming);
  expect(email.htmlContent).toContain("Nos prochaines séances");
  expect(email.htmlContent).toContain("Jumanji : Bienvenue dans la jungle");
  expect(email.htmlContent).toContain("Réserver ma place");
  expect(email.htmlContent).toContain("seance-2026-08-18.html");
});

test("la demande d'avis sans prochaines seances n'affiche pas le bloc", () => {
  const email = buildFeedbackRequestEmail({ email: "j@x.fr", prenom: "Jean" }, "abc123", sampleEvent, []);
  expect(email.htmlContent).not.toContain("Nos prochaines séances");
});

test("la relance affiche aussi le bloc prochaines seances quand fourni", () => {
  const email = buildFeedbackReminderEmail({ email: "j@x.fr", prenom: "Jean" }, "abc123", sampleEvent, sampleUpcoming);
  expect(email.htmlContent).toContain("Nos prochaines séances");
  expect(email.htmlContent).toContain("seance-2026-08-18.html");
  expect(email.htmlContent).toContain("stop=1"); // le lien de desinscription reste
});
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `cd functions && npm test -- email-content`
Expected: FAIL (bloc absent).

- [ ] **Step 3 : Ajouter le helper**

Dans `functions/email-content.js`, ajouter cette fonction **avant** `buildFeedbackRequestEmail` :

```js
function blocProchainesSeances(upcomingEvents) {
  if (!upcomingEvents || upcomingEvents.length === 0) return "";
  const cartes = upcomingEvents.map(function (ev) {
    const url = SITE_URL + "/" + ev.slug + ".html";
    const affiche = SITE_URL + "/" + ev.afficheImg;
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" ' +
      'style="background-color:#FFFFFF; border:2px solid #E8A33D; border-radius:12px; margin-bottom:14px;"><tr>' +
      '<td width="96" style="padding:16px 0 16px 16px; vertical-align:top;">' +
      '<img src="' + affiche + '" width="80" alt="' + ev.filmTitre + '" style="width:80px; border-radius:6px; display:block;"></td>' +
      '<td style="padding:16px 18px; vertical-align:top;">' +
      '<div style="font-family:Georgia,serif; font-size:18px; color:#241A38; font-weight:bold;">' + ev.filmTitre + "</div>" +
      '<div style="font-size:14px; color:#3b3152; margin:6px 0 2px;">&#128197; <strong>' + ev.dateLabel + "</strong></div>" +
      '<div style="font-size:14px; color:#3b3152; margin-bottom:12px;">&#128205; ' + ev.lieu + "</div>" +
      '<a href="' + url + '" style="display:inline-block; background:#E8A33D; color:#241A38; font-size:14px; ' +
      'font-weight:bold; text-decoration:none; padding:10px 22px; border-radius:8px;">Réserver ma place</a>' +
      "</td></tr></table>";
  }).join("");
  return '<div style="margin-top:34px; border-top:1px solid rgba(36,26,56,.12); padding-top:26px;">' +
    '<div style="font-family:Georgia,serif; font-size:20px; color:#241A38; text-align:center; margin-bottom:18px;">' +
    '<span style="color:#E8A33D;">&#10022;</span> Nos prochaines séances</div>' +
    cartes +
    '<p style="font-size:14px; color:#6a5f80; text-align:center; margin:16px 0 0;">' +
    "Au plaisir de vous revoir sous les étoiles&nbsp;!</p></div>";
}
```

- [ ] **Step 4 : Étendre les 2 builders**

Dans `buildFeedbackRequestEmail`, changer la signature en
`function buildFeedbackRequestEmail(reservation, reservationId, event, upcomingEvents) {`
et remplacer la ligne du bouton finale du `corps` :

```js
    '<div style="text-align:center;">' + bouton("Donner mon avis", url) + "</div>";
```

par :

```js
    '<div style="text-align:center;">' + bouton("Donner mon avis", url) + "</div>" +
    blocProchainesSeances(upcomingEvents);
```

Faire exactement la même chose dans `buildFeedbackReminderEmail` (signature
`(reservation, reservationId, event, upcomingEvents)` et même ajout
`+ blocProchainesSeances(upcomingEvents)` à la fin du `corps`, avant le `const piedExtra`).

- [ ] **Step 5 : Lancer (succès)**

Run: `cd functions && npm test -- email-content`
Expected: PASS (nouveaux tests + anciens inchangés).

- [ ] **Step 6 : Commit**

```bash
git add functions/email-content.js functions/test/email-content.test.js
git commit -m "feat: bloc prochaines seances dans les emails d'avis"
```

---

### Task 2 : Transmettre les séances à venir (index.js)

**Files:**
- Modify: `functions/index.js` (`sendFeedbackRequests`)

**Interfaces:**
- Consumes : `eventMap` (déjà construit dans `sendFeedbackRequests`), builders étendus (Task 1).

- [ ] **Step 1 : Calculer `upcomingEvents` et le passer aux builders**

Dans `sendFeedbackRequests`, juste **après** la boucle qui construit `events`/`eventMap`
(et avant/à côté de la lecture des réservations), ajouter le calcul :

```js
    const nowMs = Date.now();
    const upcomingEvents = Object.keys(eventMap)
      .map(function (id) { return eventMap[id]; })
      .filter(function (e) { return e.ouvertResa === true && e.dateISO && e.dateISO.toMillis() > nowMs; })
      .sort(function (a, b) { return a.dateISO.toMillis() - b.dateISO.toMillis(); })
      .map(function (e) {
        return { filmTitre: e.filmTitre, dateLabel: e.dateLabel, lieu: e.lieu, afficheImg: e.afficheImg, slug: e.slug };
      });
```

Puis, dans la boucle d'envoi, passer `upcomingEvents` en 4ᵉ argument :

```js
        if (rec.type === "request") {
          await sendEmail(apiKey, buildFeedbackRequestEmail(reservation, rec.reservationId, ev, upcomingEvents));
```
et
```js
        } else {
          await sendEmail(apiKey, buildFeedbackReminderEmail(reservation, rec.reservationId, ev, upcomingEvents));
```

(le reste de la boucle — marquage des drapeaux, try/catch — inchangé.)

- [ ] **Step 2 : Vérifier la syntaxe + suite complète**

Run: `cd functions && node --check index.js && npm test`
Expected: `node --check` OK ; toutes les suites PASS.

- [ ] **Step 3 : Commit**

```bash
git add functions/index.js
git commit -m "feat: transmettre les seances a venir aux emails d'avis"
```

---

## Déploiement (contrôleur — hors tâches)

1. `cd functions && npm test` (vert).
2. `firebase deploy --only functions` **aujourd'hui** (avant demain 9h).
3. Note de version courte optionnelle (v17) — peut être groupée plus tard.

## Notes

- Le 28/07 (séance en cours d'avis) est passé ⇒ exclu de `upcomingEvents` (filtre
  `dateISO > now`). Le 18/08 (futur, `ouvertResa: true`) apparaît. ✅
- Ne pas lancer `firebase functions:secrets:access`.
