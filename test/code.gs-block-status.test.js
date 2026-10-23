"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createGasContext } = require("./helpers/load-code-gs");

function setTeacherConfig(ctx, opts) {
  if (opts.secret) ctx.PropertiesService.getScriptProperties().setProperty("MRJ_TEACHER_SECRET", opts.secret);
  if (opts.ids) ctx.PropertiesService.getScriptProperties().setProperty("MRJ_TEACHER_IDS", opts.ids);
}

function seedStudent(ctx, display, password, status) {
  const accounts = ctx.ensureSheet("StudentAccounts");
  accounts.getRange(1, 1, 1, 7).setValues([
    ["id_display", "id_key", "password", "created_at", "last_login", "token", "status"]
  ]);
  const row = 2;
  accounts.setCell(row, 1, display);
  accounts.setCell(row, 2, ctx.idKey_(display));
  accounts.setCell(row, 3, password);
  accounts.setCell(row, 4, "");
  accounts.setCell(row, 5, "");
  accounts.setCell(row, 6, "tok-active-student-0000000000000001");
  accounts.setCell(row, 7, status == null ? "" : status);
  return "tok-active-student-0000000000000001";
}

describe("account block status (server)", () => {
  it("ensureAccounts_ adds status header idempotently", () => {
    const ctx = createGasContext();
    const accounts = ctx.ensureSheet("StudentAccounts");
    accounts.getRange(1, 1, 1, 6).setValues([
      ["id_display", "id_key", "password", "created_at", "last_login", "token"]
    ]);
    ctx.ensureAccounts_(ctx.SpreadsheetApp.openById("x"));
    assert.equal(accounts.cell(1, 7), "status");
    ctx.ensureAccounts_(ctx.SpreadsheetApp.openById("x"));
    assert.equal(accounts.cell(1, 7), "status");
  });

  it("login allows blank and approved status", () => {
    const ctx = createGasContext();
    for (const status of ["", "approved"]) {
      const token = seedStudent(ctx, "kid" + status, "pw", status);
      const res = ctx.login_({ id: "kid" + status, password: "pw" });
      assert.equal(res.ok, true);
      assert.ok(res.token);
      const pack = ctx.loadPack_({ id: "kid" + status, token: res.token, program: "decodable" });
      assert.equal(pack.ok, true);
    }
  });

  it("login, save_pack and load_pack refuse blocked ids", () => {
    const ctx = createGasContext();
    seedStudent(ctx, "blockedKid", "pw", "blocked");
    const login = ctx.login_({ id: "blockedKid", password: "pw" });
    assert.equal(login.ok, false);
    assert.equal(login.error, "id_blocked");
    assert.equal(login.message, ctx.MSG_ID_BLOCKED);

    const token = "tok-active-student-0000000000000001";
    const load = ctx.loadPack_({ id: "blockedKid", token, program: "decodable" });
    assert.equal(load.ok, false);
    assert.equal(load.error, "id_blocked");

    const save = ctx.savePack_({
      id: "blockedKid",
      token,
      program: "decodable",
      progress_json: "{}"
    });
    assert.equal(save.ok, false);
    assert.equal(save.error, "id_blocked");
  });

  it("register stores created_at in KST and blank status", () => {
    const ctx = createGasContext();
    ctx.ensureAccounts_(ctx.SpreadsheetApp.openById("x"));
    const res = ctx.register_({ id: "NewKid", password: "secret" });
    assert.equal(res.ok, true);
    const accounts = ctx.ensureSheet("StudentAccounts");
    const created = accounts.cell(2, 4);
    assert.match(created, /\+09:00$/);
    assert.equal(accounts.cell(2, 7), "");
  });

  it("set_status is teacher-only and toggles status", () => {
    const ctx = createGasContext();
    seedStudent(ctx, "toggleMe", "pw", "");
    setTeacherConfig(ctx, { secret: "class-secret" });

    const denied = ctx.setStatus_({ id: "toggleMe", status: "blocked" });
    assert.equal(denied.ok, false);

    const blocked = ctx.setStatus_({
      id: "toggleMe",
      status: "blocked",
      teacher_secret: "class-secret"
    });
    assert.equal(blocked.ok, true);
    const accounts = ctx.ensureSheet("StudentAccounts");
    assert.equal(accounts.cell(2, 7), "blocked");

    const loginBlocked = ctx.login_({ id: "toggleMe", password: "pw" });
    assert.equal(loginBlocked.error, "id_blocked");

    const approved = ctx.setStatus_({
      id: "toggleMe",
      status: "approved",
      teacher_secret: "class-secret"
    });
    assert.equal(approved.ok, true);
    assert.equal(accounts.cell(2, 7), "");

    const loginOk = ctx.login_({ id: "toggleMe", password: "pw" });
    assert.equal(loginOk.ok, true);
  });

  it("teacher mode for andrew still works when status is blank", () => {
    const ctx = createGasContext();
    seedStudent(ctx, "Andrew", "pw", "");
    const res = ctx.login_({ id: "Andrew", password: "pw" });
    assert.equal(res.ok, true);
    assert.equal(res.role, "teacher");
  });
});
