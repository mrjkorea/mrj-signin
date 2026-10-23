/**
 * MRJ shared sign-in. Standalone Apps Script web app.
 * Same metrics book as the score receiver. This file does not replace that receiver.
 *
 * Login never creates an account. A missing name stays missing.
 * Passwords are stored for an exact match and are never returned or logged.
 */
var SPREADSHEET_ID = "1bpgekxlektvwpsef1PmIkxPiDuHrkVXFaAy-OmwqL5c";
var APP_VERSION = "1.6.0";
var SIGNIN_TEACHER_ROLE_KEYS = ["andrew"];
var ACCOUNTS_SHEET = "StudentAccounts";
var SCORE_SHEET = "StudentScoreIndex";
var METRICS_SHEET = "ClassroomMetrics";
var PACK_SHEET = "AppProgress";
var PACK_MORE_SHEET = "AppProgressMore";
var ACCOUNT_CACHE_TTL_SEC = 45;
var MAX_ACTIVE_TOKENS = 5;
var PROGRESS_DEFAULT_LIMIT = 500;
var PROGRESS_MAX_LIMIT = 1000;
var CHUNK_CHAR_MAX = 40000;
var MAX_PROGRESS_TOTAL_CHARS = 2000000;
var MAX_PROGRESS_CHUNKS = 51; // 2,000,000 / 40,000 = 50, +1 because a chunk never ends on a high surrogate
var PACK_WRITE_BATCH_ROWS = 10; // <= ~400k chars per setValues call
var METRICS_FALLBACK_TAIL = 12000;
var BACKFILL_PROP = "backfill_score_index_cursor";
var BACKFILL_TIME_BUDGET_MS = 270000;
var WM_PACK_SHARD_PREFIX = "word-master@pack/";
var WM_SCORES_PROGRAM = "word-master@scores";
var TEACHER_IDS_PROP = "MRJ_TEACHER_IDS";
var TEACHER_SECRET_PROP = "MRJ_TEACHER_SECRET";
var TEACHER_SECRET_FAIL_CACHE_KEY = "teacher_secret_fail_count";
var TEACHER_SECRET_FAIL_CACHE_SEC = 600;
var TEACHER_SECRET_FAIL_SLEEP_BASE_MS = 200;
var TEACHER_SECRET_FAIL_SLEEP_MAX_MS = 5000;
var METRICS_READ_BATCH = 2000;
var FLUSH_LOCK_MS = 5000;

var ACCOUNT_HEADERS = ["id_display", "id_key", "password", "created_at", "last_login", "token", "status"];
var SCORE_HEADERS = ["id_key", "program", "item_id", "score_value", "score_max", "score_pct", "local_date", "updated_at"];

var MSG_BLANK = "Type an ID and a password.";
var MSG_MISSING = "User does not exist.";
var MSG_WRONG = "Wrong password.";
var MSG_TAKEN = "That ID is already used. Log in instead.";
var MSG_TOKEN = "Sign in again.";
var MSG_ID_BLOCKED = "This ID is not active. Please ask Mr. Jay.";

function doGet() {
  return json_({ status: "ok", app: "mrj-signin", version: APP_VERSION });
}

function doPost(e) {
  try {
    var body = parseBody_(e);
    var action = String(body.action || "");
    if (action === "register") return json_(register_(body));
    if (action === "login") return json_(login_(body));
    if (action === "progress") return json_(progress_(body));
    if (action === "note_score") return json_(noteScore_(body));
    if (action === "load_pack") return json_(loadPack_(body));
    if (action === "save_pack") return json_(savePack_(body));
    if (action === "teacher_list_students") return json_(teacherListStudents_(body));
    if (action === "teacher_student_snapshot") return json_(teacherStudentSnapshot_(body));
    if (action === "student_dashboard") return json_(studentDashboard_(body));
    if (action === "teacher_student_dashboard") return json_(teacherStudentDashboard_(body));
    if (action === "teacher_app_roster") return json_(teacherAppRoster_(body));
    if (action === "set_status") return json_(setStatus_(body));
    return json_({ ok: false, error: "bad_action", message: "Unknown action." });
  } catch (err) {
    return json_({ ok: false, error: "server", message: "Something went wrong." });
  }
}

function register_(body) {
  var blank = rejectBlank_(body.id, body.password);
  if (blank) return blank;
  return withLock_(function () {
    var ss = book_();
    var key = idKey_(body.id);
    var existing = findAccount_(ss, key, true);
    if (existing) {
      return { ok: false, error: "id_taken", message: MSG_TAKEN };
    }
    var now = kstIsoNow_();
    var loginStamp = new Date().toISOString();
    var token = newToken_();
    var display = String(body.id);
    appendAccount_(ss, {
      id_display: display,
      id_key: key,
      password: String(body.password),
      created_at: now,
      last_login: loginStamp,
      token: token,
      status: ""
    });
    bustAccountCache_(key);
    appendSignInDeviceMetric_(ss, key, display, body);
    return attachSignInRole_({
      ok: true,
      error: "",
      message: "",
      id: display,
      token: token,
      progress: []
    }, key);
  });
}

function login_(body) {
  var blank = rejectBlank_(body.id, body.password);
  if (blank) return blank;
  return withLock_(function () {
    var ss = book_();
    var key = idKey_(body.id);
    var existing = findAccount_(ss, key, true);
    if (!existing) {
      return { ok: false, error: "user_does_not_exist", message: MSG_MISSING };
    }
    if (String(existing.password) !== String(body.password)) {
      return { ok: false, error: "wrong_password", message: MSG_WRONG };
    }
    var blocked = rejectIfAccountBlocked_(existing);
    if (blocked) return blocked;
    var token = newToken_();
    var now = new Date().toISOString();
    var tokenField = pushToken_(existing.token, token);
    writeAccountCells_(existing.sheet, existing.row, {
      last_login: now,
      token: tokenField
    });
    bustAccountCache_(key);
    appendSignInDeviceMetric_(ss, key, existing.id_display, body);
    return attachSignInRole_({
      ok: true,
      error: "",
      message: "",
      id: existing.id_display,
      token: token,
      progress: []
    }, key);
  });
}

function parseTeacherIdsProperty_() {
  var raw = "";
  try {
    raw = PropertiesService.getScriptProperties().getProperty(TEACHER_IDS_PROP);
  } catch (ignore) {}
  if (!raw || !String(raw).trim()) return [];
  var parts = String(raw).split(/[,;\s]+/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var k = idKey_(parts[i]);
    if (k) out.push(k);
  }
  return out;
}

function getTeacherSecretProperty_() {
  try {
    var s = PropertiesService.getScriptProperties().getProperty(TEACHER_SECRET_PROP);
    if (s == null || !String(s).trim()) return "";
    return String(s);
  } catch (ignore) {}
  return "";
}

function isTeacherIdKey_(key) {
  key = idKey_(key);
  if (!key) return false;
  var list = parseTeacherIdsProperty_();
  if (!list.length) return false;
  for (var i = 0; i < list.length; i++) {
    if (list[i] === key) return true;
  }
  return false;
}

function signInRoleForIdKey_(key) {
  key = idKey_(key);
  if (!key) return "";
  for (var ti = 0; ti < SIGNIN_TEACHER_ROLE_KEYS.length; ti++) {
    if (SIGNIN_TEACHER_ROLE_KEYS[ti] === key) return "teacher";
  }
  return "";
}

function parseMetadataJson_(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;
  try {
    var v = JSON.parse(String(raw));
    return v && typeof v === "object" ? v : null;
  } catch (ignore) {}
  return null;
}

function metadataRoleIsTeacher_(meta) {
  if (!meta || typeof meta !== "object") return false;
  return asString_(meta.role).trim().toLowerCase() === "teacher";
}

function isTeacherMetadataJson_(raw) {
  return metadataRoleIsTeacher_(parseMetadataJson_(raw));
}

function teacherMetadataJsonString_() {
  return '{"role":"teacher"}';
}

function tagProgressJsonWithTeacherRole_(json) {
  var obj;
  try {
    obj = JSON.parse(String(json == null ? "{}" : json));
    if (!obj || typeof obj !== "object") obj = {};
  } catch (ignore) {
    obj = {};
  }
  obj.metadata_json = { role: "teacher" };
  return JSON.stringify(obj);
}

function isTeacherTaggedPackJson_(json) {
  try {
    var obj = JSON.parse(String(json || "{}"));
    return !!(obj && obj.metadata_json && metadataRoleIsTeacher_(obj.metadata_json));
  } catch (ignore) {}
  return false;
}

function metricsRowIsTeacherTagged_(row, map) {
  if (!map || map.metadata_json == null) return false;
  return isTeacherMetadataJson_(field_(row, map, "metadata_json"));
}

function scoreIndexHeaderMap_(sheet) {
  if (!sheet || sheet.getLastRow() < 1) return {};
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  for (var c = 0; c < header.length; c++) map[String(header[c]).trim()] = c;
  return map;
}

function attachSignInRole_(payload, idKey) {
  var role = signInRoleForIdKey_(idKey);
  if (role) payload.role = role;
  return payload;
}

function filterProgressRowsSkipTeacher_(rows) {
  var out = [];
  for (var i = 0; i < (rows || []).length; i++) {
    if (progressRowIsTeacherTagged_(rows[i])) continue;
    out.push(rows[i]);
  }
  return out;
}

function progressRowIsTeacherTagged_(row) {
  if (!row) return false;
  if (isTeacherMetadataJson_(row.metadata_json)) return true;
  return false;
}

function teacherSecretFailCount_() {
  try {
    var raw = CacheService.getScriptCache().get(TEACHER_SECRET_FAIL_CACHE_KEY);
    var n = parseInt(raw, 10);
    return isFinite(n) && n > 0 ? n : 0;
  } catch (ignore) {}
  return 0;
}

