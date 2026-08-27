const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const serviceAccount = require("./serviceAccountKey.json");
const devices = require("./devices-dataset.json");

const app = initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore(app);

async function importDevices() {
  const devicesRef = db.collection("devices");
  const batch = db.batch();

  devices.forEach((device) => {
    const docRef = devicesRef.doc(); // auto-generated document ID
    batch.set(docRef, {
      ...device,
      submittedAt: Timestamp.fromDate(new Date(device.submittedAt)),
      updatedAt: Timestamp.fromDate(new Date(device.updatedAt)),
    });
  });

  await batch.commit();
  console.log(`✅ Imported ${devices.length} devices into the "devices" collection`);
  process.exit(0);
}

importDevices().catch((err) => {
  console.error("❌ Import failed:", err);
  process.exit(1);
});
