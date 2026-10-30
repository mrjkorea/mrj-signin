# MRJ shared sign-in (`mrj-auth.js`)

Browser sign-in and score history for MRJ classroom apps on GitHub Pages.

**Current client version:** `20261030-cf-login-1.7.0` (`MRJ_AUTH.AUTH_VERSION` / `MRJSignin`)

## Load in an app

```html
<link rel="stylesheet" href="https://mrjkorea.github.io/mrj-signin/mrj-auth.css">
<script src="https://mrjkorea.github.io/mrj-signin/mrj-auth.js"></script>
<script src="https://mrjkorea.github.io/mrj-signin/mrj-auth-boot.js" data-mrj-app="your-app-id"></script>
```

### Boot attributes

| Attribute | Purpose |
|-----------|---------|
| `data-mrj-app` | App id used for pack/score routing (required for correct program mapping). |
| `data-mrj-score-programs` | Optional comma-separated override for score program names in the My scores panel (e.g. `greenzap`). |
| `data-mrj-panel-app` | Optional panel routing override (e.g. `pronounce-whistle` when boot `data-mrj-app` is `pronounce`). |
| `data-mrj-item-include` | Optional regex; only rows whose `item_id` matches are shown. |
| `data-mrj-item-exclude` | Optional regex; matching `item_id` rows are hidden. |
| `data-mrj-chip="off"` | Force-hide the fixed chip (even if a name pill or own-record control exists). |
| `data-mrj-own-record` | On a visible element the app uses for its own score/history UI: hide the MRJ chip and **do not** attach click handlers (the app keeps control). |
| (no attribute) | If a visible `.student-pill` or `[data-mrj-name-pill]` exists, hide the chip and open **My scores** on click/Enter. |
| `data-mrj-chip-top` / `data-mrj-chip-right` | Optional CSS lengths for chip position (e.g. `3.5rem`). |

## Teacher mode (1.5.0)

When the sign-in server returns `role: "teacher"` (allowlisted **Andrew** account only), the client sets an in-memory session flag — never from `localStorage` alone. Re-validated on resume via `progress`.

```javascript
if (MRJSignin.isTeacher()) {
  // unlock screens, levels, days, books, steps; skip gates and timers
}
document.addEventListener("mrj-teacher", function () { /* optional */ });
// <body class="mrj-teacher"> while signed in as teacher
```

Teacher activity is tagged in server saves (`metadata_json.role`) so class metrics stay clean. Students see no change.

## Student name chip

After sign-in (including resume), a fixed top-right chip shows the student id. It avoids overlapping visible controls (buttons, links, selects, pills) by shifting downward while staying right-aligned. On viewports under 480px wide it uses a compact layout (shorter label, ~40vw max width).

Clicking the chip (or the app’s name pill) opens **My progress** for the current app: chart tabs for pack completion and score trends, plus a **Scores** tab with the list view. Sign out is available inside the panel.

Optional vendored charts (loaded on demand when the panel opens):

```html
<script src="https://mrjkorea.github.io/mrj-signin/lib/mrj-device.js"></script>
```

(`mrj-auth.js` also sends a basic device payload on login if `mrj-device.js` is not loaded.)

## Teacher dashboard (GitHub Pages)

`teacher-dashboard.html` — single **teacher password** (Script Property `MRJ_TEACHER_SECRET`; no student account). Class list, per-student charts across apps, and per-app roster view. Uses the same Apps Script deployment as student sign-in.

## My scores panel API

```javascript
MRJ_AUTH.openProgressPanel();  // no-op if not signed in or panel already open; never throws
MRJ_AUTH.closeProgressPanel(); // no-op if not signed in; never throws
MRJ_AUTH.setPanelRowsProvider(function (studentId) {
  // optional: return rows or Promise<rows>
  // { item_id, label?, score_value, score_max, score_pct, local_date }
});
```

The panel fetches **each mapped score program** separately (paged, up to 40×500 rows per program), applies built-in and boot item filters, then merges rows from `setPanelRowsProvider` (same `item_id` → provider wins). It does **not** change sign-in state (`state.id` / `state.token`). Loading state, error + **Retry**, Esc / backdrop / × close, and `sessionGen` guards apply.

If there are no rows after filtering/merge, the panel shows **No scores yet.**

## Friendly item labels

If the app defines:

```javascript
window.MRJ_ITEM_LABELS = {
  "u01:lesson-1": "Unit 1 · Lesson 1"
};
```

the panel shows the label as the title and the raw `item_id` as secondary text. Provider rows may also supply `label`.

## Score program mapping (built-in)

| `data-mrj-app` | Programs fetched | Item filter notes |
|----------------|------------------|-------------------|
| `word-master` | `word-master` | Excludes day2 pack ids `/^(basic_[abc]|int[23][abc])_u\d+:/` |
| `day2-words` | `day2-words`, `word-master` | `word-master` rows only if they match the day2 pack regex |
| `day3-workbook` | `day3-workbook`, `conversation` | |
| `mrj-zap-grammar-books` | `greenzap` | |
| `pronounce` | `pronounce` | Excludes `^whistle:` |
| `pronounce-whistle` (path or `data-mrj-panel-app`) | `pronounce` | Only `^whistle:` |
| `mrj-decodable-try-41` | `decodable` | Only `mlr_dec_041`–`070` prefixes |
| `mrj-decodable-try-71` | `decodable` | Only `mlr_dec_071`–`100` prefixes |
| Others | same as app id | |

Override programs with `data-mrj-score-programs`. Unmapped apps fall back to a single fetch using the app id as program.

## Develop & test

```bash
npm test
node --check mrj-auth.js
node --check mrj-auth-boot.js
npm run screenshots   # optional; writes to screenshots/ (gitignored)
```