function bumpTeacherSecretFailCount_() {
  try {
    var cache = CacheService.getScriptCache();
    var n = teacherSecretFailCount_() + 1;
    cache.put(TEACHER_SECRET_FAIL_CACHE_KEY, String(n), TEACHER_SECRET_FAIL_CACHE_SEC);
    return n;
  } catch (ignore) {}
  return 1;
}

function clearTeacherSecretFailCount_() {
  try {
    CacheService.getScriptCache().remove(TEACHER_SECRET_FAIL_CACHE_KEY);
  } catch (ignore) {}
}

function teacherSecretFailurePenalty_() {
  var n = bumpTeacherSecretFailCount_();
  var delay = TEACHER_SECRET_FAIL_SLEEP_BASE_MS + n * 300;
  if (delay > TEACHER_SECRET_FAIL_SLEEP_MAX_MS) delay = TEACHER_SECRET_FAIL_SLEEP_MAX_MS;
  if (delay > 0) {
    try {
      Utilities.sleep(delay);
    } catch (ignore) {}
  }
}

function kstIsoNow_() {
  var now = new Date();
  var formatted = Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd'T'HH:mm:ss");
  return formatted + "+09:00";
}

function accountHeaderMap_(sheet) {
  return scoreIndexHeaderMap_(sheet);
}

function syncAccountHeaders_(sheet) {
  if (!sheet) return;
  var map = accountHeaderMap_(sheet);
  var col = sheet.getLastColumn();
  if (col < 1) col = 0;
  for (var h = 0; h < ACCOUNT_HEADERS.length; h++) {
    var name = ACCOUNT_HEADERS[h];
    if (map[name] != null) continue;
    col += 1;
    var cell = sheet.getRange(1, col);
    cell.setNumberFormat("@");
    cell.setValue(name);
    map[name] = col - 1;
  }
}

function accountStatusFromValue_(raw) {
  return asString_(raw).trim().toLowerCase();
}

function accountIsBlocked_(status) {
  return accountStatusFromValue_(status) === "blocked";
}

function accountIsActive_(status) {
  var s = accountStatusFromValue_(status);
  return !s || s === "approved";
}

function rejectIfAccountBlocked_(account) {
  if (!account || accountIsActive_(account.status)) return null;
  return { ok: false, error: "id_blocked", message: MSG_ID_BLOCKED };
}

function setStatus_(body) {
  var gate = requireTeacherAccess_(body);
  if (!gate.ok) return gate;
  var targetId = textOrEmpty_(body.id);
  if (!targetId) {
    return { ok: false, error: "bad_id", message: "Missing student id." };
  }
  var status = accountStatusFromValue_(body.status);
  if (status !== "approved" && status !== "blocked") {
    return { ok: false, error: "bad_status", message: "Status must be approved or blocked." };
  }
  return withLock_(function () {
    var ss = book_();
    var key = idKey_(targetId);
    var existing = findAccount_(ss, key, true);
    if (!existing) {
      return { ok: false, error: "user_does_not_exist", message: MSG_MISSING };
    }
    var sheet = existing.sheet;
    syncAccountHeaders_(sheet);
    var map = accountHeaderMap_(sheet);
    if (map.status == null) {
      return { ok: false, error: "server", message: "Something went wrong." };
    }
    var stored = status === "approved" ? "" : "blocked";
    writeAccountCells_(sheet, existing.row, { status: stored });
    bustAccountCache_(key);
    return {
      ok: true,
      error: "",
      message: "",
      id: existing.id_display,
      status: status
    };
  });
}

function requireTeacherAccess_(body) {
  body = body || {};
  var ids = parseTeacherIdsProperty_();
  var secret = getTeacherSecretProperty_();
  var given = body.teacher_secret != null ? String(body.teacher_secret) : "";
  if (!ids.length && !secret) {
    return {
      ok: false,
      error: "forbidden",
      message: "Teacher access is not configured."
    };
  }
  if (secret && given === secret) {
    clearTeacherSecretFailCount_();
    return { ok: true, error: "", message: "", teacher: true };
  }
  if (secret && given && given !== secret) {
    teacherSecretFailurePenalty_();
    return { ok: false, error: "forbidden", message: "Teachers only." };
  }
  if (ids.length) {
    var tokenGate = requireToken_(book_(), body, false);
    if (!tokenGate.ok) return tokenGate;
    if (isTeacherIdKey_(tokenGate.id_key)) {
      return tokenGate;
    }
  }
  return { ok: false, error: "forbidden", message: "Teachers only." };
}

function teacherListStudents_(body) {
  var gate = requireTeacherAccess_(body);
  if (!gate.ok) return gate;
  var sheet = ensureAccounts_(book_());
  var students = [];
  if (sheet.getLastRow() >= 2) {
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var display = asString_(values[i][0]).trim();
      var idKeyVal = asString_(values[i][1]).trim();
      if (!display || !idKeyVal) continue;
      students.push({ id: display, id_key: idKeyVal });
    }
  }
  students.sort(function (a, b) {
    return String(a.id).localeCompare(String(b.id), undefined, { sensitivity: "base" });
  });
  return { ok: true, error: "", students: students };
}

function packShardIdsFromShellJson_(mainJson) {
  var obj;
  try {
    obj = JSON.parse(String(mainJson || "{}"));
  } catch (ignore) {
    return [];
  }
  if (!obj || typeof obj !== "object") return [];
  if (Array.isArray(obj.packShardIds)) {
    return obj.packShardIds.map(function (id) {
      return asString_(id).trim();
    }).filter(Boolean);
  }
  return [];
}

function readPackShardForProgram_(ss, idKey, packId) {
  packId = asString_(packId).trim();
  if (!packId) return null;
  var program = WM_PACK_SHARD_PREFIX + packId;
  var json = readPackJson_(ss, idKey, program);
  if (!json) return null;
  return { program: program, packId: packId, progress_json: json };
}

function mergePackJsonWithListedShards_(mainJson, shards) {
  var base = {};
  try {
    base = JSON.parse(String(mainJson || "{}"));
  } catch (ignore) {
    base = {};
  }
  if (!base || typeof base !== "object") base = {};
  if (!base.sets) base.sets = {};
  if (!shards || !shards.length) return JSON.stringify(base);
  for (var i = 0; i < shards.length; i++) {
    var shard = shards[i];
    if (!shard || !shard.progress_json) continue;
    var pid = asString_(shard.packId).trim();
    if (!pid && shard.program) {
      pid = asString_(shard.program).slice(WM_PACK_SHARD_PREFIX.length);
    }
    try {
      var obj = JSON.parse(String(shard.progress_json));
      if (!obj || !obj.sets) continue;
      if (pid && obj.sets[pid]) {
        base.sets[pid] = obj.sets[pid];
      }
    } catch (ignore2) {}
  }
  return JSON.stringify(base);
}

function teacherStudentSnapshot_(body) {
  var gate = requireTeacherAccess_(body);
  if (!gate.ok) return gate;
  var target = idKey_(body.student || body.target || "");
  if (!target) {
    return { ok: false, error: "bad_student", message: "Missing student id." };
  }
  var program = textOrEmpty_(body.program).trim() || "word-master";
  var ss = book_();
  try {
    var rows = loadProgressRowsWithFallback_(ss, target, program);
    var page = pageProgressRows_(rows, 0, PROGRESS_MAX_LIMIT);
    var packJson = readPackJson_(ss, target, program);
    var packIds = packShardIdsFromShellJson_(packJson);
    var shards = [];
    var missingShards = [];
    for (var si = 0; si < packIds.length; si++) {
      var packId = packIds[si];
      var loaded = readPackShardForProgram_(ss, target, packId);
      if (loaded) {
        shards.push(loaded);
      } else {
        missingShards.push(packId);
      }
    }
    if (shards.length) {
      packJson = mergePackJsonWithListedShards_(packJson, shards);
    }
    return {
      ok: true,
      error: "",
      student: asString_(body.student || target),
      program: program,
      progress: page.progress,
      total: page.total,
      hasMore: page.hasMore,
      progress_json: packJson,
      incomplete: missingShards.length > 0,
      missingShards: missingShards
    };
  } catch (err) {
    return {
      ok: false,
      error: "teacher_load_failed",
      message: "Could not load student snapshot."
    };
  }
}

function parseDeviceFromBody_(body) {
  body = body || {};
  var d = body.device;
  if (!d || typeof d !== "object") return null;
  return {
    type: asString_(d.type || d.deviceType).trim() || "unknown",
    os: asString_(d.os).trim() || "unknown",
    browser: asString_(d.browser).trim() || "unknown",
    screenW: d.screenW != null ? d.screenW : d.width,
    screenH: d.screenH != null ? d.screenH : d.height
  };
}

function formatDeviceItemId_(device) {
  if (!device) return "";
  var type = asString_(device.type).slice(0, 24);
  var os = asString_(device.os).slice(0, 32);
  var browser = asString_(device.browser).slice(0, 32);
  var w = +device.screenW;
  var h = +device.screenH;
  var screen = isFinite(w) && isFinite(h) && w > 0 && h > 0 ? String(w) + "x" + String(h) : "";
  if (!screen) screen = "unknown";
  return "device:" + type + "/" + os + "/" + browser + "/" + screen;
}

function metricsHeaderMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) lastCol = 11;
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var c = 0; c < header.length; c++) map[String(header[c]).trim()] = c;
  return { header: header, map: map };
}

function metricsRowFromFields_(header, map, fields) {
  var row = [];
  for (var c = 0; c < header.length; c++) row.push("");
  var keys = Object.keys(fields || {});
  for (var i = 0; i < keys.length; i++) {
    var name = keys[i];
    var idx = map[name];
    if (idx == null) continue;
    row[idx] = fields[name];
  }
  return row;
}

function metricsEventKind_(row, map) {
  var kind = asString_(field_(row, map, "event_kind")).trim().toLowerCase();
  if (kind) return kind;
  var activity = asString_(field_(row, map, "activity")).trim().toLowerCase();
  if (activity) return activity;
  return asString_(field_(row, map, "event")).trim().toLowerCase();
}

function isSignInMetricsEvent_(kind) {
  return asString_(kind).trim().toLowerCase() === "sign_in";
}

