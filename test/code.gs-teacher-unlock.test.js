"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createGasContext } = require("./helpers/load-code-gs");

function setTeacherConfig(ctx, opts) {
  const props = ctx.PropertiesService.getScriptProperties();
  if (opts.secret != null) props.setProperty("MRJ_TEACHER_SECRET", opts.secret);
  else props.deleteProperty("MRJ_TEACHER_SECRET");
  if (opts.ids != null) props.setProperty("MRJ_TEACHER_IDS", opts.ids);
  else props.deleteProperty("MRJ_TEACHER_IDS");
}

function seedKid(ctx) {
  const accounts = ctx.ensureSheet("StudentAccounts");
  accounts.setCell(1, 1, "id_display");
  accounts.setCell(1, 2, "id_key");
  accounts.setCell(1, 3, "password");
  accounts.setCell(1, 6, "token");
  accounts.setCell(2, 1, "Kid");
  accounts.setCell(2, 2, "kid");
  accounts.setCell(2, 3, "pw");
  accounts.setCell(2, 6, "tok-kid");
}

describe("teacher_unlock action", () => {
  it("elevates a signed-in student session when teacher_secret matches", () => {
    const ctx = createGasContext();
    setTeacherConfig(ctx, { secret: "class-pin" });
    seedKid(ctx);

    const bad = ctx.teacherUnlock_({
      id: "kid",
      token: "tok-kid",
      teacher_secret: "nope"
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "forbidden");

    const ok = ctx.teacherUnlock_({
      id: "kid",
      token: "tok-kid",
      teacher_secret: "class-pin"
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.role, "teacher");
    assert.equal(ok.id, "Kid");
    assert.equal(ok.token, "tok-kid");
  });

  it("requires a valid student token", () => {
    const ctx = createGasContext();
    setTeacherConfig(ctx, { secret: "class-pin" });
    seedKid(ctx);
    const res = ctx.teacherUnlock_({
      id: "kid",
      token: "wrong",
      teacher_secret: "class-pin"
    });
    assert.equal(res.ok, false);
  });
});
