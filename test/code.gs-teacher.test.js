"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createGasContext } = require("./helpers/load-code-gs");

describe("teacher classroom API", () => {
  it("teacher_list_students omits password and token", () => {
    const ctx = createGasContext();
    const accounts = ctx.ensureSheet("StudentAccounts");
    accounts.setCell(1, 1, "id_display");
    accounts.setCell(1, 2, "id_key");
    accounts.setCell(1, 3, "password");
    accounts.setCell(1, 6, "token");
    accounts.setCell(2, 1, "Jay");
    accounts.setCell(2, 2, "mrjkorea");
    accounts.setCell(2, 3, "secret");
    accounts.setCell(2, 6, "tok-jay");
    accounts.setCell(3, 1, "zz_test_mrjmetrics");
    accounts.setCell(3, 2, "zz_test_mrjmetrics");
    accounts.setCell(3, 3, "pw");
    accounts.setCell(3, 6, "tok-test");

    const denied = ctx.teacherListStudents_({
      id: "zz_test_mrjmetrics",
      token: "tok-test",
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "forbidden");

    const ok = ctx.teacherListStudents_({ id: "mrjkorea", token: "tok-jay" });
    assert.equal(ok.ok, true);
    assert.equal(ok.students.length, 2);
    const blob = JSON.stringify(ok.students);
    assert.equal(blob.indexOf("secret"), -1);
    assert.equal(blob.indexOf("tok-jay"), -1);
    assert.equal(blob.indexOf("password"), -1);
  });

  it("teacher_student_snapshot returns progress without token columns", () => {
    const ctx = createGasContext();
    const accounts = ctx.ensureSheet("StudentAccounts");
    accounts.setCell(2, 1, "Jay");
    accounts.setCell(2, 2, "mrjkorea");
    accounts.setCell(2, 3, "secret");
    accounts.setCell(2, 6, "tok-jay");

    const score = ctx.ensureSheet("StudentScoreIndex");
    score.setCell(1, 1, "id_key");
    score.setCell(1, 2, "program");
    score.setCell(1, 3, "item_id");
    score.setCell(2, 1, "zz_test_mrjmetrics");
    score.setCell(2, 2, "word-master");
    score.setCell(2, 3, "nouns100:speller");

    const pack = ctx.ensureSheet("AppProgress");
    pack.setCell(1, 1, "id_key");
    pack.setCell(1, 2, "program");
    pack.setCell(1, 3, "progress_json");
    pack.setCell(2, 1, "zz_test_mrjmetrics");
    pack.setCell(2, 2, "word-master");
    pack.setCell(
      2,
      3,
      JSON.stringify({
        v: 1,
        split: 1,
        shardPackIds: ["nouns100"],
        sets: {},
      })
    );
    pack.setCell(3, 1, "zz_test_mrjmetrics");
    pack.setCell(3, 2, "word-master@pack/nouns100");
    pack.setCell(
      3,
      3,
      JSON.stringify({
        v: 1,
        sets: {
          nouns100: { intro: { time: true }, winsA: { time: 2 }, lastPlayedAt: 1 },
        },
      })
    );

    const snap = ctx.teacherStudentSnapshot_({
      id: "mrjkorea",
      token: "tok-jay",
      student: "zz_test_mrjmetrics",
      program: "word-master",
    });
    assert.equal(snap.ok, true);
    assert.ok(Array.isArray(snap.progress));
    assert.ok(snap.progress_json.indexOf("time") !== -1);
    assert.equal(snap.progress_json.indexOf("secret"), -1);
  });
});