function isExcludedMetricsEvent_(kind) {
  kind = asString_(kind).trim().toLowerCase();
  return kind === "effort_sample" || kind === "sign_in";
}

function signInMetricsFieldValues_(displayId, body, device, iso, idKey) {
  var program = textOrEmpty_(body.client_app).trim() || textOrEmpty_(body.app).trim() || "mrj-signin";
  var local = iso.slice(0, 10);
  var deviceItem = formatDeviceItemId_(device);
  var fields = {
    event_kind: "sign_in",
    activity: "sign_in",
    event: "sign_in",
    session_id: "signin-" + asString_(displayId) + "-" + iso,
    student_email: asString_(displayId),
    student_id: "",
    curriculum_program: program,
    item_id: deviceItem,
    score_value: "",
    score_max: "",
    score_pct: "",
    local_date: local,
    timestamp: iso
  };
  if (signInRoleForIdKey_(idKey) === "teacher") {
    fields.metadata_json = teacherMetadataJsonString_();
  }
  return fields;
}

function appendSignInDeviceMetric_(ss, idKey, displayId, body) {
  try {
    var device = parseDeviceFromBody_(body);
    if (!device) return;
    var sheet = ss.getSheetByName(METRICS_SHEET);
    if (!sheet) return;
    var hm = metricsHeaderMap_(sheet);
    if (!hm.map.event_kind && !hm.map.activity && sheet.getLastRow() < 1) return;
    var now = new Date();
    var iso = now.toISOString();
    var row = metricsRowFromFields_(hm.header, hm.map, signInMetricsFieldValues_(displayId, body, device, iso, idKey));
    sheet.appendRow(row);
  } catch (ignore) {}
}

function countLeafProgressDash_(node) {
  var done = 0;
  var total = 0;
  if (node == null) return { done: done, total: total };
  if (typeof node === "boolean") {
    total = 1;
    if (node) done = 1;
    return { done: done, total: total };
  }
  if (typeof node === "number") {
    total = 1;
    if (node > 0) done = 1;
    return { done: done, total: total };
  }
  if (typeof node !== "object") return { done: done, total: total };
  var keys = Object.keys(node);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === "lastPlayedAt" || k === "v") continue;
    var sub = countLeafProgressDash_(node[k]);
    done += sub.done;
    total += sub.total;
  }
  return { done: done, total: total };
}

function summarizePackSetsDash_(parsed) {
  var sets = parsed && parsed.sets && typeof parsed.sets === "object" ? parsed.sets : {};
  var units = [];
  var keys = Object.keys(sets);
  keys.sort();
  for (var ui = 0; ui < keys.length; ui++) {
    var id = keys[ui];
    var counts = countLeafProgressDash_(sets[id]);
    var pct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : counts.done > 0 ? 100 : 0;
    units.push({ id: id, label: id, done: counts.done, total: counts.total, pct: pct });
  }
  var doneAll = 0;
  var totalAll = 0;
  for (var j = 0; j < units.length; j++) {
    doneAll += units[j].done;
    totalAll += units[j].total;
  }
  var overallPct = totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : units.length ? 0 : null;
  var remaining = [];
  for (var r = 0; r < units.length; r++) {
    if (units[r].total > 0 && units[r].pct < 100) remaining.push(units[r].id);
  }
  return { units: units, overallPct: overallPct, remaining: remaining };
}

function parseScorePctDash_(row) {
  if (!row) return null;
  if (row.score_pct != null && row.score_pct !== "") {
    var n = +row.score_pct;
    if (isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
  }
  var text = asString_(row.score || row.scoreText);
  var m = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) return Math.round(+m[1]);
  var frac = text.match(/^(\d+)\s*\/\s*(\d+)/);
  if (frac) {
    var maxN = +frac[2];
    if (maxN > 0) return Math.round((+frac[1] / maxN) * 100);
  }
  return null;
}

function normalizeDashRow_(row) {
  return {
    program: asString_(row.program).trim(),
    item_id: asString_(row.item || row.item_id).trim(),
    local_date: asString_(row.date || row.local_date).trim(),
    score_pct: parseScorePctDash_(row)
  };
}

function scoreTrendDash_(rows, limit) {
  var lim = limit == null ? 40 : Math.max(1, parseInt(limit, 10) || 40);
  var norm = [];
  for (var i = 0; i < (rows || []).length; i++) {
    var n = normalizeDashRow_(rows[i]);
    if (n.item_id) norm.push(n);
  }
  norm.sort(function (a, b) {
    return String(a.local_date).localeCompare(String(b.local_date));
  });
  var points = [];
  for (var p = 0; p < norm.length; p++) {
    if (norm[p].score_pct == null) continue;
    points.push({
      date: norm[p].local_date || "?",
      pct: norm[p].score_pct,
      item_id: norm[p].item_id
    });
  }
  if (points.length > lim) return points.slice(points.length - lim);
  return points;
}

function weakItemsDash_(rows, threshold) {
  var t = threshold == null ? 70 : +threshold;
  var byItem = {};
  for (var i = 0; i < (rows || []).length; i++) {
    var r = normalizeDashRow_(rows[i]);
    if (!r.item_id || r.score_pct == null) continue;
    var prev = byItem[r.item_id];
    if (!prev || String(r.local_date).localeCompare(String(prev.local_date)) >= 0) {
      byItem[r.item_id] = r;
    }
  }
  var out = [];
  var keys = Object.keys(byItem);
  for (var k = 0; k < keys.length; k++) {
    var row = byItem[keys[k]];
    if (row.score_pct < t) out.push(row);
  }
  out.sort(function (a, b) {
    return a.score_pct - b.score_pct;
  });
  if (out.length > 12) out = out.slice(0, 12);
  return out;
}

function recentActivityDash_(rows, limit) {
  var lim = limit == null ? 8 : Math.max(1, parseInt(limit, 10) || 8);
  var norm = [];
  for (var i = 0; i < (rows || []).length; i++) {
    var n = normalizeDashRow_(rows[i]);
    if (n.item_id) norm.push(n);
  }
  norm.sort(function (a, b) {
    return String(b.local_date).localeCompare(String(a.local_date));
  });
  var out = [];
  for (var j = 0; j < norm.length && j < lim; j++) {
    out.push({
      item_id: norm[j].item_id,
      program: norm[j].program,
      local_date: norm[j].local_date,
      score_pct: norm[j].score_pct
    });
  }
  return out;
}

function normalizeDailyWordLogDash_(raw) {
  if (!raw || typeof raw !== "object") return { v: 1, days: {} };
  var days = raw.days && typeof raw.days === "object" ? raw.days : {};
  return { v: 1, days: days };
}

function mergeDailyWordEntriesDash_(ea, eb) {
  if (!ea) return eb;
  if (!eb) return ea;
  var packId = ea.pack || eb.pack;
  var seen = {};
  var ids = [];
  var ens = [];
  function addList(src) {
    var srcIds = src.ids || [];
    for (var i = 0; i < srcIds.length; i++) {
      var k = asString_(srcIds[i]);
      if (!k || seen[k]) continue;
      seen[k] = 1;
      ids.push(k);
      ens.push((src.ens || [])[i] || k);
    }
  }
  addList(ea);
  addList(eb);
  var from = 0;
  var to = 0;
  var pair = [ea, eb];
  for (var p = 0; p < pair.length; p++) {
    var e = pair[p];
    if (e.from > 0) from = from > 0 ? Math.min(from, e.from) : e.from;
    if (e.to > 0) to = to > 0 ? Math.max(to, e.to) : e.to;
  }
  return {
    pack: packId,
    date: ea.date || eb.date,
    ids: ids,
    ens: ens,
    from: from,
    to: to,
    at: Math.max(Number(ea.at) || 0, Number(eb.at) || 0)
  };
}

function mergeDailyWordLogsDash_(a, b) {
  var la = normalizeDailyWordLogDash_(a);
  var lb = normalizeDailyWordLogDash_(b);
  var out = { v: 1, days: {} };
  var keys = {};
  var laKeys = Object.keys(la.days);
  for (var i = 0; i < laKeys.length; i++) keys[laKeys[i]] = 1;
  var lbKeys = Object.keys(lb.days);
  for (var j = 0; j < lbKeys.length; j++) keys[lbKeys[j]] = 1;
  var allKeys = Object.keys(keys);
  for (var k = 0; k < allKeys.length; k++) {
    var key = allKeys[k];
    out.days[key] = mergeDailyWordEntriesDash_(la.days[key], lb.days[key]);
  }
  return out;
}

function dailyWordRangeLabelDash_(fromNum, toNum) {
  var a = Math.min(fromNum, toNum);
  var b = Math.max(fromNum, toNum);
  if (!a && !b) return "";
  if (a === b) return "Word " + a;
  return "Words " + a + "\u2013" + b;
}

function dailyWordsLineDash_(ens, max) {
  var list = [];
  for (var i = 0; i < (ens || []).length; i++) {
    if (ens[i]) list.push(ens[i]);
  }
  var lim = max == null ? 24 : Math.max(1, parseInt(max, 10) || 24);
  if (list.length <= lim) return list.join(", ");
  return list.slice(0, lim).join(", ") + " \u2026";
}

function formatDailyWordDayLineDash_(entry) {
  if (!entry) return "";
  var head = dailyWordRangeLabelDash_(entry.from, entry.to);
  var body = dailyWordsLineDash_(entry.ens, 32);
  if (head && body) return head + ": " + body;
  return head || body || "";
}

