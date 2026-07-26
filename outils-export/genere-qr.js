// Génère l'image QR (PNG) pointant vers le formulaire d'avis (mode QR).
const path = require("path");
const QRCode = require("qrcode");

const URL = "https://cinema-en-pleine-air-opio.oria-events.fr/avis.html?source=qr";
const OUT = path.join(__dirname, "qr-avis-opio.png");

QRCode.toFile(OUT, URL, { width: 900, margin: 2, color: { dark: "#241A38", light: "#FFFFFF" } })
  .then(function () {
    console.log("✅ QR code généré : " + OUT);
    console.log("   Pointe vers : " + URL);
  })
  .catch(function (err) { console.error("Erreur QR :", err); process.exit(1); });
