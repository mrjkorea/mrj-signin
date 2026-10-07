"use strict";

const path = require("path");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { makeBook, loadCode } = require("./helpers/realsheets");

const CODE_141 = path.join(__dirname, "..", "Code.gs");
const CODE_140 = path.join(__dirname, "fixtures", "Code-1.4.0.gs");
const TOKEN = "tok12345678901234567890123456789012";

function seedAccount(book) {
  const acc = book.ss.insertSheet("StudentAccounts");
  acc.getRange(1, 1, 1, 6).setValues([["id_display", "id_key", "password", "created_at", "last_login", "token"]]);
  acc.getRange(1, 1, 1, 6).setNumberFormat("@");
  acc.setFrozenRows(1);
  acc.getRange(2, 1, 1, 6).setValues([["kid", "kid", "pw", "", "", TOKEN]]);
}

function savePack(ctx, program, progress_json) {
  return ctx.post({ action: "save_pack", id: "kid", token: TOKEN, program, progress_json });
}

function loadPack(ctx, program) {
  return ctx.post({ action: "load_pack", id: "kid", token: TOKEN, program });
}

function resetWriteStats(book) {
  book.stats.setValues = 0;
  book.stats.deleteRows = 0;
  book.stats.deleteRow = 0;
}

describe("Code.gs realsheets", () => {
  it("splitProgressChunks_ never ends a piece on a high surrogate", () => {
    const book = makeBook();
    const ctx = loadCode(CODE_141, book);
    const chunk = ctx.CHUNK_CHAR_MAX;
    const emoji = "\u{1F389}";
    const payload = "a".repeat(chunk - 1) + emoji + "tail";
    const split = ctx.splitProgressChunks_(payload);
    assert.ok(split.chunks.length >= 2);
    assert.equal(ctx.joinProgressChunks_(split.chunks), payload);
    seedAccount(book);
    savePack(ctx, "emoji-boundary", payload);
    assert.equal(loadPack(ctx, "emoji-boundary").progress_json, payload);
  });

  it("round-trips emoji-heavy payload near 1.99M chars", () => {
    const book = makeBook();
    const ctx = loadCode(CODE_141, book);
    const target = 1990000;
    const unit = "\u{1F389}";
    let payload = "";
    while (payload.length < target) payload += unit;
    payload = payload.slice(0, target);
    assert.equal(payload.length, target);
    seedAccount(book);
    const saved = savePack(ctx, "emoji-heavy", payload);
    assert.equal(saved.ok, true);
    assert.equal(loadPack(ctx, "emoji-heavy").progress_json, payload);
  });

  it("packChunkCell_ round-trips = + - @ ' at chunk boundaries (fails without pack escape)", () => {
    const book = makeBook();
    const ctx = loadCode(CODE_141, book);
    const chunk = ctx.CHUNK_CHAR_MAX;
    seedAccount(book);
    for (const ch of ["=", "+", "-", "@", "'"]) {
      const payload = "q".repeat(chunk) + `${ch}marker`;
      savePack(ctx, `spec-${ch}`, payload);
      const loaded = loadPack(ctx, `spec-${ch}`).progress_json;
      assert.equal(loaded, payload, `special ${ch}`);
      assert.notEqual(loaded, ctx.ERR);
    }
  });

  it("too_large leaves existing pack data untouched", () => {
    const book = makeBook();
    const ctx = loadCode(CODE_141, book);
    seedAccount(book);
    const small = JSON.stringify({ sets: { a: 1 } });
    savePack(ctx, "word-master", small);
    const more = book.sheets.AppProgressMore;
    const main = book.sheets.AppProgress;
    const snapMore = more ? more.snapshot() : "null";
    const snapMain = main ? main.snapshot() : "null";
    const bad = "z".repeat(ctx.MAX_PROGRESS_TOTAL_CHARS + 1);
    const res = savePack(ctx, "word-master", bad);
    assert.equal(res.ok, false);
    assert.equal(res.error, "too_large");
    if (more) assert.equal(more.snapshot(), snapMore);
    if (main) assert.equal(main.snapshot(), snapMain);
    assert.equal(loadPack(ctx, "word-master").progress_json, small);
  });

  it("save_pack does not re-acquire script lock when creating AppProgressMore", () => {
    const book = makeBook();
    const ctx = loadCode(CODE_141, book, { strictReentry: true });
    seedAccount(book);
    const res = savePack(ctx, "word-master", "x".repeat(45000));
    assert.equal(res.ok, true);
    assert.equal(book.lockState.held, false);
  });

  it("shrinks 50 chunks to 2 with other students rows interleaved", () => {
    const book = makeBook();
    const ctx = loadCode(CODE_141, book);
    seedAccount(book);
    const big = "b".repeat(ctx.MAX_PROGRESS_TOTAL_CHARS);
    savePack(ctx, "prog-a", big);
    const more = book.sheets.AppProgressMore;
    assert.ok(more);
    more.appendRow(["other", "other-prog", "99", "noise"]);
    more.appendRow(["other2", "x", "1", "keep"]);
    savePack(ctx, "prog-a", "c".repeat(45000));
    const loaded = loadPack(ctx, "prog-a").progress_json;
    assert.equal(loaded.length, 45000);
    assert.ok(more.snapshot().includes("noise"));
    assert.ok(more.snapshot().includes("keep"));
    const parsed = parsePackMoreFromValues_(ctx, more.getDataRange().getValues(), "kid", "prog-a");
    assert.equal(parsed.total, 2);
    assert.ok(!parsed.parts[49]);
  });

  function parsePackMoreFromValues_(ctx, values, idKey, program) {
    const total = 1;
    const parts = {};
    let chunkTotal = 1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]) !== idKey) continue;
      if (String(values[i][1]) !== program) continue;
      const part = parseInt(values[i][2], 10);
      if (part === 0) chunkTotal = parseInt(values[i][3], 10) || 1;
      else if (part >= 1) parts[part] = String(values[i][3]);
    }
    return { total: chunkTotal, parts };
  }

  it("cross-version: 1.4.0 writes and 1.4.1 reads, then reverse", () => {
    const book = makeBook();
    const ctx140 = loadCode(CODE_140, book);
    seedAccount(book);
    const payload = "d".repeat(45000);
    const w = savePack(ctx140, "cross", payload);
    assert.equal(w.ok, true);
    const ctx141 = loadCode(CODE_141, book);
    assert.equal(loadPack(ctx141, "cross").progress_json, payload);
    const payload2 = "e".repeat(80000);
    savePack(ctx141, "cross2", payload2);
    const ctx140b = loadCode(CODE_140, book);
    assert.equal(loadPack(ctx140b, "cross2").progress_json, payload2);
  });

  it("counts setValues/deleteRows for 50-piece first save and 50->2 shrink", () => {
    const book = makeBook();
    const ctx = loadCode(CODE_141, book);
    seedAccount(book);
    const big = "f".repeat(ctx.MAX_PROGRESS_TOTAL_CHARS);
    resetWriteStats(book);
    const first = savePack(ctx, "bench", big);
    assert.equal(first.ok, true);
    const firstSetValues = book.stats.setValues;
    const firstDeleteRows = book.stats.deleteRows || 0;
    assert.equal(firstDeleteRows, 0);

    resetWriteStats(book);
    savePack(ctx, "bench", "g".repeat(45000));
    const shrinkSetValues = book.stats.setValues;
    const shrinkDeleteRows = book.stats.deleteRows || 0;

    assert.equal(firstSetValues, 7);
    assert.equal(firstDeleteRows, 0);
    assert.equal(shrinkSetValues, 3);
    assert.equal(shrinkDeleteRows, 1);
  });
});