function summarizeDailyWordsDash_(packJson, opts) {
  var parsed = {};
  try {
    parsed = JSON.parse(String(packJson || "{}"));
  } catch (ignore) {
    parsed = {};
  }
  var log = normalizeDailyWordLogDash_(parsed.dailyWordLog);
  var byDate = {};
  var dayKeys = Object.keys(log.days);
  for (var i = 0; i < dayKeys.length; i++) {
    var key = dayKeys[i];
    var e = log.days[key];
    if (!e) continue;
    var dk = e.date || String(key).split("|")[0];
    if (!byDate[dk]) byDate[dk] = [];
    var line = formatDailyWordDayLineDash_(e);
    if (!line) continue;
    var pack = e.pack || String(key).split("|")[1] || "";
    byDate[dk].push({ pack: pack, line: line });
  }
  var dates = Object.keys(byDate).sort().reverse();
  var limit = opts && opts.limit != null ? Math.max(1, parseInt(opts.limit, 10) || 120) : 120;
  if (dates.length > limit) dates = dates.slice(0, limit);
  var out = [];
  for (var d = 0; d < dates.length; d++) {
    out.push({ date: dates[d], packs: byDate[dates[d]] });
  }
  return out;
}

function hasScoresShardFromShellJson_(mainJson) {
  try {
    var obj = JSON.parse(String(mainJson || "{}"));
    return !!(obj && obj.hasScoresShard);
  } catch (ignore) {
    return false;
  }
}

function mergeDailyWordLogIntoPackJsonDash_(packJson, scoresJson) {
  if (!scoresJson) return packJson;
  var base = {};
  try {
    base = JSON.parse(String(packJson || "{}"));
  } catch (ignore) {
    base = {};
  }
  var scoresObj = {};
  try {
    scoresObj = JSON.parse(String(scoresJson || "{}"));
  } catch (ignore2) {
    scoresObj = {};
  }
  var merged = mergeDailyWordLogsDash_(base.dailyWordLog, scoresObj.dailyWordLog);
  if (merged.days && Object.keys(merged.days).length) {
    base.dailyWordLog = merged;
  }
  return JSON.stringify(base);
}

function buildDashboardPayload_(packJson, progressRows) {
  var parsed = {};
  try {
    parsed = JSON.parse(String(packJson || "{}"));
  } catch (ignore) {
    parsed = {};
  }
  var completion = summarizePackSetsDash_(parsed);
  return {
    completion: completion,
    scoreTrend: scoreTrendDash_(progressRows, 40),
    weakItems: weakItemsDash_(progressRows, 70),
    recentActivity: recentActivityDash_(progressRows, 8),
    dailyWords: summarizeDailyWordsDash_(packJson, { limit: 120 })
  };
}

function loadPackMergedForStudent_(ss, idKey, program) {
  var packJson = readPackJson_(ss, idKey, program);
  var hadScoresShard = hasScoresShardFromShellJson_(packJson);
  var packIds = packShardIdsFromShellJson_(packJson);
  var shards = [];
  var missingShards = [];
  for (var si = 0; si < packIds.length; si++) {
    var packId = packIds[si];
    var loaded = readPackShardForProgram_(ss, idKey, packId);
    if (loaded) shards.push(loaded);
    else missingShards.push(packId);
  }
  if (shards.length) packJson = mergePackJsonWithListedShards_(packJson, shards);
  if (program === "word-master" && hadScoresShard) {
    var scoresJson = readPackJson_(ss, idKey, WM_SCORES_PROGRAM);
    if (!scoresJson) {
      missingShards.push("scores");
    } else {
      packJson = mergeDailyWordLogIntoPackJsonDash_(packJson, scoresJson);
    }
  }
  return {
    progress_json: packJson,
    incomplete: missingShards.length > 0,
    missingShards: missingShards
  };
}

function listProgramsForStudent_(ss, idKey) {
  var seen = {};
  var packSheet = ss.getSheetByName(PACK_SHEET);
  if (packSheet && packSheet.getLastRow() >= 2) {
    var values = packSheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (asString_(values[i][0]) !== idKey) continue;
      var prog = asString_(values[i][1]).trim();
      if (!prog || prog.indexOf("@") !== -1) continue;
      seen[prog] = 1;
    }
  }
  var scoreRows = readScoreIndex_(ss, idKey);
  for (var j = 0; j < scoreRows.length; j++) {
    var p = asString_(scoreRows[j].program).trim();
    if (p) seen[p] = 1;
  }
  var out = Object.keys(seen);
  out.sort();
  return out;
}

function programDisplayNameDash_(program) {
  var map = {
    "word-master": "Word Master",
    greenzap: "Green Zap",
    "skill-builder": "Skill Builder",
    "skill-builder-g1": "Skill Builder G1",
    pronounce: "Pronounce",
    "pronounce-whistle": "Pronounce Whistle",
    "day2-words": "Day 2 Words",
    "day3-workbook": "Day 3 Workbook"
  };
  return map[program] || program;
}

function compactAppSummaryDash_(program, packJson, progressRows) {
  var dash = buildDashboardPayload_(packJson, progressRows);
  var lastActive = "";
  if (dash.recentActivity.length) lastActive = dash.recentActivity[0].local_date || "";
  var scores = [];
  for (var i = 0; i < (progressRows || []).length; i++) {
    var n = normalizeDashRow_(progressRows[i]);
    if (n.score_pct != null) scores.push(n);
  }
  var avgPct = null;
  if (scores.length) {
    var sum = 0;
    for (var s = 0; s < scores.length; s++) sum += scores[s].score_pct;
    avgPct = Math.round(sum / scores.length);
  }
  return {
    program: program,
    label: programDisplayNameDash_(program),
    completionPct: dash.completion.overallPct,
    unitCount: dash.completion.units.length,
    scoreCount: scores.length,
    avgScorePct: avgPct,
    lastActive: lastActive,
    weakCount: dash.weakItems.length
  };
}

function studentDashboard_(body) {
  var gate = requireToken_(book_(), body, false);
  if (!gate.ok) return gate;
  var program = textOrEmpty_(body.program).trim() || textOrEmpty_(body.app).trim();
  if (!program) {
    return { ok: false, error: "bad_program", message: "Missing app id." };
  }
  var ss = book_();
  try {
    var rows = filterProgressRowsSkipTeacher_(loadProgressRowsWithFallback_(ss, gate.id_key, program));
    var pack = loadPackMergedForStudent_(ss, gate.id_key, program);
    var packJsonForDash = isTeacherTaggedPackJson_(pack.progress_json) ? "{}" : pack.progress_json;
    return {
      ok: true,
      error: "",
      id: gate.id,
      program: program,
      dashboard: buildDashboardPayload_(packJsonForDash, rows),
      incomplete: pack.incomplete,
      missingShards: pack.missingShards
    };
  } catch (err) {
    return { ok: false, error: "dashboard_load_failed", message: "Could not load progress." };
  }
}

function teacherStudentDashboard_(body) {
  var gate = requireTeacherAccess_(body);
  if (!gate.ok) return gate;
  var target = idKey_(body.student || body.target || "");
  if (!target) {
    return { ok: false, error: "bad_student", message: "Missing student id." };
  }
  var ss = book_();
  try {
    var programs = listProgramsForStudent_(ss, target);
    var apps = [];
    var dashboards = {};
    for (var i = 0; i < programs.length; i++) {
      var program = programs[i];
      var rows = loadProgressRowsWithFallback_(ss, target, program);
      var pack = loadPackMergedForStudent_(ss, target, program);
      apps.push(compactAppSummaryDash_(program, pack.progress_json, rows));
      dashboards[program] = buildDashboardPayload_(pack.progress_json, rows);
    }
    return {
      ok: true,
      error: "",
      student: asString_(body.student || target),
      apps: apps,
      dashboards: dashboards
    };
  } catch (err) {
    return { ok: false, error: "teacher_dashboard_failed", message: "Could not load student dashboards." };
  }
}

function teacherAppRoster_(body) {
  var gate = requireTeacherAccess_(body);
  if (!gate.ok) return gate;
  var program = textOrEmpty_(body.program).trim() || textOrEmpty_(body.app).trim();
  if (!program) {
    return { ok: false, error: "bad_program", message: "Missing app id." };
  }
  var ss = book_();
  try {
    var sheet = ensureAccounts_(ss);
    var roster = [];
    if (sheet.getLastRow() >= 2) {
      var values = sheet.getDataRange().getValues();
      for (var i = 1; i < values.length; i++) {
        var display = asString_(values[i][0]).trim();
        var idKeyVal = asString_(values[i][1]).trim();
        if (!display || !idKeyVal) continue;
        var rows = loadProgressRowsWithFallback_(ss, idKeyVal, program);
        var pack = loadPackMergedForStudent_(ss, idKeyVal, program);
        var summary = compactAppSummaryDash_(program, pack.progress_json, rows);
        roster.push({
          id: display,
          id_key: idKeyVal,
          summary: summary,
          dashboard: buildDashboardPayload_(pack.progress_json, rows)
        });
      }
    }
    roster.sort(function (a, b) {
      return String(a.id).localeCompare(String(b.id), undefined, { sensitivity: "base" });
    });
    return { ok: true, error: "", program: program, students: roster };
  } catch (err) {
    return { ok: false, error: "teacher_roster_failed", message: "Could not load class roster." };
  }
}

function progress_(body) {
  var gate = requireToken_(book_(), body, false);
  if (!gate.ok) return gate;
  var program = textOrEmpty_(body.program).trim();
  var offset = parseInt(body.offset, 10);
  if (!isFinite(offset) || offset < 0) offset = 0;
  var limit = parseInt(body.limit, 10);
  if (!isFinite(limit) || limit < 1) limit = PROGRESS_DEFAULT_LIMIT;
  if (limit > PROGRESS_MAX_LIMIT) limit = PROGRESS_MAX_LIMIT;

  try {
    var all = loadProgressRowsWithFallback_(book_(), gate.id_key, program);
    all = filterProgressRowsSkipTeacher_(all);
    var page = pageProgressRows_(all, offset, limit);
    return attachSignInRole_({
      ok: true,
      error: "",
      message: "",
      id: gate.id,
      token: gate.token,
      program: program,
      progress: page.progress,
      total: page.total,
      offset: page.offset,
      limit: page.limit,
      hasMore: page.hasMore
    }, gate.id_key);
  } catch (err) {
    return {
      ok: false,
      error: "progress_load_failed",
      message: "Could not load saved progress.",
      id: gate.id,
      token: gate.token
    };
  }
}

