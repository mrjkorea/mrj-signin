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

function isWorkerPackUrl(url, path) {
  return String(url).indexOf(WORKER_BASE + path) !== -1;
}

function scriptBody(opts) {
  return JSON.parse(opts.body);
}

async function loginKid(auth, root, id) {
  auth.mount(root, { app: "word-master", onReady() {} });
  auth._test.send(
    { action: "login", id: id || "kid", password: "pw" },
    function () {},
    function () {}
  );
  await wait(400);
}

describe("mrj-auth Worker-first progress packs", () => {
  it("loadPack returns Worker data without calling Apps Script load_pack", async () => {
    let scriptLoadCalls = 0;
    const fetch = (url, opts) => {
      if (isWorkerPackUrl(url, "/load_pack")) {
        const b = JSON.parse(opts.body);
        assert.equal(b.student_id, "kid");
        assert.equal(b.program, "decodable");
        assert.equal(
          opts.headers["X-MRJ-Progress-Key"],
          "fe492cacc6396c4afa89768a3678da0d23faaab42741b5a6d4d193e7842ed0cc"
        );
        return workerJsonResponse({
          ok: true,
          found: true,
          progress_json: '{"from":"worker"}'
        });
      }
      const b = scriptBody(opts);
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
        scriptLoadCalls += 1;
        return jsonResponse({ ok: true, found: false, progress_json: "" });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    };

    const { auth, root } = loadMrjAuth(fetch, null, 200);
    await loginKid(auth, root);
    const load = await auth.loadPack("decodable");
    assert.equal(scriptLoadCalls, 0);
    assert.equal(load.ok, true);
    assert.equal(load.found, true);
    assert.equal(load.progress_json, '{"from":"worker"}');
    assert.equal(auth.packReady("decodable"), true);
  });

  it("loadPack falls back to Apps Script when Worker request fails", async () => {
    let scriptLoadCalls = 0;
    const fetch = (url, opts) => {
      if (isWorkerPackUrl(url, "/load_pack")) {
        return Promise.reject(new Error("network"));
      }
      const b = scriptBody(opts);
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
        scriptLoadCalls += 1;
        return jsonResponse({
          ok: true,
          found: true,
          progress_json: '{"from":"script"}'
        });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    };

    const { auth, root } = loadMrjAuth(fetch, null, 200);
    await loginKid(auth, root);
    const load = await auth.loadPack("decodable");
    assert.equal(scriptLoadCalls, 1);
    assert.equal(load.progress_json, '{"from":"script"}');
  });

  it("loadPack treats Worker 401 as failure without Apps Script fallback", async () => {
    let scriptLoadCalls = 0;
    const fetch = (url, opts) => {
      if (isWorkerPackUrl(url, "/load_pack")) {
        return workerJsonResponse({ ok: false }, 401);
      }
      const b = scriptBody(opts);
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
        scriptLoadCalls += 1;
        return jsonResponse({ ok: true, found: false, progress_json: "" });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    };

    const { auth, root } = loadMrjAuth(fetch, null, 200);
    await loginKid(auth, root);
    const load = await auth.loadPack("decodable");
    assert.equal(scriptLoadCalls, 0);
    assert.equal(load.ok, false);
    assert.equal(load.error, "unauthorized");
  });

  it("savePack succeeds on Worker and shadows Apps Script save", async () => {
    let scriptSaveCalls = 0;
    const fetch = (url, opts) => {
      if (isWorkerPackUrl(url, "/load_pack")) {
        return workerJsonResponse({
          ok: true,
          found: true,
          progress_json: "{}"
        });
      }
      if (isWorkerPackUrl(url, "/save_pack")) {
        const b = JSON.parse(opts.body);
        assert.equal(b.student_id, "kid");
        assert.equal(b.program, "word-master");
        assert.equal(b.progress_json, '{"saved":1}');
        return workerJsonResponse({ ok: true, saved: true });
      }
      const b = scriptBody(opts);
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
      if (b.action === "save_pack") {
        scriptSaveCalls += 1;
        return jsonResponse({ ok: true, saved: true });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    };

    const { auth, root } = loadMrjAuth(fetch, null, 200);
    await loginKid(auth, root);
    await auth.loadPack("word-master");
    const save = await auth.savePack("word-master", '{"saved":1}');
    assert.equal(save.ok, true);
    await wait(200);
    assert.equal(scriptSaveCalls, 1);
  });

  it("savePack falls back to Apps Script when Worker save fails", async () => {
    let scriptSaveCalls = 0;
    const fetch = (url, opts) => {
      if (isWorkerPackUrl(url, "/load_pack")) {
        return workerJsonResponse({
          ok: true,
          found: true,
          progress_json: "{}"
        });
      }
      if (isWorkerPackUrl(url, "/save_pack")) {
        return workerJsonResponse({ ok: false }, 500);
      }
      const b = scriptBody(opts);
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
      if (b.action === "save_pack") {
        scriptSaveCalls += 1;
        return jsonResponse({ ok: true, saved: true });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    };

    const { auth, root } = loadMrjAuth(fetch, null, 200);
    await loginKid(auth, root);
    await auth.loadPack("word-master");
    const save = await auth.savePack("word-master", '{"via":"script"}');
    assert.equal(save.ok, true);
    assert.equal(scriptSaveCalls, 1);
  });
});
