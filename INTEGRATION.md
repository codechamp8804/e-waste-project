# EcoCircuit — Backend, ML & Supabase Integration Guide

This guide takes the EcoCircuit website from "runs on localhost" to "signs users in
with Supabase and classifies real devices with a trained ML model." Follow it top to
bottom the first time; each section is self-contained for later reference.

---

## 1. How the pieces fit together

EcoCircuit has three moving parts, deliberately decoupled:

```
                    ┌─────────────────────────────┐
   Browser  ──────▶ │  React frontend (Vite)      │
                    │  src/EcoCircuit.tsx          │
                    └───────────┬─────────┬────────┘
                                │         │
              auth + database   │         │  device attributes
              (@supabase-js)    │         │  (fetch /api/classify)
                                ▼         ▼
                    ┌───────────────┐  ┌──────────────────────────┐
                    │  Supabase     │  │  FastAPI backend (server/)│
                    │  Auth + Postgres│ │  NumPy ridge models       │
                    │  (BaaS)        │  │  artifacts/…model.json     │
                    └───────────────┘  └──────────────────────────┘
```

The key design decision: **the frontend talks to Supabase directly** for auth and for
saving/reading submissions (protected by Row-Level Security), while **the FastAPI
backend does one job — run the ML model**. The backend needs no database credentials
and holds no secrets, which keeps it trivial to deploy and impossible to leak keys from.

What is real ML vs. rule-based (be honest about this in the demo):

- **ML (trained, NumPy ridge regression):** the monetary **value predictions** —
  resale value, refurbishment value & cost, recycling & material-recovery value.
  Five regression models, all with held-out **R² ≥ 0.97**, trained on the real
  10,000-row laptop dataset. No scikit-learn — the models are closed-form ridge
  regressions in NumPy, serialised as plain JSON.
- **Rule-based (and deliberately so):** the resell / refurbish / recycle **pathway
  selection**. The dataset has *no learnable pathway label* (every row is labelled
  "Recycle"; its suitability/probability fields are price proxies uncorrelated with
  condition — see `artifacts/README.md`), so the backend routes with a transparent
  economic rule over the *ML-predicted* resale value plus condition and age. Also
  rule-based: partner matching (static list) and commission (5% of resale).
- **Laptops vs. other device types:** the trained models are laptop-specific (the
  dataset is laptops). For laptops the response carries `model_used: true`. For
  Phone/Tablet/TV/AC — or if no model file is present — the backend falls back to a
  deterministic economic heuristic (`model_used: false`), so the API always answers.
- **Roadmap seam:** the photo-upload step is wired but optional. Condition is taken
  from the form today; a CLIP model can later read condition from the photo and feed
  the same pipeline (see §8b).

---

## 2. Prerequisites

- **Node.js 18+** and npm (the frontend uses Vite 8 / React 19).
- **Python 3.10+** for the backend.
- A free **Supabase** account: https://supabase.com

---

## 3. Set up Supabase (auth + database)

1. **Create a project.** In the Supabase dashboard, click *New project*, give it a
   name, choose a region close to you, and set a database password (you won't need it
   for this app, but keep it safe).

2. **Create the tables + security policies.** Open *SQL Editor → New query*, paste the
   entire contents of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
   This creates:
   - `profiles` — one row per user, storing their `account_type` (individual/business).
   - `submissions` — one row per classified device (the saved ML result).
   - Row-Level Security so each user can only see their own rows.
   - A trigger that auto-creates a profile the moment someone signs up.

3. **Grab your API keys.** Go to *Project Settings → API* and copy:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (a long JWT-looking string — safe to ship in the browser)

4. **(Optional) Enable Google sign-in.** *Authentication → Providers → Google →* enable
   it, then paste a Google OAuth client ID/secret (from Google Cloud Console) and add
   your site URL (`http://localhost:5173`) to the authorised redirect URLs. If you skip
   this, the "Continue with Google" button will simply return an error; email/password
   works regardless.

5. **(Optional) Turn off email confirmation for faster demoing.** *Authentication →
   Sign In / Providers → Email →* toggle *Confirm email* off. With it **on** (the
   default), signing up shows "check your inbox to confirm" and no session is created
   until the user clicks the link — the app already handles both cases.

---

## 4. Configure the frontend `.env`

From the project root:

```bash
cp .env.example .env
```

