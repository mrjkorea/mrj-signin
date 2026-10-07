/**
 * Pure sign-in server logic mirrored in Code.gs (1.4.0). Node tests import this module.
 */
"use strict";

const CHUNK_CHAR_MAX = 40000;
const MAX_CHUNKS = 12;

function toNum(n) {
  const x = +n;
  return isFinite(x) ? x : 0;
}

function higherNum(x, y) {
  const ax = x == null || x === "" || !isFinite(+x) ? null : +x;
  const ay = y == null || y === "" || !isFinite(+y) ? null : +y;
  if (ax == null) return ay;
  if (ay == null) return ax;
  return Math.max(ax, ay);
}

function mergeSpeakPages_(a, b) {
  const out = {};
  for (const m of [a, b]) {
    if (!m || typeof m !== "object") continue;
    for (const key of Object.keys(m)) {
      const n = +m[key];
      if (!isFinite(n)) continue;
      if (out[key] == null || n > out[key]) out[key] = n;
    }
  }
  return out;
}

function unionList_(a, b) {
  const out = [];
  const seen = {};
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const s = String(item);
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
  for (let i = 0; i < prefix.length; i++) {
    if (JSON.stringify(full[i]) !== JSON.stringify(prefix[i])) return false;
  }
  return true;
}

function concatLast_(a, b, n) {
  const aa = Array.isArray(a) ? a : [];
  const bb = Array.isArray(b) ? b : [];
  let merged;
  if (startsWithList_(bb, aa)) merged = bb;
  else if (startsWithList_(aa, bb)) merged = aa;
  else merged = aa.concat(bb);
  return merged.slice(-n);
}

function unionTrueMap_(a, b) {
  const out = {};
  for (const m of [a, b]) {
    if (!m || typeof m !== "object") continue;
    for (const key of Object.keys(m)) {
      if (m[key]) out[key] = true;
    }
  }
  return out;
}

function mergeBookFlags_(stored, incoming) {
  const a = stored && typeof stored === "object" ? stored : {};
  const b = incoming && typeof incoming === "object" ? incoming : {};
  const out = {};
  const flags = ["passed", "listen", "song", "read", "dictation", "speak"];
  for (const key of flags) {
    out[key] = !!(a[key] || b[key]);
  }
  out.dictScore = higherNum(a.dictScore, b.dictScore);
  out.speakPages = mergeSpeakPages_(a.speakPages, b.speakPages);
  out.reported = unionList_(a.reported, b.reported);
  out.speakFails = concatLast_(a.speakFails, b.speakFails, 40);
  out.readPages = unionTrueMap_(a.readPages, b.readPages);
  out.difficulty =
    b.difficulty != null && b.difficulty !== ""
      ? b.difficulty
      : a.difficulty != null && a.difficulty !== ""
        ? a.difficulty
        : null;
  out._rev = Math.max(toNum(a._rev), toNum(b._rev));
  return out;
}

function mergeBookBag_(stored, incoming) {
  const a = stored && typeof stored === "object" ? stored : {};
  const b = incoming && typeof incoming === "object" ? incoming : {};
  const out = {};
  const seen = {};
  const ids = Object.keys(a).concat(Object.keys(b));
  for (const id of ids) {
    if (seen[id]) continue;
    seen[id] = 1;
    out[id] = mergeBookFlags_(a[id], b[id]);
  }
  return out;
}

