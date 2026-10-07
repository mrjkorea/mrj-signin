# Manual Apps Script redeploy — sign-in server **1.4.0**

The browser client in `mrj-auth.js` sends `program` and follows paging on the `progress` action. It stays compatible with older deployments (extra fields are ignored until this server is live).

## What changes (see root `Code.gs` and `live/Code.gs-2026-10-07`)

- **APP_VERSION** → **`1.4.0`** (unique; live falsely reported 1.3.0 while running 1.2.0 + patches).
- **`save_pack`**: non-decodable programs store **incoming** JSON (fixes word-master silent drop). **Decodable** keeps book-bag merge. **No** 45k substring truncation; large blobs split across `AppProgress` + `AppProgressMore` (up to 12 × 40k chars).
- **`progress`**: per-student rows from **StudentScoreIndex** only (no 20-row cap, no 4k metrics tail on sign-in). Optional `program` filter; `offset` / `limit` paging (`hasMore`, `total`).
- **Errors**: progress/pack load failures return `{ ok: false, error: "…" }` instead of `ok: true` with `[]`.
- **Reads**: lock-free `progress_` / `load_pack` token checks; **45s account cache**; up to **5 active tokens** per student (`tok1|tok2|…`).
- **`stampNamesFor_`**: removed from sign-in path; run via time trigger `stampRecentNames` (owner installs once).
- **`backfillStudentScoreIndex`**: one-time owner-run rebuild of StudentScoreIndex from full ClassroomMetrics (chunked; re-run until `done: true`).

Preserved in git: **`live/Code.gs-2026-10-07`** = code exported from Drive before this release.

## Redeploy steps (Jay)

1. Open the Apps Script project **MRJ Sign-In** in Drive:  
   `https://drive.google.com/open?id=10zMY7ZHmz9k3ypRpKlIG9yKi7i3MdI8Cr00VFHKZHuwCOhtBFWtjesyU`
2. Replace the editor contents of **`Code.gs`** with **`Code.gs`** from this repo (branch with 1.4.0).
3. **Deploy → Manage deployments**.
4. Click the **pencil (Edit)** on the **existing** Web app deployment (do **not** create a new deployment URL).
5. Set **Version** to **New version**, description e.g. `1.4.0 progress paging + pack fix`, click **Deploy**.
6. Confirm the `/exec` URL is unchanged:  
   `https://script.google.com/macros/s/AKfycbwtJTUO3gbcMrlAwsn1feWxyp7Rw2cxpfe1bOT9v2rxmQHa2Tlc6pFNWAjU6ZAdlD6kFQ/exec`
7. Smoke test: **GET** `/exec` → JSON includes `"version":"1.4.0"`.
8. In the script editor: **Run → `backfillStudentScoreIndex`** repeatedly until the execution log shows `{ done: true }` (or run on a time trigger every minute until complete). Large sheets may need many runs (~800 metrics rows per execution).
9. Optional: **Triggers → Add trigger** → function **`stampRecentNames`**, time-driven, every 10 minutes (replaces stamping on every sign-in).
10. Live test with test account id **`zz_test_mrjmetrics` only** (no other production writes).

## Rollback

**Manage deployments → Version history** → deploy the previous version on the same Web app deployment, or restore `live/Code.gs-2026-10-07` into `Code.gs` and deploy a new version. GET should show the previous `version` string.

## Client (GitHub Pages, this repo)

After server 1.4.0 is live, apps using `mrj-auth-boot.js` automatically send `data-mrj-app` as `program` and page through progress. Helpers:

- `MRJ_AUTH.loadProgressForApp(program?)` — all score rows for one program.
- `MRJ_AUTH.loadPack(program?)` / `MRJ_AUTH.savePack(program?, json)` — blob progress; **save only after successful load** (`MRJ_AUTH.packReady(program)`).

Bump `mrj-auth.js` on Pages when ready (`AUTH_VERSION` `20261007-progress-1.4`).
