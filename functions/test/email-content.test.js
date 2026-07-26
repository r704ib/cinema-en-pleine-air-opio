const {
  buildCancelUrl,
  buildVisitorConfirmationEmail,
  buildOriaNewReservationEmail,
  buildOriaCancellationEmail,
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
  expect(url).toBe("https://cinema-en-pleine-air-opio.oria-events.fr/annuler.html?id=abc123");
});

test("buildVisitorConfirmationEmail addresses the visitor and includes the cancel link", () => {
  const email = buildVisitorConfirmationEmail(sampleReservation, "abc123");
  expect(email.to).toBe("jean@example.com");
  expect(email.htmlContent).toContain("3 place(s)");
  expect(email.htmlContent).toContain("abc123");
});

test("buildOriaNewReservationEmail is addressed to Oria and lists quantities", () => {
  const email = buildOriaNewReservationEmail(sampleReservation);
  expect(email.to).toBe("Oria.ei@outlook.fr");
  expect(email.htmlContent).toContain("Jean Dupont");
  expect(email.htmlContent).toContain("13 €");
});

test("buildOriaCancellationEmail mentions the freed places", () => {
  const email = buildOriaCancellationEmail(sampleReservation);
  expect(email.htmlContent).toContain("Places libérées : 3");
});
