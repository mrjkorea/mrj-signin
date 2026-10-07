"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth } = require("./helpers/load-mrj-auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

describe("stale loadPack must not poison packState", () => {
  it("late loadPack for A leaves B packReady false and savePack blocked", async () => {
    let releaseA;
    const holdA = new Promise((resolve) => {
      releaseA = resolve;
    });

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
        return jsonResponse({
          ok: true,
          id: b.id,
          token: b.token,
          progress: []
        });
      }
      if (b.action === "load_pack") {
        if (b.id === "studentA") {
          return holdA.then(() =>
            jsonResponse({
              ok: true,
              found: true,
              progress_json: "{\"from\":\"studentA\"}"
            })
          );
        }
        return jsonResponse({ ok: true, found: false, progress_json: "" });
      }
      if (b.action === "save_pack") {
        return jsonResponse({ ok: true, saved: true });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    };

    const { auth, root } = loadMrjAuth(fetch, null, 200);
    auth.mount(root, { app: "word-master", onReady() {} });

    auth._test.send(
      { action: "login", id: "studentA", password: "pw" },
      function () {},
      function () {}
    );
    await wait(500);
    const loadA = auth.loadPack("word-master");

    auth.signOut();
    auth._test.send(
      { action: "login", id: "studentB", password: "pw" },
      function () {},
      function () {}
    );
    await wait(500);
    assert.equal(auth.student(), "studentB");
    assert.equal(auth.packReady("word-master"), false);

    releaseA();
    const loadResult = await loadA;
    assert.equal(loadResult.error, "stale_session");

    assert.equal(auth.packReady("word-master"), false);
    const saveResult = await auth.savePack("word-master", "{}");
    assert.equal(saveResult.error, "pack_not_loaded");
  });

  it("exposes idKey helper", () => {
    const { auth } = loadMrjAuth(() => jsonResponse({}));
    assert.equal(auth.idKey("  Kid One  "), "kid one");
  });
});
