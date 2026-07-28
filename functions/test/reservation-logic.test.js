const { validateReservationInput, MAX_PLACES, MAX_PER_RESERVATION } = require("../reservation-logic");

function validInput(overrides) {
  return Object.assign(
    {
      eventId: "opio-2026-08-18",
      prenom: "Jean",
      nom: "Dupont",
      email: "jean@example.com",
      telephone: "0600000000",
      nb_adultes: 2,
      nb_enfants_3_10: 1,
      nb_enfants_moins_3: 0,
      hp: "",
    },
    overrides || {}
  );
}

test("MAX_PLACES and MAX_PER_RESERVATION match the global constraints", () => {
  expect(MAX_PLACES).toBe(150);
  expect(MAX_PER_RESERVATION).toBe(10);
});

test("a valid input is accepted and computes totalPlaces and montantEstime", () => {
  const result = validateReservationInput(validInput());
  expect(result.valid).toBe(true);
  expect(result.reservation.totalPlaces).toBe(3);
  expect(result.reservation.montantEstime).toBe(13);
  expect(result.reservation.status).toBe("active");
  expect(result.reservation.cancelledAt).toBeNull();
});

test("a missing prenom is rejected", () => {
  const result = validateReservationInput(validInput({ prenom: "" }));
  expect(result.valid).toBe(false);
  expect(result.errors).toContain("prenom");
});

test("an invalid email is rejected", () => {
  const result = validateReservationInput(validInput({ email: "not-an-email" }));
  expect(result.valid).toBe(false);
  expect(result.errors).toContain("email");
});

test("a reservation of 0 places is rejected", () => {
  const result = validateReservationInput(validInput({ nb_adultes: 0, nb_enfants_3_10: 0, nb_enfants_moins_3: 0 }));
  expect(result.valid).toBe(false);
  expect(result.errors).toContain("totalPlaces");
});

test("a reservation above 10 places is rejected", () => {
  const result = validateReservationInput(validInput({ nb_adultes: 11 }));
  expect(result.valid).toBe(false);
  expect(result.errors).toContain("totalPlaces");
});

test("a filled honeypot is rejected", () => {
  const result = validateReservationInput(validInput({ hp: "im-a-bot" }));
  expect(result.valid).toBe(false);
  expect(result.errors).toContain("hp");
});

test("rejette une reservation sans eventId", () => {
  const res = validateReservationInput({
    prenom: "A", nom: "B", email: "a@b.fr", telephone: "0600000000",
    nb_adultes: 1, nb_enfants_3_10: 0, nb_enfants_moins_3: 0, hp: "",
  }, 10);
  expect(res.valid).toBe(false);
  expect(res.errors).toContain("eventId");
});

test("inclut eventId dans la reservation validee", () => {
  const res = validateReservationInput({
    eventId: "opio-2026-08-18",
    prenom: "A", nom: "B", email: "a@b.fr", telephone: "0600000000",
    nb_adultes: 2, nb_enfants_3_10: 1, nb_enfants_moins_3: 0, hp: "",
  }, 10);
  expect(res.valid).toBe(true);
  expect(res.reservation.eventId).toBe("opio-2026-08-18");
});

test("respecte le maxParReservation passe en argument", () => {
  const base = {
    eventId: "opio-2026-08-18",
    prenom: "A", nom: "B", email: "a@b.fr", telephone: "0600000000",
    nb_adultes: 4, nb_enfants_3_10: 0, nb_enfants_moins_3: 0, hp: "",
  };
  expect(validateReservationInput(base, 3).valid).toBe(false); // 4 > 3
  expect(validateReservationInput(base, 5).valid).toBe(true);  // 4 <= 5
});