function noteScore_(body) {
  return withLock_(function () {
    var ss = book_();
    var gate = requireToken_(ss, body, true);
    if (!gate.ok) return gate;
    var now = new Date().toISOString();
    var program = textOrEmpty_(body.program);
    var meta = body.metadata_json;
    if (signInRoleForIdKey_(gate.id_key) === "teacher") {
      meta = { role: "teacher" };
    }
    upsertScore_(ss, {
      id_key: gate.id_key,
      program: program,
      item_id: textOrEmpty_(body.itemId),
      score_value: body.scoreValue,
      score_max: body.scoreMax,
      score_pct: body.scorePct,
      local_date: textOrEmpty_(body.localDate),
      updated_at: now,
      metadata_json: meta
    });
    var progFilter = program.trim();
    var rows = loadProgressRowsWithFallback_(ss, gate.id_key, progFilter);
    var page = pageProgressRows_(rows, 0, PROGRESS_DEFAULT_LIMIT);
    return {
      ok: true,
      error: "",
      message: "",
      id: gate.id,
      progress: page.progress,
      total: page.total,
      hasMore: page.hasMore
    };
  });
}

function requireToken_(ss, body, bustCache) {
  if (isBlankId_(body.id)) {
    return { ok: false, error: "user_does_not_exist", message: MSG_MISSING };
  }
  var key = idKey_(body.id);
  var existing = findAccount_(ss, key, !!bustCache);
  if (!existing) {
    return { ok: false, error: "user_does_not_exist", message: MSG_MISSING };
  }
  var given = body.token == null ? "" : String(body.token);
  if (!tokenMatches_(existing.token, given)) {
    return { ok: false, error: "bad_token", message: MSG_TOKEN };
  }
  var blocked = rejectIfAccountBlocked_(existing);
  if (blocked) return blocked;
  return {
    ok: true,
    id: existing.id_display,
    id_key: existing.id_key,
    token: given
  };
}

function tokenMatches_(stored, given) {
  if (!given) return false;
  var tokens = parseTokens_(stored);
  if (!tokens.length) return false;
  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i] === given) return true;
  }
  return false;
}

function parseTokens_(stored) {
  var raw = asString_(stored).trim();
  if (!raw) return [];
  if (raw.charAt(0) === "[") {
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(function (t) { return String(t); }).filter(Boolean);
      }
    } catch (ignore) {}
  }
  if (raw.indexOf("|") !== -1) {
    return raw.split("|").map(function (t) { return String(t).trim(); }).filter(Boolean);
  }
  return [raw];
}

function pushToken_(stored, fresh) {
  var tokens = parseTokens_(stored);
  tokens = tokens.filter(function (t) { return t !== fresh; });
  tokens.unshift(fresh);
  if (tokens.length > MAX_ACTIVE_TOKENS) {
    tokens = tokens.slice(0, MAX_ACTIVE_TOKENS);
  }
  if (tokens.length === 1) return tokens[0];
  return tokens.join("|");
}

function loadProgressRows_(ss, idKey, programFilter) {
  var rows = readScoreIndex_(ss, idKey);
  return filterProgressProgram_(rows, programFilter);
}

function loadProgressRowsWithFallback_(ss, idKey, programFilter) {
  var rows = loadProgressRows_(ss, idKey, programFilter);
  if (rows.length) return rows;
  return readMetricsProgress_(ss, idKey, programFilter);
}

function filterProgressProgram_(rows, programFilter) {
  if (!programFilter) return rows;
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (asString_(rows[i].program).trim() === programFilter) out.push(rows[i]);
  }
  return out;
}

function readMetricsProgress_(ss, idKey, programFilter) {
  var sheet = ss.getSheetByName(METRICS_SHEET);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var c = 0; c < header.length; c++) map[String(header[c]).trim()] = c;
  var start = Math.max(2, lastRow - (METRICS_FALLBACK_TAIL - 1));
  var numRows = lastRow - start + 1;
  var values = sheet.getRange(start, 1, numRows, lastCol).getValues();
  var picked = [];
  var seen = {};
  for (var i = values.length - 1; i >= 0; i--) {
    var row = values[i];
    if (!metricsRowMatches_(row, map, idKey)) continue;
    if (metricsRowIsTeacherTagged_(row, map)) continue;
    var kind = metricsEventKind_(row, map);
    if (isExcludedMetricsEvent_(kind)) continue;
    var scoreValue = field_(row, map, "score_value");
    var scorePct = field_(row, map, "score_pct");
    var hasScore = (scoreValue !== "" && scoreValue != null) || (scorePct !== "" && scorePct != null);
    if (kind !== "learning_result" && !hasScore) continue;
    var prog = metricsProgress_(row, map);
    if (programFilter && asString_(prog.program).trim() !== programFilter) continue;
    var dedupe = prog.program + "\0" + prog.item;
    if (seen[dedupe]) continue;
    seen[dedupe] = 1;
    picked.push(prog);
  }
  return picked;
}

function metricsRowMatches_(row, map, idKey) {
  if (!idKey) return false;
  if (sessionHasKey_(field_(row, map, "session_id"), idKey)) return true;
  return emailLocalKey_(field_(row, map, "student_email")) === idKey;
}

function sessionHasKey_(sessionId, idKey) {
  var name = nameFromSession_(sessionId);
  if (name && idKey_(name) === idKey) return true;
  var parts = asString_(sessionId).split("-");
  for (var i = 0; i < parts.length; i++) {
    if (idKey_(parts[i]) === idKey) return true;
  }
  return false;
}

function emailLocalKey_(email) {
  var s = asString_(email);
  var at = s.indexOf("@");
  if (at < 1) return "";
  return idKey_(s.slice(0, at));
}

function metricsProgress_(row, map) {
  var program = asString_(field_(row, map, "curriculum_program")).trim();
  if (!program) program = asString_(field_(row, map, "source")).trim();
  var date = asString_(field_(row, map, "local_date")).trim();
  if (!date) date = asString_(field_(row, map, "timestamp")).trim();
  return {
    program: program,
    item: asString_(field_(row, map, "item_id")).trim(),
    score: formatScore_(field_(row, map, "score_value"), field_(row, map, "score_max"), field_(row, map, "score_pct")),
    date: date
  };
}

