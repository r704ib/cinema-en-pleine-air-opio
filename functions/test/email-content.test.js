const {
  buildCancelUrl,
  buildVisitorConfirmationEmail,
  buildOriaNewReservationEmail,
  buildOriaCancellationEmail,
  buildFeedbackRequestEmail,
  buildFeedbackReminderEmail,
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

test("buildVisitorConfirmationEmail : billet, infos pratiques et lien d'annulation", () => {
  const email = buildVisitorConfirmationEmail(sampleReservation, "abc123");
  expect(email.to).toBe("jean@example.com");
  expect(email.htmlContent).toContain("3 places");
  expect(email.htmlContent).toContain("2 adultes");
  expect(email.htmlContent).toContain("1 enfant (3-10 ans)");
  expect(email.htmlContent).toContain("ABC123"); // reference
  expect(email.htmlContent).toContain("13 €"); // montant
  expect(email.htmlContent).toContain("Opio 06650");
  expect(email.htmlContent).toContain("21h30");
  expect(email.htmlContent).toContain("annuler.html?id=abc123");
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

test("buildFeedbackRequestEmail targets the visitor and links to avis.html", () => {
  const email = buildFeedbackRequestEmail({ email: "jean@example.com", prenom: "Jean" }, "abc123");
  expect(email.to).toBe("jean@example.com");
  expect(email.htmlContent).toContain("Jean");
  expect(email.htmlContent).toContain("/avis.html?id=abc123");
});

test("buildFeedbackReminderEmail includes the avis link and an opt-out link", () => {
  const email = buildFeedbackReminderEmail({ email: "jean@example.com", prenom: "Jean" }, "abc123");
  expect(email.to).toBe("jean@example.com");
  expect(email.htmlContent).toContain("/avis.html?id=abc123");
  expect(email.htmlContent).toContain("stop=1");
});
