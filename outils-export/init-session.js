// Crée/maj le document meta/session (Opio) — feedback DÉSACTIVÉ par défaut.
const path = require("path");
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, "cle-admin.json"))) });
const db = admin.firestore();

db.collection("meta").doc("session").set({
  sessionDate: new Date(2026, 6, 28, 20, 30, 0), // 28/07/2026 20h30
  feedbackEnabled: false,                        // inerte : aucun envoi automatique
}, { merge: true }).then(function () {
  console.log("meta/session créé (feedbackEnabled: false).");
  process.exit(0);
}).catch(function (e) { console.error(e); process.exit(1); });
