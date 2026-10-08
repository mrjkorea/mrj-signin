"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth } = require("./helpers/load-mrj-auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

describe("loadPlace latest call wins", () => {
  it("stale A progress cannot finish after B loadPlace (A resolves first)", async () => {
    let releaseA;
    const holdA = new Promise((r) => {
      releaseA = r;
    });
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action !== "progress") return jsonResponse({ ok: false });
      if (b.id === "studentA") {
        return holdA.then(() =>
          jsonResponse({
            ok: true,
            id: "studentA",
            token: "tok-A",
            progress: [{ program: "word-master", item_id: "stolen" }],
            hasMore: false
          })
        );
      }
      return jsonResponse({
        ok: true,
        id: b.id,
        token: b.token,
        progress: [],
        hasMore: false
      });
    };
    const { auth, root } = loadMrjAuth(fetch, null, 200);
    auth.mount(root, { app: "word-master" });
    auth._test.loadPlace("studentA", "tok-A");
    auth._test.loadPlace("studentB", "tok-B");
    releaseA();
    await wait(4000);
    assert.equal(auth.student(), "studentB");
  });

  it("stale A progress cannot finish after B loadPlace (B resolves first)", async () => {
    let releaseA;
    const holdA = new Promise((r) => {
      releaseA = r;
    });
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action !== "progress") return jsonResponse({ ok: false });
      if (b.id === "studentA") {
        return holdA.then(() =>
          jsonResponse({
            ok: true,
            id: "studentA",
            token: "tok-A",
            progress: [],
            hasMore: false
          })
        );
      }
      return jsonResponse({
        ok: true,
        id: b.id,
        token: b.token,
        progress: [],
        hasMore: false
      });
    };
    const { auth, root } = loadMrjAuth(fetch, null, 200);
    auth.mount(root, { app: "word-master" });
    auth._test.loadPlace("studentA", "tok-A");
    auth._test.loadPlace("studentB", "tok-B");
    await wait(500);
    assert.equal(auth.student(), "studentB");
    releaseA();
    await wait(2000);
    assert.equal(auth.student(), "studentB");
  });
});
