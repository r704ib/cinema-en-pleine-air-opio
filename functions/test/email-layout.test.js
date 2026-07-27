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
