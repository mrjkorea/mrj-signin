"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth } = require("./helpers/load-mrj-auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const WORKER_BASE = "https://mrj-progress-packs.canadianvegetarian.workers.dev";

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

function workerJsonResponse(obj, status) {
  return Promise.resolve({
    ok: status == null || status === 200,
    status: status == null ? 200 : status,
    text: () => Promise.resolve(JSON.stringify(obj))
  });
}

function isWorkerAuthUrl(url, path) {
  return String(url).indexOf(WORKER_BASE + path) !== -1;
}

function scriptBody(opts) {
  return JSON.parse(opts.body);
}

describe("mrj-auth Cloudflare login modes", () => {
  it("defaults LOGIN_MODE to gas and exposes AUTH_VERSION", () => {
    const { auth } = loadMrjAuth(() => Promise.resolve({ text: () => Promise.resolve("{}") }), null, 200);
    assert.equal(auth.AUTH_VERSION, "20261030-cf-login-1.7.2-gas");
    assert.equal(auth._test.loginMode(), "gas");
  });

  it("cfShouldFallbackToGas is false for definitive CF auth errors", () => {
    const { auth } = loadMrjAuth(() => Promise.resolve({ text: () => Promise.resolve("{}") }), null, 200);
    assert.equal(auth._test.cfShouldFallbackToGas({ ok: false, error: "wrong_password" }), false);
    assert.equal(auth._test.cfShouldFallbackToGas({ ok: false, error: "user_does_not_exist" }), false);
    assert.equal(auth._test.cfShouldFallbackToGas({ ok: false, error: "id_blocked" }), false);
    assert.equal(auth._test.cfShouldFallbackToGas({ ok: false, error: "cf_unknown" }), true);
    assert.equal(auth._test.cfShouldFallbackToGas({ ok: false, error: "cf_timeout" }), true);
  });

  it("shadow mode: GAS authority, parallel CF login and shadow_log", async () => {
    let shadowLogs = 0;
    let cfLogins = 0;
    let gasLogins = 0;
    const fetch = (url, opts) => {
      if (isWorkerAuthUrl(url, "/auth/login")) {
        cfLogins += 1;
        return workerJsonResponse({ ok: true, id: "kid", role: "", src: "cf" });
      }
      if (isWorkerAuthUrl(url, "/auth/shadow_log")) {
        shadowLogs += 1;
        const b = JSON.parse(opts.body);
        assert.equal(b.cf_result, "ok");
        assert.equal(b.gas_result, "ok");
        return workerJsonResponse({ ok: true });
      }
      const b = scriptBody(opts);
      if (b.action === "login") {
        gasLogins += 1;
        return jsonResponse({ ok: true, id: b.id, token: "gas-tok", progress: [] });
      }
      if (b.action === "progress") {
        return jsonResponse({ ok: true, id: b.id, token: b.token, progress: [] });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    };

    const { auth, root } = loadMrjAuth(fetch, null, 200, "shadow");
    auth.mount(root, { app: "word-master", onReady() {} });
    auth._test.performLoginSubmit("kid", "pw", ["kid", "pw"], function () {
      assert.fail("should not error");
    });
    await wait(500);
    assert.equal(cfLogins, 1);
    assert.equal(gasLogins, 1);
    assert.equal(shadowLogs, 1);
    assert.equal(auth.student(), "kid");
    assert.equal(auth.token(), "gas-tok");
  });

  it("cf_first: CF wrong_password fails closed without GAS login", async () => {
    let gasLogins = 0;
    const fetch = (url, opts) => {
      if (isWorkerAuthUrl(url, "/auth/login")) {
        return workerJsonResponse({
          ok: false,
          error: "wrong_password",
          message: "Wrong password."
        });
      }
      const b = scriptBody(opts);
      if (b.action === "login") {
        gasLogins += 1;
        return jsonResponse({ ok: true, id: b.id, token: "t", progress: [] });
      }
      return jsonResponse({ ok: false });
    };

    const { auth, root } = loadMrjAuth(fetch, null, 200, "cf_first");
    auth.mount(root, { app: "word-master", onReady() {} });
    let errMsg = "";
    auth._test.performLoginSubmit("kid", "bad", ["kid", "bad"], function (msg) {
      errMsg = msg;
    });
    await wait(400);
    assert.equal(gasLogins, 0);
    assert.match(errMsg, /Wrong password/i);
    assert.equal(auth.student(), "");
  });

  it("cf_first: cf_unknown falls back to GAS login", async () => {
    let gasLogins = 0;
    const fetch = (url, opts) => {
      if (isWorkerAuthUrl(url, "/auth/login")) {
        return workerJsonResponse({ ok: false, error: "cf_unknown" });
      }
      const b = scriptBody(opts);
      if (b.action === "login") {
        gasLogins += 1;
        return jsonResponse({ ok: true, id: b.id, token: "gas-only", progress: [] });
      }
      if (b.action === "progress") {
        return jsonResponse({ ok: true, id: b.id, token: b.token, progress: [] });
      }
      return jsonResponse({ ok: false });
    };

    const { auth, root } = loadMrjAuth(fetch, null, 200, "cf_first");
    auth.mount(root, { app: "word-master", onReady() {} });
    auth._test.performLoginSubmit("kid", "pw", ["kid", "pw"], function () {
      assert.fail("should not error");
    });
    await wait(500);
    assert.equal(gasLogins, 1);
    assert.equal(auth.token(), "gas-only");
  });

  it("cf_first success uses token_pending until background GAS token arrives", async () => {
    let gasLogins = 0;
    const fetch = (url, opts) => {
      if (isWorkerAuthUrl(url, "/auth/login")) {
        return workerJsonResponse({ ok: true, id: "kid", role: "", src: "cf" });
      }
      const b = scriptBody(opts);
      if (b.action === "login") {
        gasLogins += 1;
        return jsonResponse({ ok: true, id: b.id, token: "real-gas-token", progress: [] });
      }
      if (b.action === "progress") {
        assert.equal(b.token, "real-gas-token");
        return jsonResponse({ ok: true, id: b.id, token: b.token, progress: [] });
      }
      if (b.action === "note_score") {
        assert.equal(b.token, "real-gas-token");
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ ok: false });
    };

    const { auth, root } = loadMrjAuth(fetch, null, 200, "cf_first");
    auth.mount(root, { app: "word-master", onReady() {} });
    auth._test.performLoginSubmit("kid", "pw", ["kid", "pw"], function () {
      assert.fail("should not error");
    });
    await wait(600);
    assert.equal(gasLogins, 1);
    assert.equal(auth.token(), "real-gas-token");
    const note = await auth.noteScore({ program: "decodable", itemId: "x", scoreValue: 1, scoreMax: 1 });
    assert.equal(note.ok, true);
  });
});
