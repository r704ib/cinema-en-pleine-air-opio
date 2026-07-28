const {
  validateFeedbackInput,
  normalizeEmail,
  MAX_FEEDBACK_TEXT_LENGTH,
} = require("../feedback-logic");

test("normalizeEmail trims and lowercases", () => {
  expect(normalizeEmail("  Jean@Example.FR ")).toBe("jean@example.fr");
  expect(normalizeEmail(null)).toBe("");
});

test("email mode: valid input keeps reservationId and cleans note/texts", () => {
  const r = validateFeedbackInput({
    mode: "email", reservationId: "abc123",
    note: 4, commentaire: "  super soirée  ", film_souhaite: "Intouchables",
    publication_autorisee: true,
  });
  expect(r.valid).toBe(true);
  expect(r.feedback.mode).toBe("email");
  expect(r.feedback.reservationId).toBe("abc123");
  expect(r.feedback.email).toBeNull();
  expect(r.feedback.note).toBe(4);
  expect(r.feedback.commentaire).toBe("super soirée");
  expect(r.feedback.publication_autorisee).toBe(true);
});

test("email mode: missing reservationId is rejected", () => {
  const r = validateFeedbackInput({ mode: "email", note: 4 });
  expect(r.valid).toBe(false);
  expect(r.errors).toContain("reservationId");
});

test("qr mode: requires a valid email, normalized", () => {
  const ok = validateFeedbackInput({ mode: "qr", email: "A@B.FR", note: 5 });
  expect(ok.valid).toBe(true);
  expect(ok.feedback.email).toBe("a@b.fr");
  expect(ok.feedback.reservationId).toBeNull();

  const bad = validateFeedbackInput({ mode: "qr", email: "not-an-email", note: 5 });
  expect(bad.valid).toBe(false);
  expect(bad.errors).toContain("email");
});

test("note must be an integer between 1 and 5", () => {
  expect(validateFeedbackInput({ mode: "qr", email: "a@b.fr", note: 0 }).valid).toBe(false);
  expect(validateFeedbackInput({ mode: "qr", email: "a@b.fr", note: 6 }).valid).toBe(false);
  expect(validateFeedbackInput({ mode: "qr", email: "a@b.fr", note: 3.5 }).valid).toBe(false);
});

test("publication_autorisee defaults to false when not exactly true", () => {
  const r = validateFeedbackInput({ mode: "qr", email: "a@b.fr", note: 3 });
  expect(r.feedback.publication_autorisee).toBe(false);
});

test("a comment longer than the max is rejected", () => {
  const long = "x".repeat(MAX_FEEDBACK_TEXT_LENGTH + 1);
  const r = validateFeedbackInput({ mode: "qr", email: "a@b.fr", note: 3, commentaire: long });
  expect(r.valid).toBe(false);
  expect(r.errors).toContain("commentaire");
});

const { matchReservationByEmail, selectFeedbackRecipients } = require("../feedback-logic");

test("matchReservationByEmail matches regardless of case/spaces", () => {
  const reservations = [
    { id: "1", email: "Alice@Example.FR" },
    { id: "2", email: "bob@example.fr" },
  ];
  expect(matchReservationByEmail(reservations, " alice@example.fr ").id).toBe("1");
  expect(matchReservationByEmail(reservations, "nobody@x.fr")).toBeNull();
});

function baseParams(overrides) {
  return Object.assign(
    {
      reservations: [],
      events: [{ id: "opio-2026-07-28", sessionDate: new Date(2026, 6, 28, 20, 30, 0) }],
      avisReservationIds: new Set(),
      now: new Date(2026, 6, 29, 9, 0, 0), // J+1 à 9h (le lendemain matin)
    },
    overrides || {}
  );
}

test("ne cible que les reservations d'une seance eligible", () => {
  const out = selectFeedbackRecipients(baseParams({
    reservations: [
      { id: "a", eventId: "opio-2026-07-28", status: "active", email: "a@b.fr", prenom: "A" },
      { id: "b", eventId: "opio-2026-08-18", status: "active", email: "b@b.fr", prenom: "B" },
    ],
  }));
  expect(out.map(function (r) { return r.reservationId; })).toEqual(["a"]);
});

test("une seance avec feedbackEnabled:false est ignoree", () => {
  const out = selectFeedbackRecipients(baseParams({
    events: [{ id: "opio-2026-07-28", sessionDate: new Date(2026, 6, 28, 20, 30, 0), feedbackEnabled: false }],
    reservations: [{ id: "1", eventId: "opio-2026-07-28", status: "active", email: "a@b.fr", prenom: "A" }],
  }));
  expect(out).toEqual([]);
});