function readScoreIndex_(ss, idKey) {
  var sheet = ss.getSheetByName(SCORE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headerMap = scoreIndexHeaderMap_(sheet);
  var metaCol = headerMap.metadata_json;
  var found = [];
  for (var i = 1; i < values.length; i++) {
    if (asString_(values[i][0]) !== idKey) continue;
    if (metaCol != null && isTeacherMetadataJson_(values[i][metaCol])) continue;
    found.push({
      program: asString_(values[i][1]),
      item: asString_(values[i][2]),
      score: formatScore_(values[i][3], values[i][4], values[i][5]),
      date: asString_(values[i][6]),
      updated: stamp_(values[i][7])
    });
  }
  found.sort(function (a, b) {
    if (a.updated === b.updated) return 0;
    return a.updated < b.updated ? 1 : -1;
  });
  var out = [];
  for (var n = 0; n < found.length; n++) {
    out.push({
      program: found[n].program,
      item: found[n].item,
      score: found[n].score,
      date: found[n].date
    });
  }
  return out;
}

function pageProgressRows_(rows, offset, limit) {
  var off = Math.max(0, offset | 0);
  var lim = Math.max(1, Math.min(PROGRESS_MAX_LIMIT, limit | 0));
  var total = rows.length;
  var slice = rows.slice(off, off + lim);
  return {
    progress: slice,
    total: total,
    offset: off,
    limit: lim,
    hasMore: off + slice.length < total
  };
}

function findAccount_(ss, key, skipCache) {
  if (!key) return null;
  if (!skipCache) {
    var cached = readAccountCache_(key);
    if (cached) return hydrateCachedAccount_(ss, cached);
  }
  var sheet = ensureAccounts_(ss);
  if (sheet.getLastRow() < 2) return null;
  var values = sheet.getDataRange().getValues();
  var map = accountHeaderMap_(sheet);
  var tokenCol = map.token != null ? map.token : 5;
  var statusCol = map.status;
  for (var i = 1; i < values.length; i++) {
    if (asString_(values[i][1]) !== key) continue;
    var row = {
      sheet: sheet,
      row: i + 1,
      id_display: asString_(values[i][0]),
      id_key: asString_(values[i][1]),
      password: asString_(values[i][2]),
      token: asString_(values[i][tokenCol]),
      status: statusCol != null ? asString_(values[i][statusCol]) : ""
    };
    writeAccountCache_(key, row);
    return row;
  }
  return null;
}

function hydrateCachedAccount_(ss, cached) {
  var sheet = ensureAccounts_(ss);
  return {
    sheet: sheet,
    row: cached.row,
    id_display: cached.id_display,
    id_key: cached.id_key,
    password: cached.password,
    token: cached.token,
    status: cached.status == null ? "" : cached.status
  };
}

function accountCacheKey_(key) {
  return "acct:" + key;
}

function readAccountCache_(key) {
  try {
    var raw = CacheService.getScriptCache().get(accountCacheKey_(key));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (ignore) {
    return null;
  }
}

function writeAccountCache_(key, row) {
  try {
    var payload = {
      row: row.row,
      id_display: row.id_display,
      id_key: row.id_key,
      password: row.password,
      token: row.token,
      status: row.status == null ? "" : row.status
    };
    CacheService.getScriptCache().put(accountCacheKey_(key), JSON.stringify(payload), ACCOUNT_CACHE_TTL_SEC);
  } catch (ignore) {}
}

function bustAccountCache_(key) {
  try {
    CacheService.getScriptCache().remove(accountCacheKey_(key));
  } catch (ignore) {}
}

function appendAccount_(ss, rec) {
  var sheet = ensureAccounts_(ss);
  var rowNumber = Math.max(sheet.getLastRow(), 1) + 1;
  syncAccountHeaders_(sheet);
  var row = [];
  for (var h = 0; h < ACCOUNT_HEADERS.length; h++) {
    var colName = ACCOUNT_HEADERS[h];
    var val = "";
    if (colName === "id_display") val = rec.id_display;
    else if (colName === "id_key") val = rec.id_key;
    else if (colName === "password") val = rec.password;
    else if (colName === "created_at") val = rec.created_at;
    else if (colName === "last_login") val = rec.last_login;
    else if (colName === "token") val = rec.token;
    else if (colName === "status") val = rec.status == null ? "" : rec.status;
    row.push(textCell_(val));
  }
  var range = sheet.getRange(rowNumber, 1, 1, row.length);
  range.setNumberFormat("@");
  range.setValues([row]);
}

function writeAccountCells_(sheet, rowNumber, fields) {
  if (fields.last_login != null) {
    var loginCell = sheet.getRange(rowNumber, 5);
    loginCell.setNumberFormat("@");
    loginCell.setValue(textCell_(fields.last_login));
  }
  if (fields.token != null) {
    var tokenCell = sheet.getRange(rowNumber, 6);
    tokenCell.setNumberFormat("@");
    tokenCell.setValue(textCell_(fields.token));
  }
  if (fields.status != null) {
    syncAccountHeaders_(sheet);
    var map = accountHeaderMap_(sheet);
    if (map.status != null) {
      var statusCell = sheet.getRange(rowNumber, map.status + 1);
      statusCell.setNumberFormat("@");
      statusCell.setValue(textCell_(fields.status));
    }
  }
}

function upsertScore_(ss, rec) {
  var sheet = ensureScoreSheet_(ss);
  var headerMap = scoreIndexHeaderMap_(sheet);
  var values = sheet.getLastRow() >= 1 ? sheet.getDataRange().getValues() : [];
  var rowNumber = 0;
  for (var i = 1; i < values.length; i++) {
    if (asString_(values[i][0]) !== rec.id_key) continue;
    if (asString_(values[i][1]) !== rec.program) continue;
    if (asString_(values[i][2]) !== rec.item_id) continue;
    rowNumber = i + 1;
    break;
  }
  var row = [
    textCell_(rec.id_key),
    textCell_(rec.program),
    textCell_(rec.item_id),
    scoreCell_(rec.score_value),
    scoreCell_(rec.score_max),
    scoreCell_(rec.score_pct),
    textCell_(rec.local_date),
    textCell_(rec.updated_at)
  ];
  if (headerMap.metadata_json != null && rec.metadata_json != null) {
    while (row.length <= headerMap.metadata_json) row.push("");
    row[headerMap.metadata_json] = textCell_(
      typeof rec.metadata_json === "string"
        ? rec.metadata_json
        : JSON.stringify(rec.metadata_json)
    );
  }
  if (!rowNumber) rowNumber = Math.max(sheet.getLastRow(), 1) + 1;
  var range = sheet.getRange(rowNumber, 1, 1, row.length);
  range.setNumberFormat("@");
  range.setValues([row]);
}

function ensureAccounts_(ss) {
  var sheet = ensureSheet_(ss, ACCOUNTS_SHEET, ACCOUNT_HEADERS);
  syncAccountHeaders_(sheet);
  return sheet;
}

function ensureScoreSheet_(ss) {
  return ensureSheet_(ss, SCORE_SHEET, SCORE_HEADERS);
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat("@");
    return sheet;
  }
  if (sheet.getLastRow() === 0 || asString_(sheet.getRange(1, 1).getValue()) === "") {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function idKey_(id) {
  return String(id == null ? "" : id)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isBlankId_(id) {
  return String(id == null ? "" : id).trim() === "";
}

function isBlankPassword_(password) {
  return password == null || String(password) === "";
}

function rejectBlank_(id, password) {
  if (isBlankId_(id) || isBlankPassword_(password)) {
    return { ok: false, error: "blank", message: MSG_BLANK };
  }
  return null;
}

function formatScore_(value, max, pct) {
  var hasValue = value !== "" && value != null;
  var maxNumber = Number(max);
  var hasMax = max !== "" && max != null && isFinite(maxNumber) && maxNumber > 0;
  if (hasValue && hasMax) return String(value) + "/" + String(max);
  if (pct !== "" && pct != null) {
    var text = String(pct);
    return text.indexOf("%") === -1 ? text + "%" : text;
  }
  if (hasValue) return String(value);
  return "";
}

function field_(row, map, name) {
  var index = map[name];
  if (index == null || index >= row.length) return "";
  var value = row[index];
  if (value == null) return "";
  return value;
}

function asString_(value) {
  if (value == null) return "";
  if (Object.prototype.toString.call(value) === "[object Date]") {
    try { return value.toISOString(); } catch (ignore) { return String(value); }
  }
  return String(value);
}

function stamp_(value) {
  return asString_(value);
}

function textOrEmpty_(value) {
  if (value == null) return "";
  return String(value);
}

function textCell_(value) {
  var s = String(value == null ? "" : value);
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

/**
 * Pack chunk cells only (AppProgress col 3, AppProgressMore col 4; General format).
 * Sheets treats a leading ' as a text marker and drops it, so a chunk that starts with '
 * is written as '' + rest. Reads need no change: getValue() already returns the text without the marker.
 */
function packChunkCell_(value) {
  var s = String(value == null ? "" : value);
  if (/^[=+\-@']/.test(s)) return "'" + s;
  return s;
}

function scoreCell_(value) {
  if (value == null || value === "") return "";
  return textCell_(value);
}

function newToken_() {
  var a = Utilities.getUuid().replace(/-/g, "");
  var b = Utilities.getUuid().replace(/-/g, "");
  return a + b;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function book_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error("missing body");
  }
  var parsed = JSON.parse(e.postData.contents);
  if (!parsed || typeof parsed !== "object") throw new Error("bad body");
  return parsed;
}

function loadPack_(body) {
  var gate = requireToken_(book_(), body, false);
  if (!gate.ok) return gate;
  var program = textOrEmpty_(body.program) || "decodable";
  try {
    var json = readPackJson_(book_(), gate.id_key, program);
    return { ok: true, found: json !== "", progress_json: json };
  } catch (err) {
    return { ok: false, error: "pack_load_failed", message: "Could not load progress pack." };
  }
}

function savePack_(body) {
  return withLock_(function () {
    var ss = book_();
    var gate = requireToken_(ss, body, true);
    if (!gate.ok) return gate;
    var program = textOrEmpty_(body.program) || "decodable";
    var incoming = String(body.progress_json || "{}");
    var mainSheet = packSheet_(ss);
    var mainRowNum = findPackMainRow_(mainSheet, gate.id_key, program);
    var chunk0 = mainRowNum ? asString_(mainSheet.getRange(mainRowNum, 3).getValue()) : "";
    var moreSheet = ss.getSheetByName(PACK_MORE_SHEET);
    var moreValues = readPackMoreValues_(moreSheet);
    var moreParsed = parsePackMoreFromValues_(moreValues, gate.id_key, program);
    var stored = packJsonFromMainAndMore_(chunk0, moreParsed);
    var merged = mergeProgressJson_(stored, incoming, program);
    if (signInRoleForIdKey_(gate.id_key) === "teacher") {
      merged = tagProgressJsonWithTeacherRole_(merged);
    } else if (body.metadata_json && metadataRoleIsTeacher_(parseMetadataJson_(body.metadata_json))) {
      merged = tagProgressJsonWithTeacherRole_(merged);
    }
    var split = splitProgressChunks_(merged);
    if (split.error) {
      return {
        ok: false,
        error: "too_large",
        message: "Progress data is too large to store.",
        maxChars: MAX_PROGRESS_TOTAL_CHARS
      };
    }
    writePackChunks_(ss, gate.id_key, program, split.chunks, moreValues);
    return { ok: true, saved: true };
  });
}

function splitProgressChunks_(text) {
  var s = String(text == null ? "" : text);
  if (!s) return { chunks: [""] };
  if (s.length > MAX_PROGRESS_TOTAL_CHARS) return { error: "too_large" };
  var chunks = [];
  var i = 0;
  while (i < s.length) {
    var end = Math.min(i + CHUNK_CHAR_MAX, s.length);
    if (end < s.length) {
      var code = s.charCodeAt(end - 1);
      if (code >= 0xD800 && code <= 0xDBFF) end -= 1;
    }
    chunks.push(s.substring(i, end));
    i = end;
  }
  if (chunks.length > MAX_PROGRESS_CHUNKS) return { error: "too_large" };
  return { chunks: chunks };
}

function joinProgressChunks_(chunks) {
  if (!chunks || !chunks.length) return "";
  return chunks.map(function (c) { return String(c == null ? "" : c); }).join("");
}

function packSheet_(ss) {
  var sheet = ss.getSheetByName(PACK_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PACK_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([["id_key", "program", "progress_json", "updated_at"]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function packMoreSheet_(ss, createIfMissing) {
  var sheet = ss.getSheetByName(PACK_MORE_SHEET);
  if (sheet) return sheet;
  if (!createIfMissing) return null;
  // Only called from save_pack, which already holds the script lock. Do not take/release the
  // lock again here: releaseLock() would drop the caller's lock in the middle of the save.
  sheet = ss.insertSheet(PACK_MORE_SHEET);
  sheet.getRange(1, 1, 1, 4).setValues([["id_key", "program", "part", "chunk"]]);
  sheet.setFrozenRows(1);
  return sheet;
}

function findPackMainRow_(sheet, idKey, program) {
  if (sheet.getLastRow() < 2) return 0;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (asString_(values[i][0]) !== idKey) continue;
    if (asString_(values[i][1]) !== program) continue;
    return i + 1;
  }
  return 0;
}

function parsePackMoreFromValues_(values, idKey, program) {
  var total = 1;
  var parts = {};
  var rowByPart = {};
  if (!values || values.length < 2) return { total: total, parts: parts, rowByPart: rowByPart };
  for (var i = 1; i < values.length; i++) {
    if (asString_(values[i][0]) !== idKey) continue;
    if (asString_(values[i][1]) !== program) continue;
    var part = parseInt(values[i][2], 10);
    if (!isFinite(part)) continue;
    rowByPart[part] = i + 1;
    if (part === 0) {
      var n = parseInt(values[i][3], 10);
      if (isFinite(n) && n >= 1) total = n;
    } else if (part >= 1) {
      parts[part] = asString_(values[i][3]);
    }
  }
  return { total: total, parts: parts, rowByPart: rowByPart };
}

function readPackMoreValues_(moreSheet) {
  if (!moreSheet || moreSheet.getLastRow() < 1) return [];
  return moreSheet.getDataRange().getValues();
}

function packJsonFromMainAndMore_(chunk0, moreParsed) {
  var total = moreParsed.total;
  if (total <= 1) return chunk0;
  var more = [];
  for (var p = 1; p < total; p++) {
    more.push(moreParsed.parts[p] != null ? moreParsed.parts[p] : "");
  }
  return joinProgressChunks_([chunk0].concat(more));
}

function readPackJson_(ss, idKey, program) {
  var sheet = packSheet_(ss);
  if (sheet.getLastRow() < 2) return "";
  var rowNum = findPackMainRow_(sheet, idKey, program);
  if (!rowNum) return "";
  var chunk0 = asString_(sheet.getRange(rowNum, 3).getValue());
  var moreSheet = ss.getSheetByName(PACK_MORE_SHEET);
  var moreValues = readPackMoreValues_(moreSheet);
  var moreParsed = parsePackMoreFromValues_(moreValues, idKey, program);
  return packJsonFromMainAndMore_(chunk0, moreParsed);
}

function packMoreRow_(idKey, program, part, chunk) {
  return [textCell_(idKey), textCell_(program), textCell_(part), packChunkCell_(chunk)];
}

function deletePackMoreRowsForStudent_(moreSheet, values, idKey, program, keepPartsUpTo) {
  if (!moreSheet || !values || values.length < 2) return;
  var runs = [];
  var total = 0;
  for (var i = values.length - 1; i >= 1; i--) {
    if (asString_(values[i][0]) !== idKey) continue;
    if (asString_(values[i][1]) !== program) continue;
    var part = parseInt(values[i][2], 10);
    if (!isFinite(part)) continue;
    if (keepPartsUpTo != null && part <= keepPartsUpTo) continue;
    var rowNum = i + 1;
    var last = runs.length ? runs[runs.length - 1] : null;
    if (last && last.start === rowNum + 1) {
      last.start = rowNum;
      last.count++;
    } else {
      runs.push({ start: rowNum, count: 1 });
    }
    total++;
  }
  if (!runs.length) return;
  var maxRows = moreSheet.getMaxRows();
  if (maxRows - total <= moreSheet.getFrozenRows()) moreSheet.insertRowsAfter(maxRows, 1);
  for (var r = 0; r < runs.length; r++) moreSheet.deleteRows(runs[r].start, runs[r].count);
}

function writePackMoreRowBatches_(moreSheet, startRow, rows) {
  for (var a = 0; a < rows.length; a += PACK_WRITE_BATCH_ROWS) {
    var slice = rows.slice(a, a + PACK_WRITE_BATCH_ROWS);
    moreSheet.getRange(startRow + a, 1, slice.length, 4).setValues(slice);
  }
}

function writePackMoreChunks_(moreSheet, moreValues, idKey, program, chunks) {
  var count = chunks.length;
  var parsed = parsePackMoreFromValues_(moreValues, idKey, program);
  var rowByPart = parsed.rowByPart;
  var updates = [];
  var appends = [];
  for (var p = 1; p < count; p++) {
    var row = packMoreRow_(idKey, program, p, chunks[p]);
    var rowNum = rowByPart[p];
    if (rowNum) {
      updates.push({ row: rowNum, data: row });
    } else {
      appends.push(row);
    }
  }
  var metaRow = packMoreRow_(idKey, program, 0, String(count));
  var metaRowNum = rowByPart[0];
  if (metaRowNum) {
    updates.push({ row: metaRowNum, data: metaRow });
  } else {
    appends.push(metaRow);
  }
  if (appends.length) {
    var startRow = Math.max(moreSheet.getLastRow(), 1) + 1;
    var needLast = startRow + appends.length - 1;
    var maxRows = moreSheet.getMaxRows();
    if (needLast > maxRows) moreSheet.insertRowsAfter(maxRows, needLast - maxRows);
    writePackMoreRowBatches_(moreSheet, startRow, appends);
  }
  updates.sort(function (a, b) { return a.row - b.row; });
  var batchStart = -1;
  var batchRows = [];
  for (var u = 0; u < updates.length; u++) {
    var item = updates[u];
    if (batchStart < 0) {
      batchStart = item.row;
      batchRows = [item.data];
    } else if (item.row === batchStart + batchRows.length && batchRows.length < PACK_WRITE_BATCH_ROWS) {
      batchRows.push(item.data);
    } else {
      moreSheet.getRange(batchStart, 1, batchRows.length, 4).setValues(batchRows);
      batchStart = item.row;
      batchRows = [item.data];
    }
  }
  if (batchStart >= 0 && batchRows.length) {
    moreSheet.getRange(batchStart, 1, batchRows.length, 4).setValues(batchRows);
  }
  deletePackMoreRowsForStudent_(moreSheet, moreValues, idKey, program, count - 1);
}

function writePackChunks_(ss, idKey, program, chunks, moreValuesCached) {
  var sheet = packSheet_(ss);
  var now = new Date().toISOString();
  var count = chunks.length;
  var rowNum = findPackMainRow_(sheet, idKey, program);
  if (count > 1) {
    var more = packMoreSheet_(ss, true);
    var moreValues = moreValuesCached != null ? moreValuesCached : readPackMoreValues_(more);
    writePackMoreChunks_(more, moreValues, idKey, program, chunks);
  } else {
    var moreSheet = ss.getSheetByName(PACK_MORE_SHEET);
    if (moreSheet) {
      var values = moreValuesCached != null ? moreValuesCached : readPackMoreValues_(moreSheet);
      deletePackMoreRowsForStudent_(moreSheet, values, idKey, program, null);
    }
  }
  var mainRow = [textCell_(idKey), textCell_(program), packChunkCell_(chunks[0] || ""), textCell_(now)];
  if (rowNum) {
    sheet.getRange(rowNum, 1, 1, 4).setValues([mainRow]);
  } else {
    sheet.appendRow(mainRow);
  }
}

function toNum_(n) {
  var x = +n;
  return isFinite(x) ? x : 0;
}

function higherNum_(x, y) {
  var ax = (x == null || x === "" || !isFinite(+x)) ? null : +x;
  var ay = (y == null || y === "" || !isFinite(+y)) ? null : +y;
  if (ax == null) return ay;
  if (ay == null) return ax;
  return Math.max(ax, ay);
}

function mergeSpeakPages_(a, b) {
  var out = {};
  var maps = [a, b];
  for (var i = 0; i < maps.length; i++) {
    var m = maps[i];
    if (!m || typeof m !== "object") continue;
    var keys = Object.keys(m);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var n = +m[key];
      if (!isFinite(n)) continue;
      if (out[key] == null || n > out[key]) out[key] = n;
    }
  }
  return out;
}

function unionList_(a, b) {
  var out = [];
  var seen = {};
  var lists = [a, b];
  for (var i = 0; i < lists.length; i++) {
    var list = lists[i];
    if (!Array.isArray(list)) continue;
    for (var j = 0; j < list.length; j++) {
      var s = String(list[j]);
      if (!s || seen[s]) continue;
      seen[s] = 1;
      out.push(s);
    }
  }
  return out;
}

function startsWithList_(full, prefix) {
  if (!Array.isArray(prefix) || !prefix.length) return true;
  if (!Array.isArray(full) || prefix.length > full.length) return false;
  for (var i = 0; i < prefix.length; i++) {
    if (JSON.stringify(full[i]) !== JSON.stringify(prefix[i])) return false;
  }
  return true;
}

function concatLast_(a, b, n) {
  var aa = Array.isArray(a) ? a : [];
  var bb = Array.isArray(b) ? b : [];
  var merged;
  if (startsWithList_(bb, aa)) merged = bb;
  else if (startsWithList_(aa, bb)) merged = aa;
  else merged = aa.concat(bb);
  return merged.slice(-n);
}

function unionTrueMap_(a, b) {
  var out = {};
  var maps = [a, b];
  for (var i = 0; i < maps.length; i++) {
    var m = maps[i];
    if (!m || typeof m !== "object") continue;
    var keys = Object.keys(m);
    for (var k = 0; k < keys.length; k++) {
      if (m[keys[k]]) out[keys[k]] = true;
    }
  }
  return out;
}

function mergeBookFlags_(stored, incoming) {
  var a = (stored && typeof stored === "object") ? stored : {};
  var b = (incoming && typeof incoming === "object") ? incoming : {};
  var out = {};
  var flags = ["passed", "listen", "song", "read", "dictation", "speak"];
  for (var i = 0; i < flags.length; i++) {
    var key = flags[i];
    out[key] = !!(a[key] || b[key]);
  }
  out.dictScore = higherNum_(a.dictScore, b.dictScore);
  out.speakPages = mergeSpeakPages_(a.speakPages, b.speakPages);
  out.reported = unionList_(a.reported, b.reported);
  out.speakFails = concatLast_(a.speakFails, b.speakFails, 40);
  out.readPages = unionTrueMap_(a.readPages, b.readPages);
  out.difficulty = (b.difficulty != null && b.difficulty !== "") ? b.difficulty : ((a.difficulty != null && a.difficulty !== "") ? a.difficulty : null);
  out._rev = Math.max(toNum_(a._rev), toNum_(b._rev));
  return out;
}

function mergeBookBag_(stored, incoming) {
  var a = (stored && typeof stored === "object") ? stored : {};
  var b = (incoming && typeof incoming === "object") ? incoming : {};
  var out = {};
  var seen = {};
  var ids = Object.keys(a).concat(Object.keys(b));
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    if (seen[id]) continue;
    seen[id] = 1;
    out[id] = mergeBookFlags_(a[id], b[id]);
  }
  return out;
}

function parseProgress_(raw) {
  try {
    var data = JSON.parse(String(raw || ""));
    if (!data || typeof data !== "object" || !data.books || typeof data.books !== "object") return null;
    return data;
  } catch (err) {
    return null;
  }
}

function mergeProgressJson_(storedRaw, incomingRaw, program) {
  var incomingStr = String(incomingRaw == null ? "{}" : incomingRaw);
  var programKey = String(program || "").trim().toLowerCase();
  if (programKey !== "decodable") return incomingStr;
  var incoming = parseProgress_(incomingStr);
  if (!incoming) return String(storedRaw || "{}");
  var stored = parseProgress_(storedRaw);
  if (!stored) return incomingStr;
  var books = mergeBookBag_(stored.books, incoming.books);
  var rev = Math.max(toNum_(stored.rev), toNum_(incoming.rev));
  return JSON.stringify({ v: 2, rev: rev, books: books });
}

function json_(obj) {
  var payload = obj || { ok: false, error: "server", message: "Something went wrong." };
  if (Object.prototype.hasOwnProperty.call(payload, "password")) {
    delete payload.password;
  }
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Owner-run: rebuild StudentScoreIndex from ClassroomMetrics history.
 * Run from the Apps Script editor (Run > backfillStudentScoreIndex).
 * Safe to re-run; resumes via Script Properties cursor. Clears cursor when done.
 */
function backfillStudentScoreIndex() {
  return backfillStudentScoreIndexChunk_();
}

function backfillStudentScoreIndexChunk_() {
  var props = PropertiesService.getScriptProperties();
  var ss = book_();
  var metrics = ss.getSheetByName(METRICS_SHEET);
  if (!metrics) return { ok: false, error: "no_metrics" };
  var lastRow = metrics.getLastRow();
  if (lastRow < 2) {
    props.deleteProperty(BACKFILL_PROP);
    return { ok: true, done: true, message: "No metrics rows." };
  }
  var lastCol = metrics.getLastColumn();
  var header = metrics.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var c = 0; c < header.length; c++) map[String(header[c]).trim()] = c;

  var cursor = parseInt(props.getProperty(BACKFILL_PROP), 10);
  if (!isFinite(cursor) || cursor < 2) cursor = 2;
  if (cursor > lastRow) {
    props.deleteProperty(BACKFILL_PROP);
    return { ok: true, done: true, message: "Backfill complete." };
  }

  var indexMap = readScoreIndexMap_(ss);
  var started = Date.now();
  var processed = 0;
  var merged = 0;
  var changed = {};
  var runStartCursor = cursor;

  while (cursor <= lastRow) {
    if (Date.now() - started > BACKFILL_TIME_BUDGET_MS) break;
    var batchEnd = Math.min(lastRow, cursor + METRICS_READ_BATCH - 1);
    var numRows = batchEnd - cursor + 1;
    var values = metrics.getRange(cursor, 1, numRows, lastCol).getValues();
    for (var ri = 0; ri < values.length; ri++) {
      var rec = scoreFromMetricsRow_(values[ri], map);
      if (rec) {
        var key = rec.id_key + "\0" + rec.program + "\0" + rec.item_id;
        var existing = indexMap[key];
        if (!existing || scoreRecIsNewer_(rec, existing)) {
          if (existing && existing.row) rec.row = existing.row;
          indexMap[key] = rec;
          changed[key] = 1;
          merged++;
        }
      }
      processed++;
    }
    cursor = batchEnd + 1;
  }

  var flushed = flushScoreIndexMap_(ss, indexMap, changed);
  if (!flushed) {
    props.setProperty(BACKFILL_PROP, String(runStartCursor));
    return {
      ok: true,
      done: false,
      flush_busy: true,
      nextRow: runStartCursor,
      processed: processed,
      merged: merged
    };
  }

  if (cursor > lastRow) {
    props.deleteProperty(BACKFILL_PROP);
    return { ok: true, done: true, processed: processed, merged: merged };
  }
  props.setProperty(BACKFILL_PROP, String(cursor));
  return { ok: true, done: false, nextRow: cursor, processed: processed, merged: merged };
}

function scoreRecIsNewer_(a, b) {
  return compareUpdated_(a.updated_at, b.updated_at) > 0;
}

function compareUpdated_(a, b) {
  var sa = asString_(a);
  var sb = asString_(b);
  if (sa === sb) return 0;
  if (sa > sb) return 1;
  if (sa < sb) return -1;
  return 0;
}

function readScoreIndexMap_(ss) {
  var map = {};
  var sheet = ensureScoreSheet_(ss);
  if (sheet.getLastRow() < 2) return map;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var rec = {
      id_key: asString_(values[i][0]),
      program: asString_(values[i][1]),
      item_id: asString_(values[i][2]),
      score_value: values[i][3],
      score_max: values[i][4],
      score_pct: values[i][5],
      local_date: asString_(values[i][6]),
      updated_at: asString_(values[i][7]),
      row: i + 1
    };
    var key = rec.id_key + "\0" + rec.program + "\0" + rec.item_id;
    map[key] = rec;
  }
  return map;
}

function flushScoreIndexMap_(ss, map, changed) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(FLUSH_LOCK_MS)) return false;
  try {
    var sheet = ensureScoreSheet_(ss);
    var liveMap = readScoreIndexMap_(ss);
    var keys = changed ? Object.keys(changed) : Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      var rec = map[keys[i]];
      if (!rec) continue;
      var live = liveMap[keys[i]];
      if (live && !scoreRecIsNewer_(rec, live)) continue;
      if (live && live.row) rec.row = live.row;
      var row = [
        textCell_(rec.id_key),
        textCell_(rec.program),
        textCell_(rec.item_id),
        scoreCell_(rec.score_value),
        scoreCell_(rec.score_max),
        scoreCell_(rec.score_pct),
        textCell_(rec.local_date),
        textCell_(rec.updated_at)
      ];
      var rowNumber = rec.row || 0;
      if (!rowNumber) rowNumber = Math.max(sheet.getLastRow(), 1) + 1;
      var range = sheet.getRange(rowNumber, 1, 1, row.length);
      range.setNumberFormat("@");
      range.setValues([row]);
      rec.row = rowNumber;
    }
    return true;
  } finally {
    lock.releaseLock();
  }
}

function scoreFromMetricsRow_(row, map) {
  if (metricsRowIsTeacherTagged_(row, map)) return null;
  var kind = metricsEventKind_(row, map);
  if (isExcludedMetricsEvent_(kind)) return null;
  var scoreValue = field_(row, map, "score_value");
  var scorePct = field_(row, map, "score_pct");
  var hasScore = (scoreValue !== "" && scoreValue != null) || (scorePct !== "" && scorePct != null);
  if (kind !== "learning_result" && !hasScore) return null;

  var idKey = "";
  var sessionName = nameFromSession_(field_(row, map, "session_id"));
  if (sessionName) idKey = idKey_(sessionName);
  if (!idKey) {
    var email = asString_(field_(row, map, "student_email")).trim();
    if (email && email.toLowerCase() !== "unknown") {
      var at = email.indexOf("@");
      if (at > 0) idKey = idKey_(email.slice(0, at));
      else idKey = idKey_(email);
    }
  }
  if (!idKey) {
    var sid = asString_(field_(row, map, "student_id")).trim();
    if (sid) idKey = idKey_(sid);
  }
  if (!idKey) return null;

  var program = asString_(field_(row, map, "curriculum_program")).trim();
  if (!program) program = asString_(field_(row, map, "source")).trim();
  var item = asString_(field_(row, map, "item_id")).trim();
  if (!program || !item) return null;

  var updated = asString_(field_(row, map, "timestamp")).trim();
  if (!updated) updated = new Date().toISOString();

  return {
    id_key: idKey,
    program: program,
    item_id: item,
    score_value: scoreValue,
    score_max: field_(row, map, "score_max"),
    score_pct: scorePct,
    local_date: asString_(field_(row, map, "local_date")).trim(),
    updated_at: updated
  };
}

/**
 * Time-based trigger handler (install manually: Triggers > Add > stampRecentNames, every 10 minutes).
 * Requires spreadsheets scope only; does not run on student sign-in.
 */
function stampRecentNames() {
  stampNamesFor_(book_(), "");
}

function stampNamesFor_(ss, onlyKey) {
  var sheet = ss.getSheetByName(METRICS_SHEET);
  if (!sheet) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var start = Math.max(2, lastRow - 1499);
  var num = lastRow - start + 1;
  var emails = sheet.getRange(start, 2, num, 1).getValues();
  var sessions = sheet.getRange(start, 3, num, 1).getValues();
  var changed = 0;
  for (var i = 0; i < emails.length; i++) {
    var email = asString_(emails[i][0]).trim().toLowerCase();
    if (email && email !== "unknown") continue;
    var name = nameFromSession_(sessions[i][0]);
    if (!name) continue;
    if (onlyKey && idKey_(name) !== onlyKey) continue;
    emails[i][0] = name;
    changed++;
  }
  if (changed) sheet.getRange(start, 2, num, 1).setValues(emails);
  return changed;
}

function nameFromSession_(sessionId) {
  var parts = asString_(sessionId).split("-");
  if (parts.length < 2) return "";
  var name = "";
  if (parts.length >= 4 && /^\d{4}$/.test(parts[parts.length - 3]) && /^\d{2}$/.test(parts[parts.length - 2]) && /^\d{2}$/.test(parts[parts.length - 1])) {
    name = parts[parts.length - 4];
  } else {
    name = parts[parts.length - 1];
  }
  var key = idKey_(name);
  if (!key || key === "unknown" || key === "anon" || key === "mrj") return "";
  return name;
}
