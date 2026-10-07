# Manual Apps Script redeploy — sign-in server **1.4.1**

The browser client in `mrj-auth.js` sends `program` and follows paging on the `progress` action. It stays compatible with older deployments (extra fields are ignored until this server is live). **Merge the client PR before or with deploy** so students are never blocked when progress load fails.

## Deploy prerequisite (day2-words repo — S7)

Fix **day2-words** to use its own `program` id and to block `save_pack` until load succeeds **before** deploying 1.4.x. Until then, day2-words and word-master share the `word-master` row; 1.4.x correctly stores incoming JSON (last writer wins).

## What changes (see root `Code.gs` and `live/Code.gs-2026-10-07`)

- **APP_VERSION** → **`1.4.1`** (1.4.0 behavior below, plus pack fixes in this patch).
- **`save_pack` / `load_pack`**: non-decodable programs store **incoming** JSON (fixes word-master freeze). **Decodable** keeps book-bag merge; empty/`{}` incoming does **not** wipe stored books. Chunks in **`AppProgress` (4 columns unchanged)** + **`AppProgressMore`** (part 0 = chunk count, parts 1…n = extra data). **1.4.1**: `textCell_` escapes a leading **`'`** so chunk boundaries never drop a character on reload; **`AppProgressMore` is read once per `save_pack`** (batched `setValues`, single-pass stale-part deletes); max stored progress **`MAX_PROGRESS_TOTAL_CHARS` = 2,000,000** (50 × 40k chunks). **No migration** — existing rows load as before.
- **`progress`**: **StudentScoreIndex** first; if empty for that student, **ClassroomMetrics tail** (12k rows, no 20 cap) until backfill completes. Optional `program` filter; `offset` / `limit` paging (`hasMore`, `total`).
- **Errors**: progress/pack load failures return `{ ok: false, error: "…" }` instead of `ok: true` with `[]`.
- **Reads**: lock-free `progress_` / `load_pack`; **45s account cache**; up to **5 active tokens** per student (`tok1|tok2|…`).
- **`stampNamesFor_`**: off sign-in path; optional time trigger `stampRecentNames`.
- **`backfillStudentScoreIndex`**: no script lock; ~4.5 min per run; merges metrics into index in memory; **never overwrites newer** `updated_at`; cursor in Script Properties. Run repeatedly until `done: true` (far fewer runs than row-by-row upsert).

Preserved in git: **`live/Code.gs-2026-10-07`** = code exported from Drive before this release.

## Rollback impact (S8)

If you roll back to the pre-1.4.0 script after students have used 1.4.0:

| Change on 1.4.0 | After rollback |
|---|---|
| Token cell `t1\|t2\|…` (multi-device) | Live code compares the **whole** cell → **`bad_token`** until the student logs in again on that device. |
| Chunked pack (>40k) in `AppProgressMore` | Live `load_pack` reads only column C → **truncated / corrupt** JSON for large saves. |
| `AppProgress` schema | This release does **not** rename columns; rollback is safe for small single-cell packs. |

**Client note:** `mrj-auth.js` signs students in even when progress load fails (`progressError` set, `[]` progress) and retries in the background, so a brief server outage does not lock the classroom out. Rolling back the server does not by itself clear the browser session; multi-token mismatch is the main forced re-login risk.

## Redeploy steps (Jay)

1. Open the Apps Script project **MRJ Sign-In** in Drive:  
   `https://drive.google.com/open?id=10zMY7ZHmz9k3ypRpKlIG9yKi7i3MdI8Cr00VFHKZHuwCOhtBFWtjesyU`
2. Replace **`Code.gs`** with **`Code.gs`** from this repo (1.4.1).
3. **Deploy → Manage deployments** → **Edit** the **existing** Web app deployment → **New version** (same `/exec` URL).
4. **GET** `/exec` → `"version":"1.4.1"`.
5. **Run → `backfillStudentScoreIndex`** repeatedly until execution log shows `{ done: true }` (each run processes metrics rows for up to ~4.5 minutes).
6. **Pre-create tab `AppProgressMore`** (recommended before first deploy): headers `id_key`, `program`, `part`, `chunk` — avoids a rare race on the first chunked `load_pack`/`save_pack` when the tab does not exist yet.
7. Optional: **Triggers** → `stampRecentNames`, every 10 minutes.
8. Publish updated **`mrj-auth.js`** on GitHub Pages (`AUTH_VERSION` `20261007-progress-1.4`).
9. Live test with **`zz_test_mrjmetrics` only**.

**Backfill:** `backfillStudentScoreIndex` holds a **short script lock only while flushing** each batch to StudentScoreIndex (reads stay lock-free). If flush is busy (`flush_busy: true`), re-run after class; the cursor rewinds that batch. Run when students are idle if possible.

## Rollback procedure

**Manage deployments → Version history** → deploy the previous version, or restore `live/Code.gs-2026-10-07` into `Code.gs` and deploy. Expect multi-token and large-pack caveats above.

## Client helpers (after Pages deploy)

- `MRJ_AUTH.loadProgressForApp(program?)` — paged score rows for one program.
- `MRJ_AUTH.loadPack(program?)` / `MRJ_AUTH.savePack(program?, json)` — blob progress; save only after successful load (`MRJ_AUTH.packReady(program)`).
- `MRJ_AUTH.progressError()` — non-empty when progress did not load (apps must not overwrite server data).
