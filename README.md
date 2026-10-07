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
| `data-mrj-chip="off"` | Hide the fixed top-right name chip; use your own control and call `MRJ_AUTH.openProgressPanel()`. May be set on the boot script, `<html>`, or `<body>`. |

## Student name chip

After sign-in (including resume), a fixed top-right chip shows the student id. Clicking it opens **My scores** for the current app. Sign out is available inside the panel.

The chip is hidden when nobody is signed in, when `data-mrj-chip="off"` is set, or after sign-out.

## My scores panel API

```javascript
MRJ_AUTH.openProgressPanel();  // no-op if not signed in; never throws
MRJ_AUTH.closeProgressPanel(); // no-op if not signed in; never throws
```

The panel loads **all** pages of the server `progress` action (empty `program`, filtered client-side to this app’s score programs), with loading state, error + **Retry**, and stale-session guards (`sessionGen`).

## Friendly item labels

If the app defines:

```javascript
window.MRJ_ITEM_LABELS = {
  "u01:lesson-1": "Unit 1 · Lesson 1"
};
```

the panel shows the label as the title and the raw `item_id` as secondary text.

## Score program mapping

`data-mrj-app` is mapped to the program name(s) stored in `StudentScoreIndex` / metrics. Override with `data-mrj-score-programs` when needed. Built-in map includes e.g. `day2-words` → `day2-words` + legacy `word-master`, `mrj-zap-grammar-books` → `greenzap`, `day3-workbook` → `day3-workbook` + `conversation`.

## Develop & test

```bash
npm test
node --check mrj-auth.js
node --check mrj-auth-boot.js
```
