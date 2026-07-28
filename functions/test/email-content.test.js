const {
  buildCancelUrl,
  buildVisitorConfirmationEmail,
  buildOriaNewReservationEmail,
  buildOriaCancellationEmail,
  buildVisitorCancellationEmail,
  buildFeedbackRequestEmail,
  buildFeedbackReminderEmail,
  buildJourJReminderEmail,
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

const sampleEvent = {
  dateLabel: "Mardi 18 août 2026",
  filmTitre: "Jumanji : Bienvenue dans la jungle",
  lieu: "Cœur du village à Opio 06650",
  portes: "20h30", filmHeure: "21h30", finHeure: "~23h15",
};

test("buildCancelUrl includes the reservation id", () => {
  const url = buildCancelUrl("abc123");
  expect(url).toBe("https://cinema-en-pleine-air-opio.oria-events.fr/annuler.html?id=abc123");
});

test("buildVisitorConfirmationEmail : billet, infos pratiques et lien d'annulation", () => {
  const email = buildVisitorConfirmationEmail(sampleReservation, "abc123", sampleEvent);
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

test("buildVisitorConfirmationEmail : singulier quand une seule place", () => {
  const email = buildVisitorConfirmationEmail(
    { ...sampleReservation, nb_adultes: 1, nb_enfants_3_10: 0, nb_enfants_moins_3: 0, totalPlaces: 1, montantEstime: 5 },
    "abc123",
    sampleEvent
  );
  expect(email.htmlContent).toContain("1 place");
  expect(email.htmlContent).not.toContain("1 places");
});

test("la confirmation utilise la date et le film de l'evenement", () => {
  const email = buildVisitorConfirmationEmail(sampleReservation, "abc123", sampleEvent);
  expect(email.htmlContent).toContain("Mardi 18 août 2026");
  expect(email.htmlContent).toContain("Jumanji : Bienvenue dans la jungle");
  expect(email.htmlContent).not.toContain("28 juillet");
});

test("buildJourJReminderEmail : rappel du jour avec date, film et horaires", () => {
  const email = buildJourJReminderEmail(sampleReservation, sampleEvent);
  expect(email.to).toBe("jean@example.com");
  expect(email.htmlContent).toContain("ce soir");
  expect(email.htmlContent).toContain("Jumanji : Bienvenue dans la jungle");
  expect(email.htmlContent).toContain("Mardi 18 août 2026");
  expect(email.htmlContent).toContain("20h30");
});

test("buildOriaNewReservationEmail is addressed to Oria and lists quantities", () => {
  const email = buildOriaNewReservationEmail(sampleReservation, sampleEvent);
  expect(email.to).toBe("Oria.ei@outlook.fr");
  expect(email.htmlContent).toContain("Jean Dupont");
  expect(email.htmlContent).toContain("13 €");
  expect(email.subject).toContain("Mardi 18 août 2026"); // séance dans l'objet
});

test("buildOriaCancellationEmail mentions the freed places", () => {
  const email = buildOriaCancellationEmail(sampleReservation, sampleEvent);
  expect(email.htmlContent).toContain("Places libérées : 3");
  expect(email.subject).toContain("Mardi 18 août 2026"); // séance dans l'objet
});

test("buildVisitorCancellationEmail : destine au visiteur, mentionne les places liberees", () => {
  const email = buildVisitorCancellationEmail(sampleReservation, "abc123", sampleEvent);
  expect(email.to).toBe("jean@example.com");
  expect(email.htmlContent).toContain("Annulation");
  expect(email.htmlContent).toContain("3 places");
  expect(email.htmlContent).toContain("cinema-en-pleine-air-opio.oria-events.fr");
});

test("buildFeedbackRequestEmail targets the visitor and links to avis.html", () => {
  const email = buildFeedbackRequestEmail({ email: "jean@example.com", prenom: "Jean" }, "abc123", sampleEvent);
  expect(email.to).toBe("jean@example.com");
  expect(email.htmlContent).toContain("Jean");
  expect(email.htmlContent).toContain("/avis.html?id=abc123");
  expect(email.htmlContent).toContain("Donner mon avis"); // bouton
});

test("buildFeedbackReminderEmail includes the avis link and an opt-out link", () => {
  const email = buildFeedbackReminderEmail({ email: "jean@example.com", prenom: "Jean" }, "abc123", sampleEvent);
  expect(email.to).toBe("jean@example.com");
  expect(email.htmlContent).toContain("/avis.html?id=abc123");
  expect(email.htmlContent).toContain("stop=1");
  expect(email.htmlContent).toContain("Ne plus recevoir"); // lien opt-out habille
});

test("les emails d'avis ne contiennent pas de bloc prochaines séances", () => {
  const req = buildFeedbackRequestEmail({ email: "j@x.fr", prenom: "Jean" }, "abc123", sampleEvent);
  const rel = buildFeedbackReminderEmail({ email: "j@x.fr", prenom: "Jean" }, "abc123", sampleEvent);
  expect(req.htmlContent).not.toContain("Nos prochaines séances");
  expect(rel.htmlContent).not.toContain("Nos prochaines séances");
  expect(rel.htmlContent).toContain("stop=1"); // le lien de désinscription reste
});
