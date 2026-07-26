// Export des réservations vers un fichier Excel (.xlsx)
// Usage : node export-reservations.js
// Nécessite le fichier de clé "cle-admin.json" dans ce dossier (voir README).

const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");
const ExcelJS = require("exceljs");

const KEY_PATH = path.join(__dirname, "cle-admin.json");

if (!fs.existsSync(KEY_PATH)) {
  console.error("\n❌ Fichier de clé introuvable : " + KEY_PATH);
  console.error("   Suis les étapes du README pour télécharger 'cle-admin.json'.\n");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(KEY_PATH)),
});

const db = admin.firestore();

// Formate une date Firestore (Timestamp) en texte lisible FR
function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

async function main() {
  console.log("Lecture des réservations…");
  const snap = await db.collection("reservations").orderBy("createdAt", "asc").get();

  const rows = [];
  let totalPlacesActives = 0;

  snap.forEach((doc) => {
    const d = doc.data();
    const active = d.status === "active";
    if (active) totalPlacesActives += Number(d.totalPlaces || 0);
    rows.push({
      statut: active ? "Active" : "Annulée",
      prenom: d.prenom || "",
      nom: d.nom || "",
      email: d.email || "",
      telephone: d.telephone || "",
      adultes: d.nb_adultes ?? "",
      enfants_3_10: d.nb_enfants_3_10 ?? "",
      enfants_moins_3: d.nb_enfants_moins_3 ?? "",
      totalPlaces: d.totalPlaces ?? "",
      montant: d.montantEstime ?? "",
      reservee_le: formatDate(d.createdAt),
      annulee_le: formatDate(d.cancelledAt),
      id: doc.id,
    });
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Réservations");

  ws.columns = [
    { header: "Statut", key: "statut", width: 10 },
    { header: "Prénom", key: "prenom", width: 16 },
    { header: "Nom", key: "nom", width: 16 },
    { header: "Email", key: "email", width: 28 },
    { header: "Téléphone", key: "telephone", width: 16 },
    { header: "Adultes", key: "adultes", width: 9 },
    { header: "Enfants 3-10", key: "enfants_3_10", width: 12 },
    { header: "Enfants -3", key: "enfants_moins_3", width: 11 },
    { header: "Total places", key: "totalPlaces", width: 12 },
    { header: "Montant (€)", key: "montant", width: 12 },
    { header: "Réservée le", key: "reservee_le", width: 18 },
    { header: "Annulée le", key: "annulee_le", width: 18 },
    { header: "Identifiant", key: "id", width: 24 },
  ];

  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8A33D" } };

  rows.forEach((r) => {
    const row = ws.addRow(r);
    if (r.statut === "Annulée") {
      row.font = { color: { argb: "FF999999" }, strike: true };
    }
  });

  // Ligne de total
  ws.addRow({});
  const totalRow = ws.addRow({ nom: "TOTAL places actives :", totalPlaces: totalPlacesActives });
  totalRow.font = { bold: true };

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const outPath = path.join(__dirname, `reservations-${stamp}.xlsx`);
  await wb.xlsx.writeFile(outPath);

  const actives = rows.filter((r) => r.statut === "Active").length;
  const annulees = rows.length - actives;
  console.log(`\n✅ Export terminé : ${path.basename(outPath)}`);
  console.log(`   ${rows.length} réservation(s) : ${actives} active(s), ${annulees} annulée(s).`);
  console.log(`   ${totalPlacesActives} place(s) réservée(s) au total (réservations actives).`);
  console.log(`   Fichier : ${outPath}\n`);
}

main().catch((err) => {
  console.error("Erreur pendant l'export :", err);
  process.exit(1);
});
