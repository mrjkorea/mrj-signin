"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const pure = require("../lib/signin-pure");

describe("mergeProgressJson", () => {
  it("stores incoming for word-master (no books)", () => {
    const stored = '{"sets":{"a":1},"v":1}';
    const incoming = '{"sets":{"a":2,"b":3}}';
    const out = pure.mergeProgressJson(stored, incoming, "word-master");
    assert.equal(out, incoming);
  });

  it("does not keep stored when incoming is not decodable-shaped (live bug)", () => {
    const stored = '{"sets":{}}';
    const incoming = '{"sets":{"x":1}}';
    const out = pure.mergeProgressJson(stored, "not json", "word-master");
    assert.equal(out, "not json");
    const out2 = pure.mergeProgressJson(stored, incoming, "word-master");
    assert.equal(out2, incoming);
  });

  it("merges decodable books", () => {
    const stored = JSON.stringify({
      v: 2,
      rev: 1,
      books: { b1: { passed: true, speakPages: { "1": 80 } } }
    });
    const incoming = JSON.stringify({
      v: 2,
      rev: 2,
      books: { b1: { listen: true, speakPages: { "1": 90, "2": 70 } } }
    });
    const out = JSON.parse(pure.mergeProgressJson(stored, incoming, "decodable"));
    assert.equal(out.books.b1.passed, true);
    assert.equal(out.books.b1.listen, true);
    assert.equal(out.books.b1.speakPages["1"], 90);
    assert.equal(out.rev, 2);
  });
});

describe("chunking", () => {
  it("round-trips large JSON", () => {
    const big = "x".repeat(pure.CHUNK_CHAR_MAX * 2 + 100);
    const split = pure.splitProgressChunks(big);
    assert.ok(split.chunks);
    assert.equal(split.chunks.length, 3);
    assert.equal(pure.joinProgressChunks(split.chunks), big);
  });

  it("rejects over max chunks", () => {
    const huge = "a".repeat(pure.CHUNK_CHAR_MAX * (pure.MAX_CHUNKS + 1));
    const split = pure.splitProgressChunks(huge);
    assert.equal(split.error, "too_large");
  });
});

describe("progress paging and filter", () => {
  const rows = [
    { program: "word-master", item: "a", score: "1/1", date: "2026-01-01" },
    { program: "day4-speak", item: "b", score: "2/2", date: "2026-01-02" },
    { program: "word-master", item: "c", score: "3/3", date: "2026-01-03" }
  ];

  it("filters by program", () => {
    const wm = pure.filterProgressByProgram(rows, "word-master");
    assert.equal(wm.length, 2);
    assert.equal(wm[0].item, "a");
  });

  it("pages with hasMore", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      program: "p",
      item: String(i),
      score: "",
      date: ""
    }));
    const page0 = pure.pageProgressRows(many, 0, 2);
    assert.equal(page0.progress.length, 2);
    assert.equal(page0.total, 5);
    assert.equal(page0.hasMore, true);
    const page2 = pure.pageProgressRows(many, 4, 2);
    assert.equal(page2.progress.length, 1);
    assert.equal(page2.hasMore, false);
  });
});

describe("tokens", () => {
  it("supports pipe-separated multi-token", () => {
    const stored = pure.pushToken_("t1", "t2", 5);
    assert.equal(pure.tokenMatches_(stored, "t2"), true);
    assert.equal(pure.tokenMatches_(stored, "t1"), true);
    assert.equal(pure.tokenMatches_(stored, "t9"), false);
  });
});
