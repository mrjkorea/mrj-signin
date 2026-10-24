/**
 * ONE-TIME (approved by Jay 2026-10-24 03:42 KST): delete ClassroomMetrics rows with
 * received_at < 2026-10-01 00:00 KST, ONLY after verifying they exist in the archive
 * 'MRJ Classroom Metrics ARCHIVE 2026'. Add as a new script file in the MRJ Sign-In
 * project (it uses SPREADSHEET_ID / METRICS_SHEET / BACKFILL_PROP from Code.gs).
 *
 *   1. Run purgeOldClassroomMetricsDryRun  -> read the log (no changes).
 *   2. If ok:true, run purgeOldClassroomMetrics -> deletes rows 2..N.
 *   3. Remove this file afterwards.
 *
 * Touches only the ClassroomMetrics tab (rows 2..N). Never logs cell contents.
 */
var PURGE_ARCHIVE_ID = "1_Q8IltvVn_vbEsxN-0YdeeTc674dyJfhHhimcZy0Znw";
var PURGE_EXPECTED_ARCHIVE_ROWS = 128304;
var PURGE_CUTOFF_MS = Date.parse("2026-10-01T00:00:00+09:00");

function purgeOldClassroomMetricsDryRun() { return purgeOldClassroomMetrics_(true); }
function purgeOldClassroomMetrics() { return purgeOldClassroomMetrics_(false); }

function purgeParseMs_(v) {
  if (v instanceof Date) return v.getTime();
  var s = String(v == null ? "" : v).trim();
  if (!s) return NaN;
  // No explicit zone -> treat as KST
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = s.replace(" ", "T") + "+09:00";
  return Date.parse(s);
}
function purgeKst_(ms) {
  return isFinite(ms) ? Utilities.formatDate(new Date(ms), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss 'KST'") : "unparseable";
}

function purgeOldClassroomMetrics_(dryRun) {
  var out = { ok: false, dryRun: dryRun };
  function done(o) { Logger.log(JSON.stringify(o)); return o; }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { out.error = "script_lock_busy"; return done(out); }
  try {
    // 1. backfill must not be mid-run (its cursor is a row number; deleting rows would corrupt it)
    var cur = PropertiesService.getScriptProperties().getProperty(BACKFILL_PROP);
    if (cur) { out.error = "backfill_in_progress"; out.backfillCursor = cur; return done(out); }
    var trig = [];
    try {
      trig = ScriptApp.getProjectTriggers().filter(function (t) {
        return /backfill/i.test(t.getHandlerFunction());
      });
    } catch (e) { out.triggerCheck = "skipped_no_scope"; }
    if (trig.length) { out.error = "backfill_trigger_present"; out.triggers = trig.length; return done(out); }

    // 2. live sheet
    var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(METRICS_SHEET);
    if (!sh) { out.error = "no_metrics_tab"; return done(out); }
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    var col = header.indexOf("received_at");
    if (col < 0) { out.error = "no_received_at_header"; return done(out); }
    out.liveRowsBefore = lastRow - 1; out.liveCols = lastCol;
    var rec = sh.getRange(2, col + 1, lastRow - 1, 1).getValues();
    var ms = rec.map(function (r) { return purgeParseMs_(r[0]); });

    // exact last row with received_at < cutoff; rows 2..N must ALL be < cutoff
    var lastPre = -1, preTotal = 0, unparse = 0;
    for (var i = 0; i < ms.length; i++) {
      if (!isFinite(ms[i])) { unparse++; continue; }
      if (ms[i] < PURGE_CUTOFF_MS) { lastPre = i; preTotal++; }
    }
    var N = lastPre + 2; // sheet row
    out.lastPreCutoffRow = N; out.lastPreCutoffAt = lastPre >= 0 ? purgeKst_(ms[lastPre]) : null;
    out.preCutoffRowsTotal = preTotal; out.unparseableReceivedAt = unparse;
    if (lastPre < 0) { out.error = "nothing_to_delete"; return done(out); }
    for (var j = 0; j <= lastPre; j++) {
      if (!isFinite(ms[j]) || ms[j] >= PURGE_CUTOFF_MS) {
        out.error = "non_contiguous_rows_before_N"; out.badRow = j + 2; out.badAt = purgeKst_(ms[j]); return done(out);
      }
    }
    out.rowAfterN_at = lastPre + 1 < ms.length ? purgeKst_(ms[lastPre + 1]) : null;
    out.row128305_at = ms.length >= 128304 ? purgeKst_(ms[128303]) : null;
    out.row128306_at = ms.length >= 128305 ? purgeKst_(ms[128304]) : null;
    var del = N - 1;

    // 3. archive verification
    var arcSs = SpreadsheetApp.openById(PURGE_ARCHIVE_ID);
    var arc = arcSs.getSheetByName(METRICS_SHEET) || arcSs.getSheets()[0];
    var aLast = arc.getLastRow(), aCol = arc.getLastColumn();
    out.archiveRows = aLast - 1; out.archiveCols = aCol;
    if (aLast - 1 !== PURGE_EXPECTED_ARCHIVE_ROWS) { out.error = "archive_row_count_unexpected"; return done(out); }
    if (aCol !== lastCol) { out.error = "archive_col_count_mismatch"; return done(out); }
    var aHeader = arc.getRange(1, 1, 1, aCol).getValues()[0].map(function (h) { return String(h).trim(); });
    if (aHeader.join("\u0001") !== header.join("\u0001")) { out.error = "archive_header_mismatch"; return done(out); }
    if (del !== aLast - 1) {
      out.error = "pre_cutoff_count_ne_archive"; out.wouldDelete = del; return done(out);
    }
    // received_at must match row-for-row for all rows
    var aMs = arc.getRange(2, col + 1, del, 1).getValues().map(function (r) { return purgeParseMs_(r[0]); });
    for (var k = 0; k < del; k++) {
      if (aMs[k] !== ms[k]) { out.error = "archive_received_at_mismatch"; out.badRow = k + 2; return done(out); }
    }
    // full-row compare on first, last and every 997th row (values only, never logged)
    var idx = [2, N]; for (var r = 2; r <= N; r += 997) idx.push(r);
    for (var m = 0; m < idx.length; m++) {
      var a = JSON.stringify(sh.getRange(idx[m], 1, 1, lastCol).getDisplayValues()[0]);
      var b = JSON.stringify(arc.getRange(idx[m], 1, 1, lastCol).getDisplayValues()[0]);
      if (a !== b) { out.error = "archive_row_mismatch"; out.badRow = idx[m]; return done(out); }
    }
    out.sampledRowsCompared = idx.length;
    out.wouldDelete = del;
    out.expectedRemaining = lastRow - 1 - del;
    if (dryRun) { out.ok = true; return done(out); }

    // 4. delete
    sh.deleteRows(2, del);
    SpreadsheetApp.flush();
    out.deleted = del;
    out.remaining = sh.getLastRow() - 1;
    out.firstRemainingAt = out.remaining > 0 ? purgeKst_(purgeParseMs_(sh.getRange(2, col + 1).getValue())) : null;
    out.ok = true;
    return done(out);
  } catch (e) {
    out.error = "exception: " + e; return done(out);
  } finally {
    lock.releaseLock();
  }
}
