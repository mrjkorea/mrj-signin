/**
 * PROPOSED server changes — NOT deployed automatically.
 * Copy into the live Apps Script project and redeploy (see SERVER_REDEPLOY.md).
 * Front-end mrj-auth.js does not depend on this revision.
 */
var SPREADSHEET_ID = "1bpgekxlektvwpsef1PmIkxPiDuHrkVXFaAy-OmwqL5c";
var APP_VERSION = "1.3.0";
var ACCOUNTS_SHEET = "StudentAccounts";
var SCORE_SHEET = "StudentScoreIndex";
var METRICS_SHEET = "ClassroomMetrics";
var METRICS_TAIL = 4000;
var ACCOUNT_CACHE_TTL_SEC = 45;
var MAX_ACTIVE_TOKENS = 5;
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
  var progress = [];
  try {
    progress = loadProgress_(book_(), gate.id_key);
  } catch (ignore) {
    progress = [];
  }
  return {
    ok: true,
    error: "",
    message: "",
    id: gate.id,
    token: gate.token,
    progress: progress
  };
}

function noteScore_(body) {
  return withLock_(function () {
    var ss = book_();
    var gate = requireToken_(ss, body, true);
    if (!gate.ok) return gate;
    var now = new Date().toISOString();
    upsertScore_(ss, {
      id_key: gate.id_key,
      program: textOrEmpty_(body.program),
      item_id: textOrEmpty_(body.itemId),
      score_value: body.scoreValue,
      score_max: body.scoreMax,
      score_pct: body.scorePct,
      local_date: textOrEmpty_(body.localDate),
      updated_at: now
    });
    return {
      ok: true,
      error: "",
      message: "",
      id: gate.id,
      progress: loadProgress_(ss, gate.id_key)
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

function loadProgress_(ss, idKey) {
  return readScoreIndex_(ss, idKey);
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
  for (var n = 0; n < found.length && n < 20; n++) {
    out.push({
      program: found[n].program,
      item: found[n].item,
      score: found[n].score,
      date: found[n].date
    });
  }
  return out;
}

function findAccount_(ss, key, skipCache) {
  if (!key) return null;
  if (!skipCache) {
    var cached = readAccountCache_(key);
    if (cached) return cached;
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
  return withLock_(function () {
    var ss = book_();
    var gate = requireToken_(ss, body, true);
    if (!gate.ok) return gate;
    var program = textOrEmpty_(body.program) || "decodable";
    var sheet = packSheet_(ss);
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === gate.id_key && String(values[i][1]) === program) {
        return { ok: true, found: true, progress_json: String(values[i][2] || "") };
      }
    }
    return { ok: true, found: false, progress_json: "" };
  });
}

function savePack_(body) {
  return withLock_(function () {
    var ss = book_();
    var gate = requireToken_(ss, body, true);
    if (!gate.ok) return gate;
    var program = textOrEmpty_(body.program) || "decodable";
    var progress = String(body.progress_json || "{}").substring(0, 45000);
    var sheet = packSheet_(ss);
    var values = sheet.getDataRange().getValues();
    var now = new Date().toISOString();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === gate.id_key && String(values[i][1]) === program) {
        sheet.getRange(i + 1, 3, 1, 2).setValues([[progress, now]]);
        return { ok: true, saved: true };
      }
    }
    sheet.appendRow([gate.id_key, program, progress, now]);
    return { ok: true, saved: true };
  });
}

function packSheet_(ss) {
  var sheet = ss.getSheetByName("AppProgress");
  if (!sheet) {
    sheet = ss.insertSheet("AppProgress");
    sheet.getRange(1, 1, 1, 4).setValues([["id_key", "program", "progress_json", "updated_at"]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
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
