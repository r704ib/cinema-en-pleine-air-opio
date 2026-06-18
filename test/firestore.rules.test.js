const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  collection,
} = require("firebase/firestore");

let testEnv;

function sampleReservation(overrides) {
  return Object.assign(
    {
      prenom: "Jean",
      nom: "Dupont",
      email: "jean@example.com",
      telephone: "0600000000",
      nb_adultes: 2,
      nb_enfants_3_10: 1,
      nb_enfants_moins_3: 0,
      totalPlaces: 3,
      montantEstime: 13,
      status: "active",
      createdAt: new Date(),
      cancelledAt: null,
      hp: "",
    },
    overrides || {}
  );
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "cinema-opio-test",
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "meta/gauge"), { reserved: 0, updatedAt: new Date() });
    await setDoc(doc(db, "reservations/r1"), sampleReservation());
  });
});

test("a visitor can read the gauge document", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(visitor, "meta/gauge")));
});

test("a visitor can read a reservation by id", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(visitor, "reservations/r1")));
});

test("listing all reservations is rejected", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDocs(collection(visitor, "reservations")));
});

test("a visitor cannot create a reservation directly", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(visitor, "reservations/r2"), sampleReservation()));
});

test("a visitor cannot update a reservation directly", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(updateDoc(doc(visitor, "reservations/r1"), { status: "cancelled" }));
});

test("a visitor cannot delete a reservation directly", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(deleteDoc(doc(visitor, "reservations/r1")));
});

test("a visitor cannot write the gauge directly", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(updateDoc(doc(visitor, "meta/gauge"), { reserved: 150 }));
});
