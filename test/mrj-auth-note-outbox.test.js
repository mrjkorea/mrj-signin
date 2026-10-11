"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth } = require("./helpers/load-mrj-auth");

const TEST_ID = "zz_test_mrjmetrics";
const OTHER_TEST_ID = "zz_test_mrjmetrics_alt";
const OUTBOX_KEY = "mrj.auth.noteOutbox.zz_test_mrjmetrics";
const OTHER_OUTBOX_KEY = "mrj.auth.noteOutbox.zz_test_mrjmetrics_alt";

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

function loginFetch(extra) {
  return (url, opts) => {
    const b = JSON.parse(opts.body);
    if (b.action === "login" || b.action === "register") {
      return jsonResponse({
        ok: true,
        id: b.id,
        token: "tok-" + b.id,
        progress: []
      });
    }
    if (typeof extra === "function") return extra(url, opts, b);
    return jsonResponse({ ok: false, error: "bad_action" });
  };
}

describe("noteScore localDate default and outbox", () => {
  it("noteScore without localDate sends today via MRJ_AUTH.localDate", async () => {
    const bodies = [];
    const { auth } = loadMrjAuth((url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "note_score") bodies.push(b);
      return jsonResponse({ ok: true });
    });
    auth._test.finish(TEST_ID, "tok", []);
    const expected = auth.localDate();
    await auth.noteScore({
      program: "word-master",
      itemId: "book:u1:quiz",
      scoreValue: 8,
      scoreMax: 10,
      scorePct: 80
    });
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].localDate, expected);
    assert.match(bodies[0].localDate, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("noteScore keeps an explicit localDate", async () => {
    const bodies = [];
    const { auth } = loadMrjAuth((url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "note_score") bodies.push(b);
      return jsonResponse({ ok: true });
    });
    auth._test.finish(TEST_ID, "tok", []);
    await auth.noteScore({
      program: "word-master",
      itemId: "book:u1:quiz",
      scoreValue: 1,
      scoreMax: 1,
      scorePct: 100,
      localDate: "2025-03-09"
    });
    assert.equal(bodies[0].localDate, "2025-03-09");
  });

  it("network failure queues one entry and finish_ flushes it", async () => {
    let noteCalls = 0;
    const { auth, storage } = loadMrjAuth((url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "note_score") {
        noteCalls += 1;
        if (noteCalls <= 2) {
          return jsonResponse({ ok: false, error: "network" });
        }
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    });
    auth._test.finish(TEST_ID, "tok-flush", []);
    await new Promise((r) => setTimeout(r, 50));
    const fail = await auth.noteScore({
      program: "pronounce",
      itemId: "p:w1:a1",
      scoreValue: 5,
      scoreMax: 5,
      scorePct: 100
    });
    assert.equal(fail.ok, false);
    assert.equal(fail.queued, true);
    const raw = storage[OUTBOX_KEY];
    assert.ok(raw);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].itemId, "p:w1:a1");

    auth._test.finish(TEST_ID, "tok-flush", []);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(noteCalls, 3);
    assert.equal(storage[OUTBOX_KEY], undefined);
  });

  it("drops a queued older entry when a newer success exists for the same item", async () => {
    let noteCalls = 0;
    const { auth, storage } = loadMrjAuth((url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "note_score") {
        noteCalls += 1;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    });
    auth._test.finish(TEST_ID, "tok", []);
    await new Promise((r) => setTimeout(r, 50));
    await auth.noteScore({
      program: "word-master",
      itemId: "book:u2:old",
      scoreValue: 9,
      scoreMax: 10,
      scorePct: 90
    });
    assert.equal(noteCalls, 1);
    storage[OUTBOX_KEY] = JSON.stringify([
      {
        program: "word-master",
        itemId: "book:u2:old",
        scoreValue: 3,
        scoreMax: 10,
        scorePct: 30,
        localDate: "2026-01-01",
        at: 1000
      }
    ]);
    auth._test.finish(TEST_ID, "tok", []);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(noteCalls, 1);
    assert.equal(storage[OUTBOX_KEY], undefined);
  });

  it("does not send student A outbox after sign-out and sign-in as B", async () => {
    const noteIds = [];
    const { auth, storage } = loadMrjAuth((url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "note_score") {
        noteIds.push(b.id);
        return jsonResponse({ ok: true });
      }
      if (b.action === "login") {
        return jsonResponse({ ok: true, id: b.id, token: "tok-" + b.id, progress: [] });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    });
    auth._test.finish(TEST_ID, "tok-a", []);
    await new Promise((r) => setTimeout(r, 50));
    storage[OUTBOX_KEY] = JSON.stringify([
      {
        program: "typing-kids",
        itemId: "tk:1:drill",
        scoreValue: 10,
        scoreMax: 10,
        scorePct: 100,
        localDate: "2026-10-10",
        at: Date.now()
      }
    ]);
    auth.signOut();
    auth._test.finish("student_b_other", "tok-b", []);
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(noteIds, []);
    assert.ok(storage[OUTBOX_KEY]);
    assert.equal(storage["mrj.auth.noteOutbox.student_b_other"], undefined);
  });

  it("never stores token in the outbox payload", async () => {
    const { auth, storage } = loadMrjAuth((url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "note_score") {
        return jsonResponse({ ok: false, error: "network" });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    });
    auth._test.finish(TEST_ID, "secret-token-value", []);
    await auth.noteScore({
      program: "decodable",
      itemId: "d:1:read",
      scoreValue: 1,
      scoreMax: 1,
      scorePct: 100
    });
    const raw = storage[OUTBOX_KEY];
    assert.ok(raw);
    assert.equal(raw.indexOf("secret-token"), -1);
    assert.equal(raw.indexOf("token"), -1);
    const entry = JSON.parse(raw)[0];
    assert.equal(entry.token, undefined);
  });

  it("failed noteScore during student switch queues only under the starter id", async () => {
    let releaseNote;
    const holdNote = new Promise((resolve) => {
      releaseNote = resolve;
    });

    const { auth, storage } = loadMrjAuth((url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "note_score") {
        return holdNote.then(() => jsonResponse({ ok: false, error: "network" }));
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    });

    auth._test.finish(TEST_ID, "tok-a", []);
    await new Promise((r) => setTimeout(r, 50));

    const pending = auth.noteScore({
      program: "word-master",
      itemId: "book:race:quiz",
      scoreValue: 6,
      scoreMax: 10,
      scorePct: 60
    });

    auth.signOut();
    auth._test.finish(OTHER_TEST_ID, "tok-b", []);
    releaseNote();
    await pending;
    await new Promise((r) => setTimeout(r, 3500));

    assert.ok(storage[OUTBOX_KEY]);
    assert.equal(JSON.parse(storage[OUTBOX_KEY]).length, 1);
    assert.equal(JSON.parse(storage[OUTBOX_KEY])[0].itemId, "book:race:quiz");
    assert.equal(storage[OTHER_OUTBOX_KEY], undefined);
  });

  it("bad_token on flush does not retry in a loop", async () => {
    let noteCalls = 0;
    const { auth, storage } = loadMrjAuth((url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "note_score") {
        noteCalls += 1;
        return jsonResponse({ ok: false, error: "bad_token" });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    });
    storage[OUTBOX_KEY] = JSON.stringify([
      {
        program: "pronounce",
        itemId: "p:1:x",
        scoreValue: 1,
        scoreMax: 1,
        scorePct: 100,
        localDate: "2026-10-11",
        at: Date.now()
      }
    ]);
    auth._test.finish(TEST_ID, "tok-bad", []);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(noteCalls, 1);
    assert.ok(storage[OUTBOX_KEY]);
  });
});
