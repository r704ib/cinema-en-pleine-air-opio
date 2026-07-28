# Page d'avis publics + admin modéré — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une page publique d'avis (« Ils en parlent », prénom+initiale+séance) alimentée par une collection nettoyée, et un écran d'administration protégé par login où l'exploitant modère (publie/retire) chaque avis.

**Architecture:** La collection `avis` (privée, avec PII) reste verrouillée. Un module pur nettoie un avis en version publique. Trois fonctions Cloud réservées à l'admin (authentifié via Firebase Auth, garde par email) listent/publient/retirent les avis vers une collection `avis_publics` (lecture publique, sans PII). Deux pages : `avis-publics.html` (publique) lit `avis_publics` ; `admin.html` (protégée) pilote la modération.

**Tech Stack:** Node.js Cloud Functions v2, Jest, Firestore, Firebase Auth (Email/Mot de passe), Firebase Hosting, HTML/CSS/JS vanilla (SDK Firebase 10.13.0 CDN).

## Global Constraints

- `ADMIN_EMAIL = "oria.ei@outlook.fr"` (comparaison en minuscules).
- `avis_publics` ne contient **jamais** d'email ni de nom complet — uniquement `prenomInitiale`, `note`, `commentaire`, `seanceLabel`, `avisCreatedAt`, `publishedAt`.
- Publication conditionnée à `publication_autorisee === true` (consentement RGPD).
- Charte : `--c-bg:#15101F`, `--c-surface:#241A38`, `--c-gold:#E8A33D`, `--c-lavender:#9B86C9`, `--c-ivory:#F6F1E7`, `--c-muted:#B8AFC9`, polices Fraunces + Outfit.
- Titre page publique : « Ils en parlent ».
- firebaseConfig (identique aux autres pages) : apiKey `AIzaSyBB-WiFkZfrHQD9rXDQ6KjbeNQyMlO4VbA`, authDomain `cinema-en-pleine-air-opi-ac81e.firebaseapp.com`, projectId `cinema-en-pleine-air-opi-ac81e`, storageBucket `cinema-en-pleine-air-opi-ac81e.firebasestorage.app`, messagingSenderId `245777069404`, appId `1:245777069404:web:8478506b55ec08fb8abd99`, measurementId `G-R66JNXKKPZ`.
- Tests depuis `functions/`, commande `npm test`. Ne jamais committer `cle-admin.json`.

---

### Task 1 : Module pur `avis-public-logic.js`

**Files:**
- Create: `functions/avis-public-logic.js`
- Test: `functions/test/avis-public-logic.test.js`

**Interfaces:**
- Produces:
  - `prenomInitiale(prenom, nom) → string`
  - `seanceLabelFromDateLabel(dateLabel) → string`
  - `avisPublicFromAvis(avis, seanceLabel) → { prenomInitiale, note, commentaire, seanceLabel, avisCreatedAt }`

- [ ] **Step 1 : Écrire les tests (échec attendu)**

Créer `functions/test/avis-public-logic.test.js` :

```js
const { prenomInitiale, seanceLabelFromDateLabel, avisPublicFromAvis } = require("../avis-public-logic");

test("prenomInitiale : prenom + initiale du nom", () => {
  expect(prenomInitiale("Jean", "Dupont")).toBe("Jean D.");
});

test("prenomInitiale : nom absent -> prenom seul", () => {
  expect(prenomInitiale("Jean", "")).toBe("Jean");
  expect(prenomInitiale("Jean", null)).toBe("Jean");
});

test("prenomInitiale : prenom vide -> 'Un spectateur'", () => {
  expect(prenomInitiale("", "Dupont")).toBe("Un spectateur");
});

test("seanceLabelFromDateLabel retire le jour de la semaine", () => {
  expect(seanceLabelFromDateLabel("Mardi 18 août 2026")).toBe("séance du 18 août 2026");
});

test("seanceLabelFromDateLabel : vide -> ''", () => {
  expect(seanceLabelFromDateLabel("")).toBe("");
});

test("avisPublicFromAvis n'inclut ni email ni nom complet", () => {
  const avis = { prenom: "Jean", nom: "Dupont", email: "jean@x.fr", note: 5, commentaire: "Super", createdAt: 123 };
  const pub = avisPublicFromAvis(avis, "séance du 18 août 2026");
  expect(pub.prenomInitiale).toBe("Jean D.");
  expect(pub.note).toBe(5);
  expect(pub.commentaire).toBe("Super");
  expect(pub.seanceLabel).toBe("séance du 18 août 2026");
  expect(pub.avisCreatedAt).toBe(123);
  const json = JSON.stringify(pub);
  expect(json).not.toContain("Dupont");
  expect(json).not.toContain("jean@x.fr");
});
```

