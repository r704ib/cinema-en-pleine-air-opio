# 📊 Exporter les réservations en Excel

Cet outil lit toutes les réservations dans Firebase et génère un fichier
**Excel (`.xlsx`)** avec toutes les informations.

---

## 🔑 Étape 1 — Télécharger la clé d'administration (à faire UNE seule fois)

Cette clé autorise l'outil à lire la base de données. **Elle est secrète : ne la
partage avec personne et ne la mets jamais sur internet/GitHub.**

1. Va sur https://console.firebase.google.com et connecte-toi (`oria.ei@outlook.fr`).
2. Ouvre le projet **Cinema-en-pleine-air-Opio**.
3. Clique sur l'engrenage ⚙️ (en haut à gauche) → **Paramètres du projet**.
4. Onglet **« Comptes de service »** (Service accounts).
5. Clique sur le bouton **« Générer une nouvelle clé privée »** → **Générer**.
6. Un fichier `.json` se télécharge. **Renomme-le exactement** `cle-admin.json`
   et place-le **dans ce dossier** (`outils-export/`).

> ✅ Le fichier `cle-admin.json` est automatiquement ignoré par Git : il ne
> partira jamais sur GitHub. Il reste seulement sur ton ordinateur.

---

## ▶️ Étape 2 — Lancer l'export

Ouvre un terminal dans ce dossier et tape :

```bash
npm install      # à faire une seule fois (installe les outils nécessaires)
npm run export   # génère le fichier Excel
```

Un fichier **`reservations-AAAA-MM-JJ-HH-MM.xlsx`** est créé dans ce dossier.
Double-clique dessus pour l'ouvrir dans Excel (ou Numbers / LibreOffice).

Relance `npm run export` quand tu veux un export à jour.

---

## 📋 Ce que contient le fichier

Une ligne par réservation, avec : statut (Active / Annulée), prénom, nom, email,
téléphone, nombre d'adultes / enfants, total de places, montant, date de
réservation, date d'annulation. Les réservations annulées sont **barrées en
gris**. Une ligne en bas donne le **total des places actives**.

---

## 🆘 Besoin d'aide ?

Demande-moi (Claude) de lancer l'export pour toi, ou de te guider pas à pas.
