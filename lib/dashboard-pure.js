/**
 * Progress dashboard aggregation (mirrored in Code.gs for Apps Script).
 */
"use strict";

const WM_PACK_SHARD_PREFIX = "word-master@pack/";

function parseJsonSafe(raw) {
  try {
    const v = JSON.parse(String(raw || "{}"));
    return v && typeof v === "object" ? v : {};
  } catch (ignore) {
    return {};
  }
}

function countLeafProgress_(node) {
  let done = 0;
  let total = 0;
  if (node == null) return { done, total };
  if (typeof node === "boolean") {
    total = 1;
    if (node) done = 1;
    return { done, total };
  }
  if (typeof node === "number") {
    total = 1;
    if (node > 0) done = 1;
    return { done, total };
  }
  if (typeof node !== "object") return { done, total };
  const keys = Object.keys(node);
  if (!keys.length) return { done, total };
  for (const k of keys) {
    if (k === "lastPlayedAt" || k === "v") continue;
    const sub = countLeafProgress_(node[k]);
    done += sub.done;
    total += sub.total;
  }
  return { done, total };
}

function summarizePackSets_(parsed) {
  const sets = parsed && parsed.sets && typeof parsed.sets === "object" ? parsed.sets : {};
  const units = [];
  const keys = Object.keys(sets).sort();
  for (const id of keys) {
    const counts = countLeafProgress_(sets[id]);
    const pct =
      counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : counts.done > 0 ? 100 : 0;
    units.push({
      id,
      label: id,
      done: counts.done,
      total: counts.total,
      pct,
    });
  }
  let doneAll = 0;
  let totalAll = 0;
  for (const u of units) {
    doneAll += u.done;
    totalAll += u.total;
  }
  const overallPct =
    totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : units.length ? 0 : null;
  const remaining = units.filter((u) => u.total > 0 && u.pct < 100).map((u) => u.id);
  return { units, overallPct, remaining };
}

function parseScorePct_(row) {
  if (!row) return null;
  if (row.score_pct != null && row.score_pct !== "") {
    const n = +row.score_pct;
    if (isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
  }
  const text = String(row.score || row.scoreText || "");
  const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) return Math.round(+m[1]);
  const frac = text.match(/^(\d+)\s*\/\s*(\d+)/);
  if (frac) {
    const max = +frac[2];
    if (max > 0) return Math.round((+frac[1] / max) * 100);
  }
  return null;
}

function normalizeProgressRow_(row) {
  const item = String(row.item || row.item_id || "").trim();
  const program = String(row.program || "").trim();
  const date = String(row.date || row.local_date || "").trim();
  const pct = parseScorePct_(row);
  return { program, item_id: item, local_date: date, score_pct: pct };
}

function scoreTrendFromRows(rows, limit) {
  const lim = limit == null ? 40 : Math.max(1, +limit || 40);
  const norm = (rows || []).map(normalizeProgressRow_).filter((r) => r.item_id);
  norm.sort((a, b) => String(a.local_date).localeCompare(String(b.local_date)));
  const points = [];
  for (const r of norm) {
    if (r.score_pct == null) continue;
    points.push({ date: r.local_date || "?", pct: r.score_pct, item_id: r.item_id });
  }
  if (points.length > lim) return points.slice(points.length - lim);
  return points;
}

function weakItemsFromRows(rows, threshold) {
  const t = threshold == null ? 70 : +threshold;
  const byItem = {};
  for (const r of (rows || []).map(normalizeProgressRow_)) {
    if (!r.item_id || r.score_pct == null) continue;
    const prev = byItem[r.item_id];
    if (!prev || String(r.local_date).localeCompare(String(prev.local_date)) >= 0) {
      byItem[r.item_id] = r;
    }
  }
  return Object.keys(byItem)
    .map((k) => byItem[k])
    .filter((r) => r.score_pct < t)
    .sort((a, b) => a.score_pct - b.score_pct)
    .slice(0, 12);
}

function recentActivityFromRows(rows, limit) {
  const lim = limit == null ? 8 : Math.max(1, +limit || 8);
  const norm = (rows || []).map(normalizeProgressRow_).filter((r) => r.item_id);
  norm.sort((a, b) => String(b.local_date).localeCompare(String(a.local_date)));
  return norm.slice(0, lim).map((r) => ({
    item_id: r.item_id,
    program: r.program,
    local_date: r.local_date,
    score_pct: r.score_pct,
  }));
}

function isPackShellProgram_(program) {
  const p = String(program || "");
  if (!p || p.indexOf("@") !== -1) return false;
  return true;
}

