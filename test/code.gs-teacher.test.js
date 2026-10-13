"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createGasContext } = require("./helpers/load-code-gs");

function setTeacherConfig(ctx, opts) {
  const props = ctx.PropertiesService.getScriptProperties();
  if (opts.ids != null) {
    props.setProperty("MRJ_TEACHER_IDS", opts.ids);
  } else {
    props.deleteProperty("MRJ_TEACHER_IDS");
  }
  if (opts.secret != null) {
    props.setProperty("MRJ_TEACHER_SECRET", opts.secret);
  } else {
    props.deleteProperty("MRJ_TEACHER_SECRET");
  }
}

function seedAccounts(ctx) {
  const accounts = ctx.ensureSheet("StudentAccounts");
  accounts.setCell(1, 1, "id_display");
  accounts.setCell(1, 2, "id_key");
  accounts.setCell(1, 3, "password");
  accounts.setCell(1, 6, "token");
  accounts.setCell(2, 1, "RealTeacher");
  accounts.setCell(2, 2, "real_teacher");
  accounts.setCell(2, 3, "secret");
  accounts.setCell(2, 6, "tok-teacher");
  accounts.setCell(3, 1, "zz_test_mrjmetrics");
  accounts.setCell(3, 2, "zz_test_mrjmetrics");
  accounts.setCell(3, 3, "pw");
  accounts.setCell(3, 6, "tok-test");
}

describe("teacher classroom API", () => {
  it("teacher_list_students omits password and token", () => {
    const ctx = createGasContext();
    seedAccounts(ctx);
    setTeacherConfig(ctx, { ids: "real_teacher" });

    const denied = ctx.teacherListStudents_({
      id: "zz_test_mrjmetrics",
      token: "tok-test",
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "forbidden");

    const ok = ctx.teacherListStudents_({ id: "real_teacher", token: "tok-teacher" });
    assert.equal(ok.ok, true);
    assert.equal(ok.students.length, 2);
    const blob = JSON.stringify(ok.students);
    assert.equal(blob.indexOf("secret"), -1);
    assert.equal(blob.indexOf("tok-teacher"), -1);
    assert.equal(blob.indexOf("password"), -1);
  });

  it("refuses teacher APIs when MRJ_TEACHER_IDS and secret are unset", () => {
    const ctx = createGasContext();
    seedAccounts(ctx);
    setTeacherConfig(ctx, {});

    const res = ctx.teacherListStudents_({ id: "real_teacher", token: "tok-teacher" });
    assert.equal(res.ok, false);
    assert.equal(res.error, "forbidden");
    assert.match(res.message, /not configured/i);
  });

  it("student who registered a famous teacher id cannot access without allowlist", () => {
    const ctx = createGasContext();
    setTeacherConfig(ctx, { ids: "real_teacher" });

    const reg = ctx.register_({ id: "mrjkorea", password: "student-pw" });
    assert.equal(reg.ok, true);

    const impostor = ctx.teacherListStudents_({
      id: "mrjkorea",
      token: reg.token,
    });
    assert.equal(impostor.ok, false);
    assert.equal(impostor.error, "forbidden");
  });

  it("teacher_student_snapshot merges only packShardIds listed on the shell", () => {
    const ctx = createGasContext();
    seedAccounts(ctx);
    setTeacherConfig(ctx, { ids: "real_teacher" });

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
        packShardIds: ["nouns100"],
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
    pack.setCell(4, 1, "zz_test_mrjmetrics");
    pack.setCell(4, 2, "word-master@pack/nouns200");
    pack.setCell(
      4,
      3,
      JSON.stringify({
        v: 1,
        sets: {
          nouns200: { intro: { stale_word: true }, winsA: { stale_word: 9 }, lastPlayedAt: 1 },
        },
      })
    );

    const snap = ctx.teacherStudentSnapshot_({
      id: "real_teacher",
      token: "tok-teacher",
      student: "zz_test_mrjmetrics",
      program: "word-master",
    });
    assert.equal(snap.ok, true);
    assert.ok(snap.progress_json.indexOf("time") !== -1);
    assert.equal(snap.progress_json.indexOf("stale_word"), -1);
    const parsed = JSON.parse(snap.progress_json);
    assert.ok(parsed.sets.nouns100);
    assert.equal(parsed.sets.nouns200, undefined);
  });

  it("listed packShardId with no shard row still returns shell-only merge", () => {
    const ctx = createGasContext();
    seedAccounts(ctx);
    setTeacherConfig(ctx, { ids: "real_teacher" });

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
        packShardIds: ["nouns100", "verbs100"],
        sets: { nouns100: { intro: { shell_only: true } } },
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
          nouns100: { intro: { shard_time: true }, winsA: { shard_time: 2 }, lastPlayedAt: 1 },
        },
      })
    );

    const snap = ctx.teacherStudentSnapshot_({
      id: "real_teacher",
      token: "tok-teacher",
      student: "zz_test_mrjmetrics",
      program: "word-master",
    });
    assert.equal(snap.ok, true);
    const parsed = JSON.parse(snap.progress_json);
    assert.ok(parsed.sets.nouns100);
    assert.ok(parsed.sets.nouns100.intro.shard_time);
    assert.equal(parsed.sets.verbs100, undefined);
  });

  it("teacher_secret allows access when MRJ_TEACHER_IDS is unset", () => {
    const ctx = createGasContext();
    seedAccounts(ctx);
    setTeacherConfig(ctx, { secret: "classroom-secret" });

    const denied = ctx.teacherListStudents_({
      id: "zz_test_mrjmetrics",
      token: "tok-test",
    });
    assert.equal(denied.ok, false);

    const ok = ctx.teacherListStudents_({
      id: "zz_test_mrjmetrics",
      token: "tok-test",
      teacher_secret: "classroom-secret",
    });
    assert.equal(ok.ok, true);
  });
});