- [ ] **Step 2 : Lancer (échec)**

Run: `cd functions && npm test -- avis-public-logic`
Expected: FAIL (module absent).

- [ ] **Step 3 : Écrire le module**

Créer `functions/avis-public-logic.js` :

```js
"use strict";

function prenomInitiale(prenom, nom) {
  const p = (prenom || "").trim();
  if (!p) return "Un spectateur";
  const n = (nom || "").trim();
  if (!n) return p;
  return p + " " + n.charAt(0).toUpperCase() + ".";
}

function seanceLabelFromDateLabel(dateLabel) {
  const d = (dateLabel || "").trim();
  if (!d) return "";
  const sansJour = d.replace(/^\S+\s+/, "");
  return "séance du " + sansJour;
}

function avisPublicFromAvis(avis, seanceLabel) {
  return {
    prenomInitiale: prenomInitiale(avis.prenom, avis.nom),
    note: avis.note,
    commentaire: avis.commentaire,
    seanceLabel: seanceLabel || "",
    avisCreatedAt: avis.createdAt || null,
  };
}

module.exports = { prenomInitiale, seanceLabelFromDateLabel, avisPublicFromAvis };
```

- [ ] **Step 4 : Lancer (succès)**

Run: `cd functions && npm test -- avis-public-logic`
Expected: PASS (6 tests).

- [ ] **Step 5 : Commit**

```bash
git add functions/avis-public-logic.js functions/test/avis-public-logic.test.js
git commit -m "feat: logique pure de nettoyage des avis publics"
```

---

### Task 2 : Fonctions Cloud d'administration

