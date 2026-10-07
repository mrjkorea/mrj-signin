"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createGasContext } = require("./helpers/load-code-gs");

function metricsMap() {
  return {
    event_kind: 0,
    session_id: 1,
    student_email: 2,
    student_id: 3,
    curriculum_program: 4,
    item_id: 5,
    score_value: 6,
    score_max: 7,
    score_pct: 8,
    local_date: 9,
    timestamp: 10
  };
}

describe("Code.gs (vm)", () => {
  it("scoreFromMetricsRow_ uses student name from session, not app prefix", () => {
    const ctx = createGasContext();
    const map = metricsMap();
    const row = [
      "learning_result",
      "news-words-Gyubhin-2026-09-28",
      "unknown",
      "",
      "news-words",
      "w1",
      8,
      10,
      "",
      "2026-09-28",
      "2026-09-28T12:00:00Z"
    ];
    const rec = ctx.scoreFromMetricsRow_(row, map);
    assert.ok(rec);
    assert.equal(rec.id_key, "gyubhin");
    assert.equal(rec.program, "news-words");
  });

  it("mergeProgressJson_ keeps stored decodable blob when incoming is {}", () => {
    const ctx = createGasContext();
    const stored = JSON.stringify({ v: 2, rev: 1, books: { a: { passed: true } } });
    const out = ctx.mergeProgressJson_(stored, "{}", "decodable");
    assert.equal(out, stored);
  });

  it("save_pack stores and loads chunked progress without changing AppProgress columns", () => {
    const ctx = createGasContext();
    const ss = ctx.SpreadsheetApp.openById("x");
    const accounts = ctx.ensureSheet("StudentAccounts");
    accounts.appendRow(["kid", "kid", "pw", "", "", "tok12345678901234567890123456789012"]);
    const big = "z".repeat(45000);
    const body = {
      id: "kid",
      token: "tok12345678901234567890123456789012",
      program: "word-master",
      progress_json: big
    };
    const saved = ctx.savePack_(body);
    assert.equal(saved.ok, true);
    const pack = ctx.ensureSheet("AppProgress");
    const header = pack.getRange(1, 1, 1, 4).getValues()[0];
    assert.deepEqual(header, ["id_key", "program", "progress_json", "updated_at"]);
    const loaded = ctx.readPackJson_(ss, "kid", "word-master");
    assert.equal(loaded.length, big.length);
    assert.equal(loaded, big);
  });

  it("backfill keeps newer index row over older metrics row", () => {
    const ctx = createGasContext();
    const score = ctx.ensureSheet("StudentScoreIndex");
    score.getRange(1, 1, 1, 8).setValues([[
      "id_key", "program", "item_id", "score_value", "score_max", "score_pct", "local_date", "updated_at"
    ]]);
    score.appendRow(["gyubhin", "news-words", "w1", "9", "10", "", "2026-10-07", "2026-10-07T20:00:00Z"]);
    const metrics = ctx.ensureSheet("ClassroomMetrics");
    metrics.getRange(1, 1, 1, 11).setValues([[
      "event_kind", "session_id", "student_email", "student_id", "curriculum_program",
      "item_id", "score_value", "score_max", "score_pct", "local_date", "timestamp"
    ]]);
    metrics.appendRow([
      "learning_result",
      "news-words-Gyubhin-2026-09-28",
      "unknown",
      "",
      "news-words",
      "w1",
      1,
      10,
      "",
      "2026-09-28",
      "2026-09-01T12:00:00Z"
    ]);
    ctx.backfillStudentScoreIndex();
    const values = score.getDataRange().getValues();
    assert.equal(values[1][3], "9");
  });
});