function parseDecodableProgress_(raw) {
  try {
    const data = JSON.parse(String(raw || ""));
    if (!data || typeof data !== "object" || !data.books || typeof data.books !== "object") {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Decodable programs merge book bags; all others store incoming JSON as-is.
 */
function mergeProgressJson(storedRaw, incomingRaw, program) {
  const incomingStr = String(incomingRaw == null ? "{}" : incomingRaw);
  const programKey = String(program || "").trim().toLowerCase();
  const incomingDecodable = parseDecodableProgress_(incomingStr);
  const useDecodableMerge =
    programKey === "decodable" || incomingDecodable != null;

  if (!useDecodableMerge) {
    return incomingStr;
  }
  if (!incomingDecodable) {
    return incomingStr;
  }
  const stored = parseDecodableProgress_(storedRaw);
  if (!stored) return incomingStr;
  const books = mergeBookBag_(stored.books, incomingDecodable.books);
  const rev = Math.max(toNum(stored.rev), toNum(incomingDecodable.rev));
  return JSON.stringify({ v: 2, rev, books });
}

function splitProgressChunks(json) {
  const text = String(json == null ? "" : json);
  if (!text) return [""];
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_CHAR_MAX) {
    chunks.push(text.slice(i, i + CHUNK_CHAR_MAX));
  }
  if (chunks.length > MAX_CHUNKS) {
    return { error: "too_large", maxChars: CHUNK_CHAR_MAX * MAX_CHUNKS };
  }
  return { chunks };
}

function joinProgressChunks(chunks) {
  if (!Array.isArray(chunks)) return "";
  return chunks.map((c) => String(c == null ? "" : c)).join("");
}

/**
 * @param {Array<{program, item, score, date, updated?}>} rows
 */
function filterProgressByProgram(rows, program) {
  if (!program) return rows.slice();
  const want = String(program).trim();
  if (!want) return rows.slice();
  return rows.filter((r) => String(r.program || "").trim() === want);
}

/**
 * @param {Array<object>} rows sorted newest-first optional
 */
function pageProgressRows(rows, offset, limit) {
  const off = Math.max(0, parseInt(offset, 10) || 0);
  const lim = Math.max(1, Math.min(1000, parseInt(limit, 10) || 500));
  const total = rows.length;
  const slice = rows.slice(off, off + lim);
  return {
    progress: slice,
    total,
    offset: off,
    limit: lim,
    hasMore: off + slice.length < total
  };
}

function parseTokens_(stored) {
  const raw = String(stored == null ? "" : stored).trim();
  if (!raw) return [];
  if (raw.charAt(0) === "[") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((t) => String(t)).filter(Boolean);
      }
    } catch {
      /* ignore */
    }
  }
  if (raw.indexOf("|") !== -1) {
    return raw.split("|").map((t) => String(t).trim()).filter(Boolean);
  }
  return [raw];
}

function pushToken_(stored, fresh, maxActive) {
  const cap = maxActive == null ? 5 : maxActive;
  let tokens = parseTokens_(stored).filter((t) => t !== fresh);
  tokens.unshift(fresh);
  if (tokens.length > cap) tokens = tokens.slice(0, cap);
  if (tokens.length === 1) return tokens[0];
  return tokens.join("|");
}

function tokenMatches_(stored, given) {
  if (!given) return false;
  const tokens = parseTokens_(stored);
  if (!tokens.length) return false;
  return tokens.indexOf(given) !== -1;
}

function idKey_(id) {
  return String(id == null ? "" : id)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function metricsRowKey(row, map) {
  const session = field_(row, map, "session_id");
  const email = field_(row, map, "student_email");
  const parts = String(session).split("-");
  for (const p of parts) {
    if (idKey_(p) === row._idKey) return true;
  }
  const at = String(email).indexOf("@");
  if (at > 0 && idKey_(email.slice(0, at)) === row._idKey) return true;
  return false;
}

function field_(row, map, name) {
  const index = map[name];
  if (index == null || index >= row.length) return "";
  const value = row[index];
  if (value == null) return "";
  return value;
}

/**
 * Build score-index upsert key from a metrics row (for backfill tests).
 */
function scoreFromMetricsRow(row, map, idKey) {
  const kind = String(field_(row, map, "event_kind")).trim().toLowerCase();
  if (kind === "effort_sample") return null;
  const scoreValue = field_(row, map, "score_value");
  const scorePct = field_(row, map, "score_pct");
  const hasScore =
    (scoreValue !== "" && scoreValue != null) ||
    (scorePct !== "" && scorePct != null);
  if (kind !== "learning_result" && !hasScore) return null;

  let program = String(field_(row, map, "curriculum_program")).trim();
  if (!program) program = String(field_(row, map, "source")).trim();
  const item = String(field_(row, map, "item_id")).trim();
  if (!program || !item) return null;

  return {
    id_key: idKey,
    program,
    item_id: item,
    score_value: scoreValue,
    score_max: field_(row, map, "score_max"),
    score_pct: scorePct,
    local_date: String(field_(row, map, "local_date")).trim(),
    updated_at: String(field_(row, map, "timestamp")).trim()
  };
}

module.exports = {
  CHUNK_CHAR_MAX,
  MAX_CHUNKS,
  mergeProgressJson,
  parseDecodableProgress_,
  splitProgressChunks,
  joinProgressChunks,
  filterProgressByProgram,
  pageProgressRows,
  parseTokens_,
  pushToken_,
  tokenMatches_,
  scoreFromMetricsRow,
  idKey_
};