function listPackProgramsForStudent_(packRows, idKey) {
  const out = [];
  const seen = {};
  for (const row of packRows || []) {
    if (String(row.id_key) !== idKey) continue;
    const program = String(row.program || "").trim();
    if (!program || !isPackShellProgram_(program)) continue;
    if (seen[program]) continue;
    seen[program] = 1;
    out.push(program);
  }
  out.sort();
  return out;
}

function mergePackJsonWithListedShards(mainJson, shards) {
  const base = parseJsonSafe(mainJson);
  if (!base.sets) base.sets = {};
  for (const shard of shards || []) {
    if (!shard || !shard.progress_json) continue;
    let pid = String(shard.packId || "").trim();
    if (!pid && shard.program) {
      pid = String(shard.program).slice(WM_PACK_SHARD_PREFIX.length);
    }
    const obj = parseJsonSafe(shard.progress_json);
    if (!obj.sets) continue;
    if (pid && obj.sets[pid]) {
      base.sets[pid] = obj.sets[pid];
    }
  }
  return JSON.stringify(base);
}

function packShardIdsFromShell(mainJson) {
  const obj = parseJsonSafe(mainJson);
  if (!Array.isArray(obj.packShardIds)) return [];
  return obj.packShardIds.map((id) => String(id).trim()).filter(Boolean);
}

function summarizeStudentDashboard(packJson, progressRows, opts) {
  const parsed = parseJsonSafe(packJson);
  const pack = summarizePackSets_(parsed);
  const trend = scoreTrendFromRows(progressRows, opts && opts.trendLimit);
  const weak = weakItemsFromRows(progressRows, opts && opts.weakThreshold);
  const recent = recentActivityFromRows(progressRows, opts && opts.recentLimit);
  return {
    completion: pack,
    scoreTrend: trend,
    weakItems: weak,
    recentActivity: recent,
  };
}

function formatDeviceItemId_(device) {
  if (!device || typeof device !== "object") return "";
  const type = String(device.type || device.deviceType || "unknown").slice(0, 24);
  const os = String(device.os || "unknown").slice(0, 32);
  const browser = String(device.browser || "unknown").slice(0, 32);
  const w = device.screenW != null ? +device.screenW : device.width;
  const h = device.screenH != null ? +device.screenH : device.height;
  const screen =
    isFinite(w) && isFinite(h) && w > 0 && h > 0 ? w + "x" + h : String(device.screen || "").slice(0, 16);
  return "device:" + type + "/" + os + "/" + browser + "/" + screen;
}

function parseDeviceFromBody_(body) {
  const d = body && body.device;
  if (!d || typeof d !== "object") return null;
  return {
    type: String(d.type || d.deviceType || "").trim() || "unknown",
    os: String(d.os || "").trim() || "unknown",
    browser: String(d.browser || "").trim() || "unknown",
    screenW: d.screenW != null ? d.screenW : d.width,
    screenH: d.screenH != null ? d.screenH : d.height,
  };
}

function programDisplayName_(program) {
  const map = {
    "word-master": "Word Master",
    greenzap: "Green Zap",
    "skill-builder": "Skill Builder",
    "skill-builder-g1": "Skill Builder G1",
    pronounce: "Pronounce",
    "pronounce-whistle": "Pronounce Whistle",
    "day2-words": "Day 2 Words",
    "day3-workbook": "Day 3 Workbook",
  };
  return map[program] || program;
}

function compactAppSummary_(program, packJson, progressRows) {
  const dash = summarizeStudentDashboard(packJson, progressRows, {
    trendLimit: 1,
    recentLimit: 1,
  });
  let lastActive = "";
  if (dash.recentActivity.length) lastActive = dash.recentActivity[0].local_date || "";
  const scores = (progressRows || []).map(normalizeProgressRow_).filter((r) => r.score_pct != null);
  let avgPct = null;
  if (scores.length) {
    const sum = scores.reduce((a, r) => a + r.score_pct, 0);
    avgPct = Math.round(sum / scores.length);
  }
  return {
    program,
    label: programDisplayName_(program),
    completionPct: dash.completion.overallPct,
    unitCount: dash.completion.units.length,
    scoreCount: scores.length,
    avgScorePct: avgPct,
    lastActive,
    weakCount: dash.weakItems.length,
  };
}

module.exports = {
  WM_PACK_SHARD_PREFIX,
  parseJsonSafe,
  summarizePackSets_,
  summarizeStudentDashboard,
  scoreTrendFromRows,
  weakItemsFromRows,
  recentActivityFromRows,
  listPackProgramsForStudent_,
  mergePackJsonWithListedShards,
  packShardIdsFromShell,
  formatDeviceItemId_,
  parseDeviceFromBody_,
  programDisplayName_,
  compactAppSummary_,
  normalizeProgressRow_,
};
