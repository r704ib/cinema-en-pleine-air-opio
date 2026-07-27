// Migration multi-séances : crée les fiches events, backfille eventId.
// Idempotent : ne recrée pas une fiche existante, ne double pas reserved.
const admin = require("firebase-admin");
const serviceAccount = require("./cle-admin.json");
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const EVENT_28 = "opio-2026-07-28";
const EVENT_18 = "opio-2026-08-18";

async function main() {
  // 1. Fiche 28/07 avec reserved = meta/gauge.reserved
  const gaugeSnap = await db.collection("meta").doc("gauge").get();
  const reserved28 = gaugeSnap.exists && gaugeSnap.data().reserved ? gaugeSnap.data().reserved : 0;

  const ref28 = db.collection("events").doc(EVENT_28);
  if (!(await ref28.get()).exists) {
    await ref28.set({
      filmTitre: "Un p'tit truc en plus", filmAuteur: "Un film d'Artus",
      dateLabel: "Mardi 28 juillet 2026",
      dateISO: admin.firestore.Timestamp.fromDate(new Date("2026-07-28T18:30:00Z")),
      lieu: "Cœur du village à Opio 06650",
      portes: "20h30", filmHeure: "21h30", finHeure: "~23h15",
      gaugeMax: 150, maxParResa: 10, reserved: reserved28,
      afficheImg: "affiche.jpg", slug: "seance-2026-07-28", ouvertResa: false,
    });
    console.log("✅ Fiche 28/07 créée (reserved=" + reserved28 + ")");
  } else {
    console.log("• Fiche 28/07 déjà présente, inchangée");
  }

  // 2. Fiche 18/08
  const ref18 = db.collection("events").doc(EVENT_18);
  if (!(await ref18.get()).exists) {
    await ref18.set({
      filmTitre: "Jumanji : Bienvenue dans la jungle", filmAuteur: "de Jake Kasdan",
      dateLabel: "Mardi 18 août 2026",
      dateISO: admin.firestore.Timestamp.fromDate(new Date("2026-08-18T18:30:00Z")),
      lieu: "Cœur du village à Opio 06650",
      portes: "20h30", filmHeure: "21h30", finHeure: "~23h15",
      gaugeMax: 150, maxParResa: 10, reserved: 0,
      afficheImg: "affiche-jumanji.jpg", slug: "seance-2026-08-18", ouvertResa: true,
    });
    console.log("✅ Fiche 18/08 créée");
  } else {
    console.log("• Fiche 18/08 déjà présente, inchangée");
  }

  // 3. Backfill eventId sur les réservations sans eventId
  const resSnap = await db.collection("reservations").get();
  let batch = db.batch(); let count = 0; let total = 0;
  resSnap.forEach(function (d) {
    if (!d.data().eventId) {
      batch.update(d.ref, { eventId: EVENT_28 });
      count++; total++;
      if (count === 400) { batch.commit(); batch = db.batch(); count = 0; }
    }
  });
  if (count > 0) await batch.commit();
  console.log("✅ Backfill eventId sur " + total + " réservation(s)");
}

main().then(function () { console.log("Migration terminée."); process.exit(0); })
  .catch(function (e) { console.error(e); process.exit(1); });
