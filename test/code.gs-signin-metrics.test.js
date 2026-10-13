"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createGasContext } = require("./helpers/load-code-gs");

function metricsHeaderRow() {
  return [
    "event_kind",
    "session_id",
    "student_email",
    "student_id",
    "curriculum_program",
    "item_id",
    "score_value",
    "score_max",
    "score_pct",
    "local_date",
    "timestamp",
    "activity",
  ];
}

function seedStudent(ctx) {
  const accounts = ctx.ensureSheet("StudentAccounts");
  accounts.setCell(1, 1, "id_display");
  accounts.setCell(1, 2, "id_key");
  accounts.setCell(1, 3, "password");
  accounts.setCell(1, 6, "token");
  accounts.setCell(2, 1, "zz_test_it_wm");
  accounts.setCell(2, 2, "zz_test_it_wm");
  accounts.setCell(2, 3, "pw");
  accounts.setCell(2, 6, "tok-student");
}

describe("sign_in ClassroomMetrics rows", () => {
  it("login writes sign_in on event_kind and activity with empty score cells", () => {
    const ctx = createGasContext();
    seedStudent(ctx);
    const metrics = ctx.ensureSheet("ClassroomMetrics");
    metrics.getRange(1, 1, 1, 12).setValues([metricsHeaderRow()]);

    const login = ctx.login_({
      id: "zz_test_it_wm",
      password: "pw",
      client_app: "word-master",
      device: { type: "phone", os: "iOS", browser: "Safari", screenW: 390, screenH: 844 },
    });
    assert.equal(login.ok, true);
    assert.equal(metrics.getLastRow(), 2);
    const row = metrics.getRange(2, 1, 1, 12).getValues()[0];
    assert.equal(row[0], "sign_in");
    assert.equal(row[11], "sign_in");
    assert.equal(row[6], "");
    assert.equal(row[7], "");
    assert.equal(row[8], "");
    assert.match(String(row[5]), /^device:/);
  });

  it("readMetricsProgress_ and scoreFromMetricsRow_ skip sign_in rows", () => {
    const ctx = createGasContext();
    const map = {
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
      timestamp: 10,
      activity: 11,
    };
    const signInRow = [
      "sign_in",
      "signin-zz_test_it_wm-2026-10-13T00:00:00.000Z",
      "zz_test_it_wm",
      "",
      "word-master",
      "device:phone/iOS/Safari/390x844",
      "",
      "",
      "",
      "2026-10-13",
      "2026-10-13T00:00:00.000Z",
      "sign_in",
    ];
    assert.equal(ctx.scoreFromMetricsRow_(signInRow, map), null);

    const poisoned = signInRow.slice();
    poisoned[6] = 10;
    poisoned[8] = 100;
    assert.equal(ctx.scoreFromMetricsRow_(poisoned, map), null);

    const metrics = ctx.ensureSheet("ClassroomMetrics");
    metrics.getRange(1, 1, 1, 12).setValues([metricsHeaderRow()]);
    metrics.getRange(2, 1, 1, 12).setValues([signInRow]);
    metrics.getRange(3, 1, 1, 12).setValues([
      [
        "learning_result",
        "word-master-zz_test_it_wm-2026-10-12",
        "zz_test_it_wm",
        "",
        "word-master",
        "u01:item",
        8,
        10,
        80,
        "2026-10-12",
        "2026-10-12T12:00:00Z",
        "",
      ],
    ]);
    const ss = ctx.SpreadsheetApp.openById();
    const progress = ctx.readMetricsProgress_(ss, "zz_test_it_wm", "word-master");
    assert.equal(progress.length, 1);
    assert.equal(progress[0].item, "u01:item");
  });

  it("student_dashboard ignores sign_in metrics fallback", () => {
    const ctx = createGasContext();
    seedStudent(ctx);
    const metrics = ctx.ensureSheet("ClassroomMetrics");
    metrics.getRange(1, 1, 1, 12).setValues([metricsHeaderRow()]);
    metrics.getRange(2, 1, 1, 12).setValues([
      [
        "sign_in",
        "signin-zz_test_it_wm",
        "zz_test_it_wm",
        "",
        "word-master",
        "device:phone/x/y/1x1",
        "",
        "",
        "",
        "2026-10-13",
        "2026-10-13T00:00:00.000Z",
        "sign_in",
      ],
    ]);
    const res = ctx.studentDashboard_({
      id: "zz_test_it_wm",
      token: "tok-student",
      program: "word-master",
    });
    assert.equal(res.ok, true);
    assert.equal(res.dashboard.scoreTrend.length, 0);
    assert.equal(res.dashboard.recentActivity.length, 0);
  });
});
