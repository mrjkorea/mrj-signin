"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth } = require("./helpers/load-mrj-auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

describe("mrj-auth blocked account (client)", () => {
  it("login shows the blocked message and does not keep a session", async () => {
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "login") {
        return jsonResponse({
          ok: false,
          error: "id_blocked",
          message: "This ID is not active. Please ask Mr. Jay."
        });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    };

    const { auth, storage, root } = loadMrjAuth(fetch, null, 200);
    let err = "";
    auth.mount(root, { app: "word-master" });
    auth._test.send(
      { action: "login", id: "blockedKid", password: "pw" },
      function () {},
      function (msg) {
        err = msg;
      }
    );
    await wait(300);
    assert.equal(err, "This ID is not active. Please ask Mr. Jay.");
    assert.equal(auth.student(), "");
    assert.equal(storage["mrj.auth.session"], undefined);
  });

  it("load_pack signs out locally when server returns id_blocked", async () => {
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "login") {
        return jsonResponse({
          ok: true,
          id: b.id,
          token: "tok-live",
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
        return jsonResponse({
          ok: false,
          error: "id_blocked",
          message: "This ID is not active. Please ask Mr. Jay."
        });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    };

    const { auth, storage, root } = loadMrjAuth(fetch, null, 200);
    auth.mount(root, { app: "word-master" });
    auth._test.send(
      { action: "login", id: "kid", password: "pw" },
      function () {},
      function () {}
    );
    await wait(500);
    assert.equal(auth.student(), "kid");

    const load = await auth.loadPack("decodable");
    assert.equal(load.error, "id_blocked");
    assert.equal(auth.student(), "");
    assert.equal(storage["mrj.auth.session"], undefined);
  });
});