test("rien le soir meme (seance pas encore passee)", () => {
  const out = selectFeedbackRecipients(baseParams({
    now: new Date(2026, 6, 28, 23, 0, 0),
    reservations: [{ id: "1", eventId: "opio-2026-07-28", status: "active", email: "a@b.fr", prenom: "A" }],
  }));
  expect(out).toEqual([]);
});

test("les reservants d'une seance future ne recoivent rien", () => {
  const out = selectFeedbackRecipients(baseParams({
    events: [{ id: "opio-2026-08-18", sessionDate: new Date(2026, 7, 18, 20, 30, 0) }],
    reservations: [{ id: "x", eventId: "opio-2026-08-18", status: "active", email: "x@b.fr", prenom: "X" }],
  }));
  expect(out).toEqual([]);
});

test("une seance passee de plus de 14 jours est hors fenetre", () => {
  const out = selectFeedbackRecipients(baseParams({
    events: [{ id: "vieux", sessionDate: new Date(2026, 6, 10, 20, 30, 0) }], // 10 juillet, 19 j avant le 29
    reservations: [{ id: "o", eventId: "vieux", status: "active", email: "o@b.fr", prenom: "O" }],
  }));
  expect(out).toEqual([]);
});

test("deux seances eligibles : chacun ses reservants", () => {
  const out = selectFeedbackRecipients(baseParams({
    events: [
      { id: "e1", sessionDate: new Date(2026, 6, 28, 20, 30, 0) },
      { id: "e2", sessionDate: new Date(2026, 6, 27, 20, 30, 0) },
    ],
    reservations: [
      { id: "a", eventId: "e1", status: "active", email: "a@b.fr", prenom: "A" },
      { id: "b", eventId: "e2", status: "active", email: "b@b.fr", prenom: "B" },
    ],
  }));
  expect(out.map(function (r) { return r.reservationId; }).sort()).toEqual(["a", "b"]);
});

test("first requests: only active, not opted-out, not already asked, no existing avis", () => {
  const out = selectFeedbackRecipients(baseParams({
    reservations: [
      { id: "1", eventId: "opio-2026-07-28", status: "active", email: "a@b.fr", prenom: "A" },
      { id: "2", eventId: "opio-2026-07-28", status: "cancelled", email: "c@b.fr", prenom: "C" },
      { id: "3", eventId: "opio-2026-07-28", status: "active", email: "d@b.fr", prenom: "D", avisOptOut: true },
      { id: "4", eventId: "opio-2026-07-28", status: "active", email: "e@b.fr", prenom: "E", avisRequestSent: true, avisRequestSentAt: new Date(2026, 6, 29, 8, 0, 0) },
    ],
    avisReservationIds: new Set(["1"]),
  }));
  expect(out.map(function (r) { return r.reservationId; })).toEqual([]);
});

test("first request produced for a fresh active reservation", () => {
  const out = selectFeedbackRecipients(baseParams({
    reservations: [{ id: "9", eventId: "opio-2026-07-28", status: "active", email: "z@b.fr", prenom: "Zoe" }],
  }));
  expect(out).toEqual([{ reservationId: "9", type: "request", email: "z@b.fr", prenom: "Zoe" }]);
});

test("reminder after 3 days for someone asked but without avis", () => {
  const out = selectFeedbackRecipients(baseParams({
    now: new Date(2026, 7, 1, 9, 0, 0),
    reservations: [{
      id: "7", eventId: "opio-2026-07-28", status: "active", email: "g@b.fr", prenom: "G",
      avisRequestSent: true, avisRequestSentAt: new Date(2026, 6, 29, 9, 0, 0),
    }],
  }));
  expect(out).toEqual([{ reservationId: "7", type: "reminder", email: "g@b.fr", prenom: "G" }]);
});

test("no reminder if avisRelanceSent already true", () => {
  const out = selectFeedbackRecipients(baseParams({
    now: new Date(2026, 7, 1, 9, 0, 0),
    reservations: [{
      id: "7", eventId: "opio-2026-07-28", status: "active", email: "g@b.fr", prenom: "G",
      avisRequestSent: true, avisRequestSentAt: new Date(2026, 6, 29, 9, 0, 0), avisRelanceSent: true,
    }],
  }));
  expect(out).toEqual([]);
});

test("caps the total at maxPerDay, first requests prioritized", () => {
  const reservations = [];
  for (let i = 0; i < 60; i++) reservations.push({ id: "r" + i, eventId: "opio-2026-07-28", status: "active", email: i + "@b.fr", prenom: "P" + i });
  const out = selectFeedbackRecipients(baseParams({ reservations: reservations, maxPerDay: 50 }));
  expect(out.length).toBe(50);
  expect(out.every(function (r) { return r.type === "request"; })).toBe(true);
});
