"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth } = require("./helpers/load-mrj-auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

describe("stale background progress must not switch students", () => {
  it("A retry success after sign-out and B login keeps B", async () => {
    let releaseA;
    const holdA = new Promise((resolve) => {
      releaseA = resolve;
    });
    let progressCallsA = 0;

    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "login" || b.action === "register") {
        return jsonResponse({
          ok: true,
          id: b.id,
          token: "tok-" + b.id,
          progress: []
        });
      }
      if (b.action === "progress") {
        if (b.id === "studentA") {
          progressCallsA += 1;
          if (progressCallsA <= 2) {
            return jsonResponse({ ok: false, error: "server", message: "busy" });
          }
          return holdA.then(() =>
            jsonResponse({
              ok: true,
              id: "studentA",
              token: "tok-studentA",
              progress: [{ program: "p", item: "stolen" }]
            })
          );
        }
        return jsonResponse({
          ok: true,
          id: b.id,
          token: b.token || "tok-" + b.id,
          progress: []
        });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    };

    const { auth, storage, root } = loadMrjAuth(fetch, null, 200);
    let readyCount = 0;
    let lastReadyId = "";
    auth.mount(root, {
      app: "word-master",
      onReady: (info) => {
        readyCount += 1;
        lastReadyId = info.id;
      }
    });

    auth._test.send(
      { action: "login", id: "studentA", password: "pw" },
      function () {},
      function () {}
    );
    await wait(4000);
    assert.equal(auth.student(), "studentA");

    auth.signOut();
    assert.equal(auth.student(), "");

    auth._test.send(
      { action: "login", id: "studentB", password: "pw" },
      function () {},
      function () {}
    );
    await wait(4000);
    assert.equal(auth.student(), "studentB");
    const sessionAfterB = storage["mrj.auth.session"];

    releaseA();
    await wait(800);
    assert.equal(auth.student(), "studentB");
    assert.equal(lastReadyId, "studentB");
    const sessionParsed = JSON.parse(sessionAfterB);
    assert.equal(sessionParsed.id, "studentB");
  });

  it("optimistic resume does not restore session after sign-out", async () => {
    let releaseResume;
    const holdResume = new Promise((resolve) => {
      releaseResume = resolve;
    });
    let progressCalls = 0;

    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "progress") {
        progressCalls += 1;
        if (progressCalls === 1) {
          return jsonResponse({
            ok: false,
            error: "progress_load_failed",
            message: "nope",
            id: b.id,
            token: b.token
          });
        }
        return holdResume.then(() =>
          jsonResponse({
            ok: true,
            id: b.id,
            token: b.token,
            progress: [{ program: "p", item: "1" }]
          })
        );
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    };

    const { auth, storage, root } = loadMrjAuth(
      fetch,
      { id: "studentA", token: "tokA" },
      200
    );
    auth.mount(root, { app: "word-master", onReady() {} });
    await wait(200);
    auth.signOut();
    assert.equal(auth.student(), "");
    assert.equal(storage["mrj.auth.session"], undefined);

    releaseResume();
    await wait(500);
    assert.equal(auth.student(), "");
    assert.equal(storage["mrj.auth.session"], undefined);
  });
});
