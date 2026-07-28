const { prenomInitiale, seanceLabelFromDateLabel, avisPublicFromAvis } = require("../avis-public-logic");

test("prenomInitiale : prenom + initiale du nom", () => {
  expect(prenomInitiale("Jean", "Dupont")).toBe("Jean D.");
});

test("prenomInitiale : nom absent -> prenom seul", () => {
  expect(prenomInitiale("Jean", "")).toBe("Jean");
  expect(prenomInitiale("Jean", null)).toBe("Jean");
});

test("prenomInitiale : prenom vide -> 'Un spectateur'", () => {
  expect(prenomInitiale("", "Dupont")).toBe("Un spectateur");
});

test("seanceLabelFromDateLabel retire le jour de la semaine", () => {
  expect(seanceLabelFromDateLabel("Mardi 18 août 2026")).toBe("séance du 18 août 2026");
});

test("seanceLabelFromDateLabel : vide -> ''", () => {
  expect(seanceLabelFromDateLabel("")).toBe("");
});

test("avisPublicFromAvis n'inclut ni email ni nom complet", () => {
  const avis = { prenom: "Jean", nom: "Dupont", email: "jean@x.fr", note: 5, commentaire: "Super", createdAt: 123 };
  const pub = avisPublicFromAvis(avis, "séance du 18 août 2026");
  expect(pub.prenomInitiale).toBe("Jean D.");
  expect(pub.note).toBe(5);
  expect(pub.commentaire).toBe("Super");
  expect(pub.seanceLabel).toBe("séance du 18 août 2026");
  expect(pub.avisCreatedAt).toBe(123);
  const json = JSON.stringify(pub);
  expect(json).not.toContain("Dupont");
  expect(json).not.toContain("jean@x.fr");
});