Edit `.env` and fill in the two Supabase values from step 3.3:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
VITE_API_URL=http://localhost:8000
```

`VITE_API_URL` points at the FastAPI backend from §6. Vite only reads env vars at
startup, so **restart `npm run dev` after editing `.env`**. If the two Supabase vars
are missing, the app still boots but the login screen shows a helpful "Supabase isn't
configured" message instead of failing silently.

---

## 5. Train the ML model (backend)

The repo ships with the labelled dataset at `artifacts/laptop_dataset.csv`
(10,000 laptops) **and a model already trained** at `artifacts/ecocircuit_model.json`,
so the backend works out of the box. To retrain from the `server/` directory:

```bash
cd server
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt

python train_models.py
```

`train_models.py` reads `artifacts/laptop_dataset.csv`, fits five ridge-regression
value models (resale / refurbishment value & cost / recycling & material-recovery
value), prints held-out R²/MAE for each, and writes the model bundle to
`artifacts/ecocircuit_model.json` plus `artifacts/metrics.json`. Training needs only
**numpy + pandas** — there is no scikit-learn or joblib dependency, and the model is
plain JSON. Full details of the models and the data caveats are in
[`artifacts/README.md`](artifacts/README.md).

> **Preprocessing safety:** `value_model.py` is the single source of truth for feature
> building, imported by both the trainer and the server, and `train_models.py` asserts
> that the serving-time row builder reproduces the training matrix exactly — so training
> and serving can never silently drift apart.

> **Fallback behaviour:** if no model file exists (or the device isn't a laptop), the
> backend falls back to a deterministic economic heuristic. `model_used: false` in the
> response tells you the heuristic answered; `true` means the trained models did.

> **Why the pathway is a rule:** the dataset is uniformly labelled "Recycle" and its
> suitability/probability columns are price proxies uncorrelated with condition, so no
> honest pathway *classifier* can be trained from it. The backend instead routes with a
> transparent economic rule over the ML-predicted resale value + condition + age. This
> is a data limitation, documented plainly in `artifacts/README.md`, not a modelling
> shortcut — the *value* predictions are all genuinely learned (R² ≥ 0.97).

> **Legacy note:** `server/train.py` + `server/data/` are the earlier scikit-learn
> prototype and are **deprecated** — use `train_models.py`. They are kept for reference
> only and won't run without scikit-learn.

---

## 6. Run the backend

From the `server/` directory (virtualenv still active):

```bash
uvicorn main:app --reload --port 8000
```

Check it's alive:

```bash
curl http://localhost:8000/api/health
# {"status":"ok","model_loaded":true,"auth_required":false,...}
```

Interactive API docs are at http://localhost:8000/docs. A quick classification test:

```bash
curl -X POST http://localhost:8000/api/classify \
  -H "Content-Type: application/json" \
  -d '{"device_type":"Laptop","brand":"Dell","age_years":4,"condition":"Used"}'
