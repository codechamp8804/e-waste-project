# Importing sample data into Firestore

This folder contains everything you need to load realistic sample data into your
`devices`, `partners`, and `users` collections.

## Files in this package
- `devices.json` — 8 sample device submissions
- `partners.json` — 6 sample certified recyclers/refurbishers across India
- `users.json` — 7 sample users (4 individuals, 3 businesses with EPR IDs)
- `import.js` — Node.js script that pushes all three JSON files into Firestore
- `serviceAccountKey.json` — **you provide this** (steps below)

---

## Step A — Get your service account key

This is the credential that lets a script (not a browser) talk to your Firestore
database with admin rights.

1. Go to the [Firebase Console](https://console.firebase.google.com/) → select your project.
2. Click the gear icon (top left) → **Project settings**.
3. Go to the **Service accounts** tab.
4. Click **Generate new private key** → confirm.
5. A JSON file downloads. Rename it to `serviceAccountKey.json` and place it in
   this same folder, next to `import.js`.

⚠️ **Never commit this file to GitHub or share it.** It grants full admin access
to your Firestore database. Add it to `.gitignore` immediately.

## Step B — Install Node.js dependencies

Open a terminal in this folder and run:

```bash
npm init -y
npm install firebase-admin
```

## Step C — Run the import

```bash
node import.js
```

You should see output like:

```
Importing 8 records into "devices"...
  Committed batch of 8 documents.
Done: devices

Importing 6 records into "partners"...
  Committed batch of 6 documents.
Done: partners

Importing 7 records into "users"...
  Committed batch of 7 documents.
Done: users

All collections imported successfully.
```

## Step D — Verify in the Firebase Console

Go to **Firestore Database** in the console. You should now see three
collections — `devices`, `partners`, `users` — each populated with documents
using readable IDs like `device_001`, `partner_001`, `user_ind_001`.

---

## Notes on the schema

**devices**
- `status` follows your pipeline: `submitted → matched → picked_up → processed`
- `predictedPath` is one of: `resell`, `refurbish`, `recycle_for_parts`
- `userId` links to a document in `users`

**partners**
- `categoriesAccepted` is an array — used to match against a device's `category`
- `location` is a nested object with `lat`/`lng` for distance-based ranking later

**users**
- `type` is `individual` or `business`
- Business users carry `eprRegistrationId` for the compliance-report feature later

## Re-running the import
The script uses your `docId` field as the actual Firestore document ID, so
re-running `node import.js` will **overwrite** existing docs with the same ID
rather than duplicating them — safe to re-run while you're iterating.

## Next steps (not covered by this script)
- Set Firestore **Security Rules** so only authenticated users can read/write
  their own data (currently your DB is likely wide open or fully locked,
  depending on the mode you picked when creating it).
- Add composite indexes once you start querying `devices` by `status` +
  `userId`, or `partners` by `categoriesAccepted` + `location`.
