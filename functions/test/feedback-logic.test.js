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