```

### Optional: require a signed-in user for the API

By default the API is open (great for demos). To lock it down, copy
`server/.env.example` to `server/.env` and set `SUPABASE_JWT_SECRET` to your project's
JWT secret (*Supabase → Project Settings → API → JWT Settings → JWT Secret*). The
frontend already attaches the logged-in user's access token to every request, so this
"just works" once set. The `/api/health` response shows `auth_required` so you can
confirm which mode you're in.

---

## 7. Run the frontend

In a second terminal, from the project root:

```bash
npm install      # first time only (adds @supabase/supabase-js)
npm run dev
```

Open http://localhost:5173 and walk the full flow:

1. **Get started → Sign up** with an email + password (pick Individual or Business).
2. **Submit a Device →** choose a type, fill brand / age / condition, (optionally add a
   photo), and hit **Analyze Device**.
3. The frontend POSTs to the backend, shows the **Results** page with the predicted
   pathway, the three values, and a confidence breakdown — and, because you're signed
   in, writes the row to the `submissions` table.
4. Confirm the row landed: Supabase dashboard → *Table Editor → submissions*.

---

## 8. Swapping in a real / larger dataset

The models are defined entirely by `server/value_model.py`, which is the single source
of truth for features and targets. To train on a different or larger dataset:

1. **Match the columns.** The feature columns are listed in `value_model.py` as
   `NUMERIC_FEATURES` (18, e.g. `Price_INR`, `Device_Age_Years`,
   `Overall_Device_Health_Percentage`, `Repairability_Score`) and
   `CATEGORICAL_FEATURES` (20, e.g. `Brand`, `Processor`, `Screen_Condition`,
   `Hazard_Level`). The regression targets are in `TARGETS` (the five `*_value_inr` /
   `*_cost_inr` columns). Missing numerics are median-filled and unseen categories fall
   into a `__NA__` bucket automatically, so partial data is tolerated.

2. **Point the trainer at it and retrain:**

   ```bash
   python train_models.py --data /path/to/your.csv
   ```

   Re-run writes a fresh `artifacts/ecocircuit_model.json`; restart the backend to load it.

3. **To change the feature or target set,** edit the lists in `value_model.py` — the
   one-hot encoder and design-matrix order adapt automatically, and the training/serving
   consistency assertion guards against mistakes.

If your data instead contains a *genuine, varied* pathway label (unlike this dataset,
where it is constant — see `artifacts/README.md`), you could add a classifier; the
current economic rule lives in `_pathway_from_values()` in `model_service.py` and is the
one place pathway logic needs to change.

> **Converting from `.xlsx`:** the source dataset was delivered as Excel. Convert once
> with pandas (`pd.read_excel(...).to_csv(...)`, needs `openpyxl`) and drop the CSV into
> `artifacts/`.

## 8b. Adding CLIP photo-based condition detection (roadmap)

The submit form already collects a photo. To make it functional later: send the image
to a new backend endpoint, run CLIP (or any vision model) to predict `condition`, then
feed that condition into the existing `model_service.classify()` — nothing downstream
changes. The `condition` field is the single integration point.

---

## 9. Troubleshooting

- **Login says "Supabase isn't configured."** `.env` is missing the two `VITE_SUPABASE_`
  values, or the dev server wasn't restarted after adding them.
- **"Classification failed … is the ML backend running?"** The FastAPI server isn't up
  on `VITE_API_URL`. Start it with `uvicorn main:app --port 8000` and confirm
  `/api/health`.
- **CORS error in the browser console.** Add your frontend origin to `FRONTEND_ORIGIN`
  in `server/.env` (comma-separated for multiple), then restart uvicorn. The Vite dev
  and preview ports are already allowed.
- **Sign-up succeeds but nothing happens.** Email confirmation is on (the default) — the
  app shows a "check your inbox" notice and no session exists until the link is clicked.
  Disable it (step 3.5) for frictionless demos.
- **Submissions aren't saved.** Saving is a no-op when signed out by design. Sign in
  first; RLS guarantees a user can only ever write their own rows.
- **`model_loaded` is false / results say `model_used: false`.** For laptops this means
  `artifacts/ecocircuit_model.json` is missing — run `python train_models.py`. For
  Phone/Tablet/TV/AC, `model_used: false` is expected: the trained models are
  laptop-specific and other types use the economic heuristic by design.

---

## 10. File map (what was added for this integration)

```
server/
  main.py                 FastAPI app — /api/classify, /api/health, optional JWT auth
  model_service.py        loads the JSON model; classify(); rule-based pathway; heuristic fallback
  value_model.py          shared ML core — features, ridge fit, predict (no sklearn)
  train_models.py         trains the 5 value models, writes artifacts/*.json
  requirements.txt        Python deps (fastapi, numpy, pandas, … — no sklearn/joblib)
  .env.example            backend config (FRONTEND_ORIGIN, SUPABASE_JWT_SECRET)
  train.py, data/         DEPRECATED sklearn prototype (kept for reference only)
artifacts/
  laptop_dataset.csv      labelled dataset (10,000 laptops × 120 columns)
  ecocircuit_model.json   trained model bundle loaded by the backend
  metrics.json            held-out R²/MAE per model (rewritten each training run)
  README.md               model details, metrics, and the pathway-label caveat
supabase/
  schema.sql              tables + RLS + signup trigger (run once in SQL Editor)
src/
  lib/supabase.ts         Supabase client (reads VITE_ env vars)
  lib/api.ts              classifyDevice(), saveSubmission(), listSubmissions()
  EcoCircuit.tsx          UI wired to real auth + the ML API
.env.example              frontend config (VITE_SUPABASE_*, VITE_API_URL)
```
