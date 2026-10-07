# MRJ shared sign-in (`mrj-auth.js`)

Browser sign-in and score history for MRJ classroom apps on GitHub Pages.

**Current client version:** `20261007-progress-1.4.2` (`MRJ_AUTH.AUTH_VERSION`)

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
| `data-mrj-chip="off"` | Force-hide the fixed chip (even if a name pill exists). Otherwise, a visible `.student-pill` or `[data-mrj-name-pill]` hides the chip and opens the panel on click/Enter. |
| `data-mrj-chip-top` / `data-mrj-chip-right` | Optional CSS lengths for chip position (e.g. `3.5rem`). |

## Student name chip

After sign-in (including resume), a fixed top-right chip shows the student id. It avoids overlapping visible controls (buttons, links, selects, pills) by shifting downward while staying right-aligned. On viewports under 480px wide it uses a compact layout (shorter label, ~40vw max width).

Clicking the chip opens **My scores** for the current app. Sign out is available inside the panel.

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
