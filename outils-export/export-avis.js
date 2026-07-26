// Export des avis vers un fichier Excel (.xlsx). Usage : node export-avis.js
const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");
const ExcelJS = require("exceljs");

const KEY_PATH = path.join(__dirname, "cle-admin.json");
if (!fs.existsSync(KEY_PATH)) {
  console.error("\n❌ Clé admin introuvable : " + KEY_PATH + "\n");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
  });
}

async function main() {
  console.log("Lecture des avis…");
  const snap = await db.collection("avis").orderBy("createdAt", "asc").get();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Avis");
  ws.columns = [
    { header: "Note", key: "note", width: 7 },
    { header: "Commentaire", key: "commentaire", width: 45 },
    { header: "Film souhaité", key: "film_souhaite", width: 28 },
    { header: "Prénom", key: "prenom", width: 16 },
    { header: "Nom", key: "nom", width: 16 },
    { header: "Email", key: "email", width: 28 },
    { header: "Source", key: "source", width: 10 },
    { header: "Publication autorisée", key: "publication", width: 20 },
    { header: "Date", key: "date", width: 18 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8A33D" } };

  let total = 0, sommeNotes = 0;
  snap.forEach(function (doc) {
    const d = doc.data();
    total++;
    sommeNotes += Number(d.note || 0);
    ws.addRow({
      note: d.note,
      commentaire: d.commentaire || "",
      film_souhaite: d.film_souhaite || "",
      prenom: d.prenom || "",
      nom: d.nom || "",
      email: d.email || "",
      source: d.source || "",
      publication: d.publication_autorisee ? "Oui" : "Non",
      date: formatDate(d.createdAt),
    });
  });
  ws.addRow({});
  const moyenne = total > 0 ? (sommeNotes / total).toFixed(2) : "-";
  const totalRow = ws.addRow({ commentaire: "Note moyenne :", film_souhaite: moyenne + " / 5", note: total });
  totalRow.font = { bold: true };

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const outPath = path.join(__dirname, "avis-" + stamp + ".xlsx");
  await wb.xlsx.writeFile(outPath);
  console.log("\n✅ Export terminé : " + path.basename(outPath));
  console.log("   " + total + " avis, note moyenne " + moyenne + " / 5.");
  console.log("   Fichier : " + outPath + "\n");
}

main().catch(function (err) { console.error("Erreur :", err); process.exit(1); });
