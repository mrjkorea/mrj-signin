"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createGasContext } = require("./helpers/load-code-gs");

function setTeacherConfig(ctx, opts) {
  const props = ctx.PropertiesService.getScriptProperties();
  if (opts.ids != null) props.setProperty("MRJ_TEACHER_IDS", opts.ids);
  else props.deleteProperty("MRJ_TEACHER_IDS");
  if (opts.secret != null) props.setProperty("MRJ_TEACHER_SECRET", opts.secret);
  else props.deleteProperty("MRJ_TEACHER_SECRET");
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

  const score = ctx.ensureSheet("StudentScoreIndex");
  score.setCell(1, 1, "id_key");
  score.setCell(1, 2, "program");
  score.setCell(1, 3, "item_id");
  score.setCell(1, 6, "score_pct");
  score.setCell(1, 7, "local_date");
  score.setCell(2, 1, "zz_test_it_wm");
  score.setCell(2, 2, "word-master");
  score.setCell(2, 3, "nouns100:speller");
  score.setCell(2, 6, "80");
  score.setCell(2, 7, "2026-10-10");

  const pack = ctx.ensureSheet("AppProgress");
  pack.setCell(1, 1, "id_key");
  pack.setCell(1, 2, "program");
  pack.setCell(1, 3, "progress_json");
  pack.setCell(2, 1, "zz_test_it_wm");
  pack.setCell(2, 2, "word-master");
  pack.setCell(
    2,
    3,
    JSON.stringify({
      v: 1,
      sets: { nouns100: { intro: { done: true }, play: { done: false } } },
    })
  );
}

describe("dashboard APIs", () => {
  it("student_dashboard returns chart payload without secrets", () => {
    const ctx = createGasContext();
    seedStudent(ctx);
    const res = ctx.studentDashboard_({
      id: "zz_test_it_wm",
      token: "tok-student",
      program: "word-master",
    });
    assert.equal(res.ok, true);
    assert.ok(res.dashboard.completion.units.length >= 1);
    assert.ok(res.dashboard.scoreTrend.length >= 1);
    const blob = JSON.stringify(res);
    assert.equal(blob.indexOf("password"), -1);
    assert.equal(blob.indexOf("tok-student"), -1);
  });

  it("login appends sign_in metrics row with device in item_id", () => {
    const ctx = createGasContext();
    seedStudent(ctx);
    const metrics = ctx.ensureSheet("ClassroomMetrics");
    metrics.getRange(1, 1, 1, 12).setValues([
      [
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
      ],
    ]);
    const login = ctx.login_({
      id: "zz_test_it_wm",
      password: "pw",
      client_app: "word-master",
      device: { type: "phone", os: "Android", browser: "Chrome", screenW: 412, screenH: 915 },
    });
    assert.equal(login.ok, true);
    assert.equal(metrics.getLastRow(), 2);
    const row = metrics.getRange(2, 1, 1, 12).getValues()[0];
    assert.equal(row[0], "sign_in");
    assert.equal(row[11], "sign_in");
    assert.equal(row[2], "zz_test_it_wm");
    assert.equal(row[6], "");
    assert.equal(row[7], "");
    assert.equal(row[8], "");
    assert.match(String(row[5]), /^device:phone\/Android\/Chrome\/412x915$/);
  });

  it("teacher_student_dashboard lists apps for student", () => {
    const ctx = createGasContext();
    seedStudent(ctx);
    setTeacherConfig(ctx, { secret: "sec" });
    const res = ctx.teacherStudentDashboard_({
      id: "zz_test_it_wm",
      token: "tok-student",
      teacher_secret: "sec",
      student: "zz_test_it_wm",
    });
    assert.equal(res.ok, true);
    assert.ok(res.apps.length >= 1);
    assert.ok(res.dashboards["word-master"]);
  });
});
