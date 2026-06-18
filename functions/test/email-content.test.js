const {
  buildCancelUrl,
  buildVisitorConfirmationEmail,
  buildComiteNewReservationEmail,
  buildComiteCancellationEmail,
} = require("../email-content");

const sampleReservation = {
  prenom: "Jean",
  nom: "Dupont",
  email: "jean@example.com",
  telephone: "0600000000",
  nb_adultes: 2,
  nb_enfants_3_10: 1,
  nb_enfants_moins_3: 0,
  totalPlaces: 3,
  montantEstime: 13,
};

test("buildCancelUrl includes the reservation id", () => {
  const url = buildCancelUrl("abc123");
  expect(url).toBe("https://cinema-en-pleine-air-opio.netlify.app/annuler.html?id=abc123");
});

test("buildVisitorConfirmationEmail addresses the visitor and includes the cancel link", () => {
  const email = buildVisitorConfirmationEmail(sampleReservation, "abc123");
  expect(email.to).toBe("jean@example.com");
  expect(email.htmlContent).toContain("3 place(s)");
  expect(email.htmlContent).toContain("abc123");
});

test("buildComiteNewReservationEmail is addressed to the comité and lists quantities", () => {
  const email = buildComiteNewReservationEmail(sampleReservation);
  expect(email.to).toBe("Oria.ei@outlook.fr");
  expect(email.htmlContent).toContain("Jean Dupont");
  expect(email.htmlContent).toContain("13 €");
});

test("buildComiteCancellationEmail mentions the freed places", () => {
  const email = buildComiteCancellationEmail(sampleReservation);
  expect(email.htmlContent).toContain("Places libérées : 3");
});
