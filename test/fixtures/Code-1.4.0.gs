/**
 * MRJ shared sign-in. Standalone Apps Script web app.
 * Same metrics book as the score receiver. This file does not replace that receiver.
 *
 * Login never creates an account. A missing name stays missing.
 * Passwords are stored for an exact match and are never returned or logged.
 */
var SPREADSHEET_ID = "1bpgekxlektvwpsef1PmIkxPiDuHrkVXFaAy-OmwqL5c";
var APP_VERSION = "1.4.0";
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
var MAX_PROGRESS_CHUNKS = 12;
var METRICS_FALLBACK_TAIL = 12000;
var BACKFILL_PROP = "backfill_score_index_cursor";
var BACKFILL_TIME_BUDGET_MS = 270000;
var METRICS_READ_BATCH = 2000;
var FLUSH_LOCK_MS = 5000;

var ACCOUNT_HEADERS = ["id_display", "id_key", "password", "created_at", "last_login", "token"];
var SCORE_HEADERS = ["id_key", "program", "item_id", "score_value", "score_max", "score_pct", "local_date", "updated_at"];

var MSG_BLANK = "Type an ID and a password.";
var MSG_MISSING = "User does not exist.";
var MSG_WRONG = "Wrong password.";
var MSG_TAKEN = "That ID is already used. Log in instead.";
var MSG_TOKEN = "Sign in again.";

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
    var now = new Date().toISOString();
    var token = newToken_();
    var display = String(body.id);
    appendAccount_(ss, {
      id_display: display,
      id_key: key,
      password: String(body.password),
      created_at: now,
      last_login: now,
      token: token
    });
    bustAccountCache_(key);
    return {
      ok: true,
      error: "",
      message: "",
      id: display,
      token: token,
      progress: []
    };
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
    var token = newToken_();
    var now = new Date().toISOString();
    var tokenField = pushToken_(existing.token, token);
    writeAccountCells_(existing.sheet, existing.row, {
      last_login: now,
      token: tokenField
    });
    bustAccountCache_(key);
    return {
      ok: true,
      error: "",
      message: "",
      id: existing.id_display,
      token: token,
      progress: []
    };
  });
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
    var page = pageProgressRows_(all, offset, limit);
    return {
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
    };
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
    upsertScore_(ss, {
      id_key: gate.id_key,
      program: program,
      item_id: textOrEmpty_(body.itemId),
      score_value: body.scoreValue,
      score_max: body.scoreMax,
      score_pct: body.scorePct,
      local_date: textOrEmpty_(body.localDate),
      updated_at: now
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
    var kind = asString_(field_(row, map, "event_kind")).trim().toLowerCase();
    if (kind === "effort_sample") continue;
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
  var found = [];
  for (var i = 1; i < values.length; i++) {
    if (asString_(values[i][0]) !== idKey) continue;
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
  for (var i = 1; i < values.length; i++) {
    if (asString_(values[i][1]) !== key) continue;
    var row = {
      sheet: sheet,
      row: i + 1,
      id_display: asString_(values[i][0]),
      id_key: asString_(values[i][1]),
      password: asString_(values[i][2]),
      token: asString_(values[i][5])
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
    token: cached.token
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
      token: row.token
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
  var row = [
    textCell_(rec.id_display),
    textCell_(rec.id_key),
    textCell_(rec.password),
    textCell_(rec.created_at),
    textCell_(rec.last_login),
    textCell_(rec.token)
  ];
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
}

function upsertScore_(ss, rec) {
  var sheet = ensureScoreSheet_(ss);
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
  if (!rowNumber) rowNumber = Math.max(sheet.getLastRow(), 1) + 1;
  var range = sheet.getRange(rowNumber, 1, 1, row.length);
  range.setNumberFormat("@");
  range.setValues([row]);
}

function ensureAccounts_(ss) {
  return ensureSheet_(ss, ACCOUNTS_SHEET, ACCOUNT_HEADERS);
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
    var stored = readPackJson_(ss, gate.id_key, program);
    var merged = mergeProgressJson_(stored, incoming, program);
    var split = splitProgressChunks_(merged);
    if (split.error) {
      return {
        ok: false,
        error: "too_large",
        message: "Progress data is too large to store.",
        maxChars: CHUNK_CHAR_MAX * MAX_PROGRESS_CHUNKS
      };
    }
    writePackChunks_(ss, gate.id_key, program, split.chunks);
    return { ok: true, saved: true };
  });
}

function splitProgressChunks_(text) {
  var s = String(text == null ? "" : text);
  if (!s) return { chunks: [""] };
  var chunks = [];
  for (var i = 0; i < s.length; i += CHUNK_CHAR_MAX) {
    chunks.push(s.substring(i, i + CHUNK_CHAR_MAX));
  }
  if (chunks.length > MAX_PROGRESS_CHUNKS) {
    return { error: "too_large" };
  }
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
  var lock = LockService.getScriptLock();
  lock.waitLock(FLUSH_LOCK_MS);
  try {
    sheet = ss.getSheetByName(PACK_MORE_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(PACK_MORE_SHEET);
      sheet.getRange(1, 1, 1, 4).setValues([["id_key", "program", "part", "chunk"]]);
      sheet.setFrozenRows(1);
    }
    return sheet;
  } finally {
    lock.releaseLock();
  }
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

function readPackChunkTotal_(ss, idKey, program) {
  var sheet = ss.getSheetByName(PACK_MORE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return 1;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (asString_(values[i][0]) !== idKey) continue;
    if (asString_(values[i][1]) !== program) continue;
    if (parseInt(values[i][2], 10) !== 0) continue;
    var n = parseInt(values[i][3], 10);
    if (isFinite(n) && n >= 1) return n;
  }
  return 1;
}

function readPackJson_(ss, idKey, program) {
  var sheet = packSheet_(ss);
  if (sheet.getLastRow() < 2) return "";
  var rowNum = findPackMainRow_(sheet, idKey, program);
  if (!rowNum) return "";
  var chunk0 = asString_(sheet.getRange(rowNum, 3).getValue());
  var total = readPackChunkTotal_(ss, idKey, program);
  if (total <= 1) return chunk0;
  var more = readPackMoreChunks_(ss, idKey, program, total);
  return joinProgressChunks_([chunk0].concat(more));
}

function readPackMoreChunks_(ss, idKey, program, total) {
  var sheet = ss.getSheetByName(PACK_MORE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var parts = {};
  for (var i = 1; i < values.length; i++) {
    if (asString_(values[i][0]) !== idKey) continue;
    if (asString_(values[i][1]) !== program) continue;
    var part = parseInt(values[i][2], 10);
    if (!isFinite(part) || part < 1) continue;
    parts[part] = asString_(values[i][3]);
  }
  var out = [];
  for (var p = 1; p < total; p++) {
    out.push(parts[p] != null ? parts[p] : "");
  }
  return out;
}

function upsertPackMorePart_(moreSheet, idKey, program, part, chunk) {
  var values = moreSheet.getLastRow() >= 1 ? moreSheet.getDataRange().getValues() : [];
  var rowNum = 0;
  for (var i = 1; i < values.length; i++) {
    if (asString_(values[i][0]) !== idKey) continue;
    if (asString_(values[i][1]) !== program) continue;
    if (parseInt(values[i][2], 10) !== part) continue;
    rowNum = i + 1;
    break;
  }
  var row = [textCell_(idKey), textCell_(program), textCell_(part), textCell_(chunk)];
  if (rowNum) {
    moreSheet.getRange(rowNum, 1, 1, 4).setValues([row]);
  } else {
    moreSheet.appendRow(row);
  }
}

function deletePackMorePartsAbove_(moreSheet, idKey, program, maxPart) {
  if (moreSheet.getLastRow() < 2) return;
  var values = moreSheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (asString_(values[i][0]) !== idKey) continue;
    if (asString_(values[i][1]) !== program) continue;
    var part = parseInt(values[i][2], 10);
    if (!isFinite(part)) continue;
    if (part === 0) continue;
    if (part > maxPart) moreSheet.deleteRow(i + 1);
  }
}

function deleteAllPackMore_(moreSheet, idKey, program) {
  if (moreSheet.getLastRow() < 2) return;
  var values = moreSheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (asString_(values[i][0]) !== idKey) continue;
    if (asString_(values[i][1]) !== program) continue;
    moreSheet.deleteRow(i + 1);
  }
}

function writePackChunks_(ss, idKey, program, chunks) {
  var sheet = packSheet_(ss);
  var now = new Date().toISOString();
  var count = chunks.length;
  var rowNum = findPackMainRow_(sheet, idKey, program);
  if (count > 1) {
    var more = packMoreSheet_(ss, true);
    for (var p = 1; p < count; p++) {
      upsertPackMorePart_(more, idKey, program, p, chunks[p]);
    }
    upsertPackMorePart_(more, idKey, program, 0, String(count));
    deletePackMorePartsAbove_(more, idKey, program, count - 1);
  } else {
    var moreSheet = ss.getSheetByName(PACK_MORE_SHEET);
    if (moreSheet) deleteAllPackMore_(moreSheet, idKey, program);
  }
  var mainRow = [textCell_(idKey), textCell_(program), textCell_(chunks[0] || ""), textCell_(now)];
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
  var kind = asString_(field_(row, map, "event_kind")).trim().toLowerCase();
  if (kind === "effort_sample") return null;
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