**Files:**
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: `avis-public-logic.js` (Task 1), `loadEvent` (existant).
- Produces (callables, réservées à l'admin) : `adminListAvis`, `adminPublishAvis`, `adminUnpublishAvis`. Écrit dans `avis_publics/{avisId}` et le champ `publie` sur `avis/{avisId}`.

- [ ] **Step 1 : Ajouter imports, constante et helpers**

Dans `functions/index.js`, après la ligne `const DEFAULT_EVENT_ID = "opio-2026-07-28";`, ajouter :

```js
const ADMIN_EMAIL = "oria.ei@outlook.fr";
const {
  seanceLabelFromDateLabel,
  avisPublicFromAvis,
} = require("./avis-public-logic");

function assertAdmin(request) {
  const email = request.auth && request.auth.token && request.auth.token.email;
  if (!email || String(email).toLowerCase() !== ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "Accès réservé à l'administrateur");
  }
}

async function resolveSeanceLabel(reservationId) {
  if (!reservationId) return "";
  const resSnap = await db.collection("reservations").doc(reservationId).get();
  if (!resSnap.exists) return "";
  const eventId = resSnap.data().eventId;
  if (!eventId) return "";
  const ev = await loadEvent(eventId);
  return ev && ev.dateLabel ? seanceLabelFromDateLabel(ev.dateLabel) : "";
}
```

- [ ] **Step 2 : Ajouter les 3 fonctions**

À la fin de `functions/index.js` (avant la fin du fichier), ajouter :

```js
exports.adminListAvis = onCall(async (request) => {
  assertAdmin(request);
  const snap = await db.collection("avis").orderBy("createdAt", "desc").get();
  const avis = [];
  for (const d of snap.docs) {
    const a = d.data();
    const seanceLabel = await resolveSeanceLabel(a.reservationId);
    avis.push({
      id: d.id,
      prenom: a.prenom || "",
      nom: a.nom || "",
      email: a.email || "",
      note: a.note,
      commentaire: a.commentaire || "",
      film_souhaite: a.film_souhaite || "",
      publication_autorisee: a.publication_autorisee === true,
      publie: a.publie === true,
      seanceLabel: seanceLabel,
    });
  }
  return { avis: avis };
});

exports.adminPublishAvis = onCall(async (request) => {
  assertAdmin(request);
  const avisId = request.data && request.data.avisId;
  if (typeof avisId !== "string" || avisId.length === 0) {
    throw new HttpsError("invalid-argument", "avisId manquant");
  }
  const avisRef = db.collection("avis").doc(avisId);
  const avisSnap = await avisRef.get();
  if (!avisSnap.exists) {
    throw new HttpsError("not-found", "AVIS_NOT_FOUND");
  }
  const a = avisSnap.data();
  if (a.publication_autorisee !== true) {
    throw new HttpsError("failed-precondition", "CONSENT_REQUIRED");
  }
  const seanceLabel = await resolveSeanceLabel(a.reservationId);
  await db.collection("avis_publics").doc(avisId).set(avisPublicFromAvis(a, seanceLabel));
  await avisRef.update({ publie: true });
  logger.info("Avis published", { avisId: avisId });
  return { success: true };
});

exports.adminUnpublishAvis = onCall(async (request) => {
  assertAdmin(request);
  const avisId = request.data && request.data.avisId;
  if (typeof avisId !== "string" || avisId.length === 0) {
    throw new HttpsError("invalid-argument", "avisId manquant");
  }
  await db.collection("avis_publics").doc(avisId).delete();
  await db.collection("avis").doc(avisId).update({ publie: false });
  logger.info("Avis unpublished", { avisId: avisId });
  return { success: true };
});
```

- [ ] **Step 3 : Vérifier la syntaxe + suite complète**

Run: `cd functions && node --check index.js && npm test`
Expected: `node --check` OK ; toutes les suites PASS (les tests existants ne dépendent pas de ces fonctions).

- [ ] **Step 4 : Commit**

```bash
git add functions/index.js
git commit -m "feat: fonctions admin listAvis/publishAvis/unpublishAvis (auth requise)"
```

---

### Task 3 : Règle Firestore `avis_publics`

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1 : Ajouter le bloc**

Dans `firestore.rules`, juste après le bloc `match /avis/{avisId} { ... }`, ajouter :

```
    match /avis_publics/{id} {
      allow get, list: if true;
      allow create, update, delete: if false;
    }
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `firebase deploy --only firestore:rules --dry-run 2>&1 | tail -5`
Expected: pas d'erreur de compilation.

- [ ] **Step 3 : Commit**

```bash
git add firestore.rules
git commit -m "feat: regle Firestore lecture publique de avis_publics"
```

---

### Task 4 : Page publique `avis-publics.html`

**Files:**
- Create: `public/avis-publics.html`

**Interfaces:**
- Consumes: collection `avis_publics` (lecture publique).

- [ ] **Step 1 : Créer la page**

Créer `public/avis-publics.html` avec ce contenu exact :

```html
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Avis — Cinéma en plein air d'Opio</title>
<meta name="description" content="Les avis des spectateurs du Cinéma en plein air d'Opio.">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,ital@9..144,300..700,0..1&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--c-bg:#15101F;--c-surface:#241A38;--c-surface-2:#1c1530;--c-gold:#E8A33D;
    --c-gold-soft:rgba(232,163,61,0.16);--c-lavender:#9B86C9;--c-ivory:#F6F1E7;
    --c-muted:#B8AFC9;--c-border:rgba(246,241,231,0.1);--font-display:'Fraunces',serif;--font-body:'Outfit',sans-serif;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:var(--c-bg);color:var(--c-ivory);font-family:var(--font-body);line-height:1.6;
    background-image:radial-gradient(circle at 20% 0%,rgba(155,134,201,.10),transparent 45%),radial-gradient(circle at 85% 90%,rgba(232,163,61,.08),transparent 45%);}
  .site-nav{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:14px;padding:16px 28px;backdrop-filter:blur(12px);background:rgba(21,16,31,.6);border-bottom:1px solid var(--c-border);}
  .brand{font-family:var(--font-display);font-size:1.15rem;color:var(--c-ivory);text-decoration:none;font-weight:600;}
  .brand span{color:var(--c-gold);font-style:italic;}
  .spacer{flex:1;}
  .btn{display:inline-flex;align-items:center;padding:11px 22px;border-radius:999px;background:linear-gradient(135deg,#F4C26B,var(--c-gold));color:#2a1c05;font-weight:600;text-decoration:none;font-size:.88rem;border:0;}
  .btn.btn-ghost{background:transparent;color:var(--c-ivory);border:1px solid var(--c-border);}
  .btn.btn-ghost.active{color:var(--c-gold);border-color:var(--c-gold);}
  .hero{max-width:900px;margin:0 auto;padding:70px 24px 34px;text-align:center;}
  .eyebrow{letter-spacing:.32em;text-transform:uppercase;font-size:.72rem;color:var(--c-gold);font-weight:600;margin-bottom:18px;}
  h1{font-family:var(--font-display);font-size:clamp(2.3rem,6vw,3.6rem);font-weight:600;line-height:1.05;font-style:italic;}
  .hero>p{color:var(--c-muted);max-width:560px;margin:18px auto 0;font-size:1.05rem;}
  .stat{display:none;align-items:center;gap:14px;margin-top:30px;padding:14px 26px;border:1px solid var(--c-border);border-radius:16px;background:var(--c-surface);}
  .stat .score{font-family:var(--font-display);font-size:2rem;color:var(--c-gold);line-height:1;}
  .stat .score small{font-size:1rem;color:var(--c-muted);}
  .stat .stars{font-size:1.05rem;letter-spacing:2px;color:var(--c-gold);}
  .stat .count{color:var(--c-muted);font-size:.9rem;}
  .wrap{max-width:1080px;margin:0 auto;padding:20px 24px 90px;}
  .grid{display:grid;gap:22px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));}
  .card{border:1px solid var(--c-border);border-radius:20px;background:linear-gradient(180deg,var(--c-surface),var(--c-surface-2));padding:26px 26px 22px;display:flex;flex-direction:column;position:relative;overflow:hidden;}
  .card::before{content:"\201C";position:absolute;top:-18px;right:14px;font-family:var(--font-display);font-size:6rem;color:var(--c-gold-soft);line-height:1;}
  .stars{color:var(--c-gold);letter-spacing:3px;font-size:1.05rem;margin-bottom:14px;}
  .stars .empty{color:rgba(232,163,61,.28);}
  .comment{font-size:1.02rem;color:var(--c-ivory);flex:1;white-space:pre-wrap;}
  .meta{margin-top:20px;padding-top:16px;border-top:1px solid var(--c-border);display:flex;align-items:center;gap:12px;}
  .avatar{width:38px;height:38px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;background:var(--c-gold-soft);color:var(--c-gold);font-weight:600;font-family:var(--font-display);}
  .who{font-weight:600;color:var(--c-ivory);font-size:.96rem;}
  .seance{color:var(--c-lavender);font-size:.82rem;}
  .empty-state{margin-top:20px;border:1px dashed var(--c-border);border-radius:20px;padding:60px 24px;text-align:center;background:var(--c-surface);}
  .empty-state .ico{font-size:2.4rem;margin-bottom:14px;color:var(--c-gold);}
  .empty-state h3{font-family:var(--font-display);font-style:italic;font-size:1.5rem;font-weight:500;margin-bottom:8px;}
  .empty-state p{color:var(--c-muted);max-width:420px;margin:0 auto;}
  .cookie-banner{position:fixed;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;background:var(--c-surface);border:1px solid var(--c-border);border-radius:16px;padding:18px 20px;display:none;z-index:50;}
  .cookie-banner.is-visible{display:block;}
  .cookie-banner p{color:var(--c-muted);font-size:.9rem;margin-bottom:12px;}
  .cookie-banner .row{display:flex;gap:10px;justify-content:flex-end;}
  .cookie-banner button{padding:9px 16px;border-radius:999px;border:1px solid var(--c-border);background:transparent;color:var(--c-ivory);cursor:pointer;font-family:inherit;font-size:.85rem;}
  .cookie-banner button.accept{background:var(--c-gold);color:#2a1c05;border:0;font-weight:600;}
  footer{text-align:center;color:var(--c-muted);font-size:.82rem;padding:30px 24px 40px;border-top:1px solid var(--c-border);}
</style>
</head>
<body>
  <nav class="site-nav">
    <a href="/" class="brand">Cinéma <span>Plein Air</span></a>
    <span class="spacer"></span>
    <a href="/" class="btn btn-ghost" style="margin-right:12px;">Programme</a>
    <a href="/avis-publics.html" class="btn btn-ghost active">Avis</a>
  </nav>

  <header class="hero">
    <p class="eyebrow">Cinéma en plein air · Opio</p>
    <h1>Ils en parlent</h1>
    <p>Les retours de nos spectateurs après les projections sous les étoiles.</p>
    <div class="stat" id="stat">
      <div class="score" id="stat-score">–<small>/5</small></div>
      <div>
        <div class="stars" id="stat-stars"></div>
        <div class="count" id="stat-count"></div>
      </div>
    </div>
  </header>

  <div class="wrap">
    <div class="grid" id="grid"></div>
    <div class="empty-state" id="empty" style="display:none;">
      <div class="ico">✦</div>
      <h3>Les premiers avis arriveront bientôt</h3>
      <p>Après chaque séance, nous recueillons les retours des spectateurs. Les avis publiés apparaîtront ici.</p>
    </div>
  </div>

  <footer>© 2026 Oria — Tous droits réservés</footer>

  <div class="cookie-banner" id="cookie-banner">
    <p>Nous utilisons des cookies de mesure d'audience. Vous pouvez accepter ou refuser.</p>
    <div class="row"><button id="cookie-refuse">Refuser</button><button class="accept" id="cookie-accept">Accepter</button></div>
  </div>

<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
  import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
  var firebaseConfig = {
    apiKey: "AIzaSyBB-WiFkZfrHQD9rXDQ6KjbeNQyMlO4VbA",
    authDomain: "cinema-en-pleine-air-opi-ac81e.firebaseapp.com",
    projectId: "cinema-en-pleine-air-opi-ac81e",
    storageBucket: "cinema-en-pleine-air-opi-ac81e.firebasestorage.app",
    messagingSenderId: "245777069404",
    appId: "1:245777069404:web:8478506b55ec08fb8abd99",
    measurementId: "G-R66JNXKKPZ"
  };
  var app = initializeApp(firebaseConfig);
  var db = getFirestore(app);

  function esc(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML;}
  function stars(n){var s='';for(var i=1;i<=5;i++){s+= i<=n ? '★' : '<span class="empty">★</span>';}return s;}
  function initiale(txt){return (txt||'?').trim().charAt(0).toUpperCase();}

  getDocs(collection(db,'avis_publics')).then(function(snap){
    var items=[];
    snap.forEach(function(d){items.push(d.data());});
    items.sort(function(a,b){
      var ta=a.avisCreatedAt&&a.avisCreatedAt.toMillis?a.avisCreatedAt.toMillis():0;
      var tb=b.avisCreatedAt&&b.avisCreatedAt.toMillis?b.avisCreatedAt.toMillis():0;
      return tb-ta;
    });
    var grid=document.getElementById('grid');
    var empty=document.getElementById('empty');
    if(!items.length){empty.style.display='block';return;}
    grid.innerHTML=items.map(function(a){
      return '<article class="card"><div class="stars">'+stars(a.note)+'</div>'+
        '<p class="comment">'+esc(a.commentaire)+'</p>'+
        '<div class="meta"><div class="avatar">'+esc(initiale(a.prenomInitiale))+'</div>'+
        '<div><div class="who">'+esc(a.prenomInitiale)+'</div>'+
        (a.seanceLabel?'<div class="seance">'+esc(a.seanceLabel)+'</div>':'')+'</div></div></article>';
    }).join('');
    var somme=items.reduce(function(t,a){return t+(a.note||0);},0);
    var moy=somme/items.length;
    document.getElementById('stat-score').innerHTML=moy.toFixed(1).replace('.',',')+'<small>/5</small>';
    document.getElementById('stat-stars').innerHTML=stars(Math.round(moy));
    document.getElementById('stat-count').textContent='sur '+items.length+' avis publié'+(items.length>1?'s':'');
    document.getElementById('stat').style.display='inline-flex';
  }).catch(function(){});

  // Bandeau cookies + Analytics (chargé seulement après consentement)
  (function(){
    var KEY='cookie-consent-opio';var banner=document.getElementById('cookie-banner');
    function loadAnalytics(){import("https://www.gstatic.com/firebasejs/10.13.0/firebase-analytics.js").then(function(m){m.getAnalytics(app);}).catch(function(){});}
    var choice=null;try{choice=localStorage.getItem(KEY);}catch(e){}
    if(choice==='accepted'){loadAnalytics();}
    else if(choice!=='refused'&&banner){
      requestAnimationFrame(function(){banner.classList.add('is-visible');});
      var a=document.getElementById('cookie-accept'),r=document.getElementById('cookie-refuse');
      if(a)a.addEventListener('click',function(){try{localStorage.setItem(KEY,'accepted');}catch(e){}banner.classList.remove('is-visible');loadAnalytics();});
      if(r)r.addEventListener('click',function(){try{localStorage.setItem(KEY,'refused');}catch(e){}banner.classList.remove('is-visible');});
    }
  })();
</script>
</body>
</html>
```

- [ ] **Step 2 : Vérifier**

Run: `grep -c "initializeApp(\|avis_publics\|Ils en parlent" public/avis-publics.html`
Expected: ≥ 3. Ouvrir la page (`open public/avis-publics.html`) : l'état vide s'affiche (pas de données en local).

- [ ] **Step 3 : Commit**

```bash
git add public/avis-publics.html
git commit -m "feat: page publique des avis (Ils en parlent) + etat vide"
```

---

### Task 5 : Écran d'administration `admin.html`

**Files:**
- Create: `public/admin.html`

**Interfaces:**
- Consumes: Firebase Auth (login), fonctions `adminListAvis` / `adminPublishAvis` / `adminUnpublishAvis`.

- [ ] **Step 1 : Créer la page**

Créer `public/admin.html` avec ce contenu exact :

```html
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Administration — Avis</title>
<style>
  :root{--bg:#15101F;--surface:#241A38;--gold:#E8A33D;--ivory:#F6F1E7;--muted:#B8AFC9;--border:rgba(246,241,231,0.12);--green:#4ea36b;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:var(--bg);color:var(--ivory);font-family:Arial,Helvetica,sans-serif;line-height:1.5;padding:24px;}
  h1{font-size:1.4rem;margin-bottom:6px;}
  .sub{color:var(--muted);font-size:.9rem;margin-bottom:24px;}
  .login{max-width:360px;margin:60px auto;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px;}
  .login h2{font-size:1.1rem;margin-bottom:16px;}
  .login input{width:100%;padding:11px 12px;margin-bottom:12px;border-radius:8px;border:1px solid var(--border);background:#1c1530;color:var(--ivory);font-size:1rem;}
  .login button,.btn{background:var(--gold);color:#2a1c05;border:0;border-radius:8px;padding:11px 18px;font-weight:bold;cursor:pointer;font-size:.95rem;}
  .err{color:#e88;font-size:.88rem;margin-bottom:10px;min-height:1.1em;}
  .topbar{display:flex;align-items:center;gap:14px;margin-bottom:20px;}
  .topbar .spacer{flex:1;}
  .logout{background:transparent;border:1px solid var(--border);color:var(--ivory);border-radius:8px;padding:8px 14px;cursor:pointer;}
  table{width:100%;border-collapse:collapse;font-size:.9rem;}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:top;}
  th{color:var(--muted);font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;}
  .tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.78rem;}
  .tag.ok{background:rgba(78,163,107,.2);color:#8fd6a8;}
  .tag.no{background:rgba(232,120,120,.18);color:#e8a0a0;}
  .tag.pub{background:rgba(232,163,61,.2);color:var(--gold);}
  .act{padding:7px 12px;border-radius:8px;border:0;cursor:pointer;font-size:.85rem;font-weight:bold;}
  .act.publish{background:var(--gold);color:#2a1c05;}
  .act.publish:disabled{background:#4a4358;color:#8a8398;cursor:not-allowed;}
  .act.unpublish{background:transparent;border:1px solid var(--border);color:var(--ivory);}
  .stars{color:var(--gold);letter-spacing:1px;}
  .muted{color:var(--muted);}
  #content{display:none;}
</style>
</head>
<body>
  <div class="login" id="login">
    <h2>Administration — Connexion</h2>
    <div class="err" id="login-err"></div>
    <input type="email" id="email" placeholder="Email" autocomplete="username">
    <input type="password" id="password" placeholder="Mot de passe" autocomplete="current-password">
    <button id="login-btn">Se connecter</button>
  </div>

  <div id="content">
    <div class="topbar">
      <div><h1>Modération des avis</h1><div class="sub" id="who"></div></div>
      <span class="spacer"></span>
      <button class="logout" id="logout">Déconnexion</button>
    </div>
    <div class="err" id="err"></div>
    <table>
      <thead><tr><th>Séance</th><th>Note</th><th>Commentaire</th><th>Personne</th><th>Consentement</th><th>État</th><th>Action</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <p class="muted" id="empty" style="display:none;margin-top:20px;">Aucun avis reçu pour l'instant.</p>
  </div>

<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
  import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
  import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
  var firebaseConfig = {
    apiKey: "AIzaSyBB-WiFkZfrHQD9rXDQ6KjbeNQyMlO4VbA",
    authDomain: "cinema-en-pleine-air-opi-ac81e.firebaseapp.com",
    projectId: "cinema-en-pleine-air-opi-ac81e",
    storageBucket: "cinema-en-pleine-air-opi-ac81e.firebasestorage.app",
    messagingSenderId: "245777069404",
    appId: "1:245777069404:web:8478506b55ec08fb8abd99",
    measurementId: "G-R66JNXKKPZ"
  };
  var app = initializeApp(firebaseConfig);
  var auth = getAuth(app);
  var functions = getFunctions(app);
  var listAvis = httpsCallable(functions, 'adminListAvis');
  var publishAvis = httpsCallable(functions, 'adminPublishAvis');
  var unpublishAvis = httpsCallable(functions, 'adminUnpublishAvis');

  var loginEl=document.getElementById('login'), contentEl=document.getElementById('content');

  document.getElementById('login-btn').addEventListener('click', function(){
    document.getElementById('login-err').textContent='';
    signInWithEmailAndPassword(auth, document.getElementById('email').value.trim(), document.getElementById('password').value)
      .catch(function(){document.getElementById('login-err').textContent="Email ou mot de passe incorrect.";});
  });
  document.getElementById('logout').addEventListener('click', function(){signOut(auth);});

  onAuthStateChanged(auth, function(user){
    if(user){loginEl.style.display='none';contentEl.style.display='block';document.getElementById('who').textContent=user.email;charger();}
    else{loginEl.style.display='block';contentEl.style.display='none';}
  });

  function esc(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML;}
  function stars(n){var s='';for(var i=1;i<=5;i++){s+=i<=n?'★':'☆';}return s;}

  function charger(){
    document.getElementById('err').textContent='';
    listAvis().then(function(res){
      var avis=(res.data&&res.data.avis)||[];
      var rows=document.getElementById('rows'), empty=document.getElementById('empty');
      document.getElementById('empty').style.display=avis.length?'none':'block';
      rows.innerHTML=avis.map(function(a){
        var consent=a.publication_autorisee?'<span class="tag ok">Oui</span>':'<span class="tag no">Non</span>';
        var etat=a.publie?'<span class="tag pub">Publié</span>':'<span class="muted">—</span>';
        var action=a.publie
          ? '<button class="act unpublish" data-id="'+esc(a.id)+'" data-op="unpublish">Retirer</button>'
          : '<button class="act publish" data-id="'+esc(a.id)+'" data-op="publish"'+(a.publication_autorisee?'':' disabled title="Pas de consentement"')+'>Publier</button>';
        return '<tr><td>'+esc(a.seanceLabel||'—')+'</td><td class="stars">'+stars(a.note)+'</td>'+
          '<td>'+esc(a.commentaire)+(a.film_souhaite?'<br><span class="muted">Film souhaité : '+esc(a.film_souhaite)+'</span>':'')+'</td>'+
          '<td>'+esc(a.prenom)+' '+esc(a.nom)+'<br><span class="muted">'+esc(a.email)+'</span></td>'+
          '<td>'+consent+'</td><td>'+etat+'</td><td>'+action+'</td></tr>';
      }).join('');
      Array.prototype.forEach.call(document.querySelectorAll('.act'), function(btn){
        btn.addEventListener('click', function(){
          var id=btn.getAttribute('data-id'), op=btn.getAttribute('data-op');
          btn.disabled=true;btn.textContent='…';
          var fn=op==='publish'?publishAvis:unpublishAvis;
          fn({avisId:id}).then(function(){charger();}).catch(function(e){
            document.getElementById('err').textContent="Action impossible : "+((e&&e.message)||'erreur');
            charger();
          });
        });
      });
    }).catch(function(e){
      document.getElementById('err').textContent="Chargement impossible : "+((e&&e.message)||'accès refusé');
    });
  }
</script>
</body>
</html>
```

- [ ] **Step 2 : Vérifier**

Run: `grep -c "adminListAvis\|signInWithEmailAndPassword\|noindex" public/admin.html`
Expected: ≥ 3. (Le fonctionnement réel nécessite le compte admin + déploiement — testé à l'étape déploiement.)

- [ ] **Step 3 : Commit**

```bash
git add public/admin.html
git commit -m "feat: ecran d'administration des avis (login Firebase + moderation)"
```

---

### Task 6 : Lien « Avis » dans le menu

**Files:**
- Modify: `public/index.html:469`, `public/seance-2026-07-28.html:875`, `public/seance-2026-08-18.html:875`

- [ ] **Step 1 : index.html**

Remplacer la ligne `  <a href="/" class="btn btn-ghost">Programme</a>` par :

```html
  <a href="/" class="btn btn-ghost" style="margin-right:12px;">Programme</a>
  <a href="/avis-publics.html" class="btn btn-ghost">Avis</a>
```

- [ ] **Step 2 : les 2 pages séance**

Dans `public/seance-2026-07-28.html` ET `public/seance-2026-08-18.html`, après la ligne `  <a href="/" class="btn btn-ghost" style="margin-right:12px;">Programme</a>`, insérer :

```html
  <a href="/avis-publics.html" class="btn btn-ghost" style="margin-right:12px;">Avis</a>
```

- [ ] **Step 3 : Vérifier**

Run: `grep -c 'avis-publics.html' public/index.html public/seance-2026-07-28.html public/seance-2026-08-18.html`
Expected: chaque fichier renvoie `1`.

- [ ] **Step 4 : Commit**

```bash
git add public/index.html public/seance-2026-07-28.html public/seance-2026-08-18.html
git commit -m "feat: lien Avis dans le menu de navigation"
```

---

### Task 7 : Note de version + guide

**Files:**
- Create: `releases/v15.md`
- Modify: `releases/README.md`, `GUIDE.md`

- [ ] **Step 1 : Note de version**

Créer `releases/v15.md` :

```markdown
# v15 — 2026-07-27

Page publique d'avis (« Ils en parlent ») + écran d'administration modéré.

## Nouveautés

- **Page publique `avis-publics.html`** : affiche les avis approuvés (étoiles,
  commentaire, « Prénom I. — séance du … »), note moyenne, et un état vide tant
  qu'il n'y a pas d'avis. Lien « Avis » ajouté au menu.
- **Écran d'administration `admin.html`** (adresse non listée, protégée par
  login) : l'exploitant voit les avis reçus et publie/retire chacun. Le bouton
  « Publier » est bloqué sans consentement de la personne.
- **Confidentialité** : la page publique lit une collection dédiée `avis_publics`
  qui ne contient jamais l'email ni le nom complet — seulement prénom + initiale.

## Technique

- Collection `avis_publics` (lecture publique, écrite par les fonctions).
- Module pur `functions/avis-public-logic.js` (nettoyage, testé).
- Fonctions `adminListAvis` / `adminPublishAvis` / `adminUnpublishAvis`,
  réservées à l'administrateur authentifié (Firebase Auth, garde par email).
- Règle Firestore : lecture publique de `avis_publics`.

## Mise en place (à faire une fois)

Activer le fournisseur « Email/Mot de passe » dans Firebase Authentication et
créer le compte administrateur (email de l'exploitant + mot de passe).
```

- [ ] **Step 2 : Index des versions**

Dans `releases/README.md`, ajouter en haut de la liste `## Versions` :

```markdown
- [v15](v15.md) — 2026-07-27 — Page publique d'avis (« Ils en parlent ») + écran d'administration modéré.
```

- [ ] **Step 3 : Guide**

Dans `GUIDE.md`, ajouter une section « 💬 Publier et modérer les avis » qui explique :
- que la page publique est `avis-publics.html` (lien « Avis » du menu) ;
- que l'écran d'admin est à l'adresse `…/admin.html` (à garder pour soi), protégé par login ;
- **la mise en place unique du compte admin** : Console Firebase → Authentication → activer « Email/Mot de passe » → onglet Users → ajouter un utilisateur avec l'email de l'exploitant et un mot de passe choisi ;
- qu'un avis n'apparaît publiquement que si la personne a coché le consentement ET que l'exploitant a cliqué « Publier » ;
- que seules les initiales (prénom + première lettre du nom) sont montrées, jamais l'email ni le nom complet.

- [ ] **Step 4 : Commit**

```bash
git add releases/v15.md releases/README.md GUIDE.md
git commit -m "docs: note de version v15 + guide moderation des avis"
```

---

## Déploiement (contrôleur, après implémentation — hors tâches)

1. `cd functions && npm test` (tout vert).
2. `firebase deploy --only functions,firestore:rules` puis déploiement hosting (préversion : `firebase hosting:channel:deploy preview-multiseances`).
3. **Mise en place Auth (exploitant)** : activer Email/Mot de passe + créer le compte admin.
4. Vérifs : `avis-publics.html` (état vide) ; login `admin.html` OK ; publier un avis de test → apparaît en public en prénom+initiale ; retirer → disparaît ; avis sans consentement → « Publier » bloqué.

## Notes

- Ne pas lancer `firebase functions:secrets:access`.
- `admin.html` n'est pas listé dans la navigation (accès direct + login).
