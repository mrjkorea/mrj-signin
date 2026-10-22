"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createGasContext } = require("./helpers/load-code-gs");

function seedAndrew(ctx) {
  const accounts = ctx.ensureSheet("StudentAccounts");
  accounts.setCell(1, 1, "id_display");
  accounts.setCell(1, 2, "id_key");
  accounts.setCell(1, 3, "password");
  accounts.setCell(1, 6, "token");
  accounts.setCell(2, 1, "Andrew");
  accounts.setCell(2, 2, "andrew");
  accounts.setCell(2, 3, "pw");
  accounts.setCell(2, 6, "tok-andrew");
  accounts.setCell(3, 1, "kid");
  accounts.setCell(3, 2, "kid");
  accounts.setCell(3, 3, "pw");
  accounts.setCell(3, 6, "tok-kid");
}

describe("sign-in teacher mode (server)", () => {
  it("login returns role teacher only for Andrew", () => {
    const ctx = createGasContext();
    seedAndrew(ctx);
    const andrew = ctx.login_({ id: "Andrew", password: "pw" });
    assert.equal(andrew.ok, true);
    assert.equal(andrew.role, "teacher");
    const kid = ctx.login_({ id: "kid", password: "pw" });
    assert.equal(kid.ok, true);
    assert.equal(kid.role, undefined);
  });

  it("progress re-validates teacher role from server", () => {
    const ctx = createGasContext();
    seedAndrew(ctx);
    const res = ctx.progress_({ id: "Andrew", token: "tok-andrew", program: "word-master" });
    assert.equal(res.ok, true);
    assert.equal(res.role, "teacher");
    const kid = ctx.progress_({ id: "kid", token: "tok-kid", program: "word-master" });
    assert.equal(kid.ok, true);
    assert.equal(kid.role, undefined);
  });

  it("save_pack tags metadata_json for teacher without new columns", () => {
    const ctx = createGasContext();
    seedAndrew(ctx);
    const saved = ctx.savePack_({
      id: "Andrew",
      token: "tok-andrew",
      program: "word-master",
      progress_json: '{"v":1,"sets":{}}',
    });
    assert.equal(saved.ok, true);
    const loaded = ctx.loadPack_({ id: "Andrew", token: "tok-andrew", program: "word-master" });
    const parsed = JSON.parse(loaded.progress_json);
    assert.deepEqual(parsed.metadata_json, { role: "teacher" });
  });

  it("aggregators skip teacher-tagged score index rows when metadata_json column exists", () => {
    const ctx = createGasContext();
    seedAndrew(ctx);
    const score = ctx.ensureSheet("StudentScoreIndex");
    score.setCell(1, 1, "id_key");
    score.setCell(1, 2, "program");
    score.setCell(1, 3, "item_id");
    score.setCell(1, 4, "score_value");
    score.setCell(1, 5, "score_max");
    score.setCell(1, 6, "score_pct");
    score.setCell(1, 7, "local_date");
    score.setCell(1, 8, "updated_at");
    score.setCell(1, 9, "metadata_json");
    score.setCell(2, 1, "kid");
    score.setCell(2, 2, "word-master");
    score.setCell(2, 3, "real:item");
    score.setCell(2, 4, "8");
    score.setCell(2, 6, "80");
    score.setCell(2, 7, "2026-10-01");
    score.setCell(2, 8, "2026-10-01T00:00:00Z");
    score.setCell(3, 1, "kid");
    score.setCell(3, 2, "word-master");
    score.setCell(3, 3, "teacher:item");
    score.setCell(3, 4, "10");
    score.setCell(3, 6, "100");
    score.setCell(3, 7, "2026-10-02");
    score.setCell(3, 8, "2026-10-02T00:00:00Z");
    score.setCell(3, 9, '{"role":"teacher"}');
    const ss = ctx.SpreadsheetApp.openById();
    const rows = ctx.readScoreIndex_(ss, "kid");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].item, "real:item");
  });
});
