/**
 * import.js
 * Bulk-imports devices.json, partners.json, users.json into Firestore.
 *
 * Usage:
 *   node import.js
 *
 * Requires:
 *   - serviceAccountKey.json in this same folder (see README.md for how to get it)
 *   - npm install firebase-admin
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// 1. Initialize the Admin SDK using your service account key
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// 2. Map each JSON file to its target Firestore collection name
const IMPORT_MAP = [
  { file: "devices.json", collection: "devices" },
  { file: "partners.json", collection: "partners" },
  { file: "users.json", collection: "users" },
];

// 3. Firestore batches are capped at 500 writes each — chunk just in case
function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

async function importCollection(fileName, collectionName) {
  const filePath = path.join(__dirname, fileName);
  const records = JSON.parse(fs.readFileSync(filePath, "utf8"));

  console.log(`\nImporting ${records.length} records into "${collectionName}"...`);

  const batches = chunk(records, 500);

  for (const group of batches) {
    const batch = db.batch();

    for (const record of group) {
      const { docId, ...data } = record; // docId used as the Firestore doc ID, rest becomes the document body
      const ref = docId
        ? db.collection(collectionName).doc(docId)
        : db.collection(collectionName).doc(); // auto-ID fallback if no docId given

      batch.set(ref, data);
    }

    await batch.commit();
    console.log(`  Committed batch of ${group.length} documents.`);
  }

  console.log(`Done: ${collectionName}`);
}

async function main() {
  for (const { file, collection } of IMPORT_MAP) {
    await importCollection(file, collection);
  }
  console.log("\nAll collections imported successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
