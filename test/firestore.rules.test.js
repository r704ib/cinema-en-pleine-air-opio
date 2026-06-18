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
  getDocs,
  collection,
  runTransaction,
} = require("firebase/firestore");

let testEnv;

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
    await setDoc(doc(context.firestore(), "meta/gauge"), { reserved: 0, updatedAt: new Date() });
  });
});

function validReservation(overrides) {
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

test("creating a valid reservation and incrementing the gauge succeeds", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(
    runTransaction(visitor, async (tx) => {
      const gaugeRef = doc(visitor, "meta/gauge");
      const gaugeSnap = await tx.get(gaugeRef);
      const reservationRef = doc(visitor, "reservations/r1");
      tx.set(reservationRef, validReservation());
      tx.update(gaugeRef, { reserved: gaugeSnap.data().reserved + 3, updatedAt: new Date() });
    })
  );
});

test("a reservation above 10 places is rejected", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(
    runTransaction(visitor, async (tx) => {
      const gaugeRef = doc(visitor, "meta/gauge");
      const gaugeSnap = await tx.get(gaugeRef);
      const reservationRef = doc(visitor, "reservations/r2");
      tx.set(reservationRef, validReservation({ nb_adultes: 11, totalPlaces: 11, montantEstime: 55 }));
      tx.update(gaugeRef, { reserved: gaugeSnap.data().reserved + 11, updatedAt: new Date() });
    })
  );
});

test("a reservation with a filled honeypot is rejected", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(
    runTransaction(visitor, async (tx) => {
      const gaugeRef = doc(visitor, "meta/gauge");
      const gaugeSnap = await tx.get(gaugeRef);
      const reservationRef = doc(visitor, "reservations/r3");
      tx.set(reservationRef, validReservation({ hp: "im-a-bot" }));
      tx.update(gaugeRef, { reserved: gaugeSnap.data().reserved + 3, updatedAt: new Date() });
    })
  );
});

test("a reservation that would push the gauge over 150 is rejected", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "meta/gauge"), { reserved: 149, updatedAt: new Date() });
  });
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(
    runTransaction(visitor, async (tx) => {
      const gaugeRef = doc(visitor, "meta/gauge");
      const gaugeSnap = await tx.get(gaugeRef);
      const reservationRef = doc(visitor, "reservations/r4");
      tx.set(reservationRef, validReservation({ nb_adultes: 2, totalPlaces: 2, montantEstime: 10 }));
      tx.update(gaugeRef, { reserved: gaugeSnap.data().reserved + 2, updatedAt: new Date() });
    })
  );
});

test("cancelling an active reservation and decrementing the gauge succeeds", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "reservations/r5"), validReservation());
    await setDoc(doc(context.firestore(), "meta/gauge"), { reserved: 3, updatedAt: new Date() });
  });
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(
    runTransaction(visitor, async (tx) => {
      const gaugeRef = doc(visitor, "meta/gauge");
      const gaugeSnap = await tx.get(gaugeRef);
      const reservationRef = doc(visitor, "reservations/r5");
      tx.update(reservationRef, { status: "cancelled", cancelledAt: new Date() });
      tx.update(gaugeRef, { reserved: gaugeSnap.data().reserved - 3, updatedAt: new Date() });
    })
  );
});

test("listing all reservations is rejected", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDocs(collection(visitor, "reservations")));
});

test("an arbitrary large jump to the gauge is rejected", async () => {
  const visitor = testEnv.unauthenticatedContext().firestore();
  await assertFails(updateDoc(doc(visitor, "meta/gauge"), { reserved: 150, updatedAt: new Date() }));
});
