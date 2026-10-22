"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth } = require("./helpers/load-mrj-auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

describe("mrj-auth teacher mode (client)", () => {
  it("student session unchanged — no role without server", async () => {
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "login") {
        return jsonResponse({ ok: true, id: b.id, token: "tok", progress: [] });
      }
      if (b.action === "progress") {
        return jsonResponse({
          ok: true,
          id: b.id,
          token: b.token,
          progress: [],
          total: 0,
          hasMore: false,
        });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    };
    const { auth, root, body } = loadMrjAuth(fetch, null, 200);
    auth.mount(root, { app: "word-master" });
    await wait(30);
    auth._test.send(
      { action: "login", id: "studentA", password: "pw" },
      () => {},
      () => {}
    );
    await wait(400);
    assert.equal(auth.student(), "studentA");
    assert.equal(auth.isTeacher(), false);
    assert.equal(body.classList.contains("mrj-teacher"), false);
  });

  it("teacher badge only when server returns role teacher", async () => {
    const fetch = () => jsonResponse({ ok: false });
    const { auth, root, sandbox } = loadMrjAuth(fetch, null, 200);
    auth.mount(root, { app: "word-master" });
    auth._test.finish("Andrew", "tok", [], "", "teacher");
    assert.equal(auth.isTeacher(), true);
    assert.equal(sandbox.document.body.classList.contains("mrj-teacher"), true);
    auth._test.updateStudentChip();
    auth._test.scheduleChipLayout();
    await wait(30);
    const chip = sandbox.document.querySelector("#mrj-auth-student-chip");
    assert.ok(chip);
    const badge = (chip.children || []).find((c) =>
      String(c.className || "").includes("mrj-auth-teacher-badge")
    );
    assert.ok(badge, "chip should include TEACHER badge when server role is teacher");
  });

  it("localStorage role tampering does not enable teacher mode", async () => {
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "progress") {
        return jsonResponse({
          ok: true,
          id: b.id,
          token: b.token,
          progress: [],
          total: 0,
          hasMore: false,
        });
      }
      return jsonResponse({ ok: false });
    };
    const { auth, storage, root, sandbox } = loadMrjAuth(fetch, null, 200);
    storage["mrj.auth.session"] = JSON.stringify({
      id: "Andrew",
      token: "tok",
      role: "teacher",
    });
    auth.mount(root, { app: "word-master" });
    await wait(400);
    assert.equal(auth.isTeacher(), false);
    assert.equal(sandbox.document.body.classList.contains("mrj-teacher"), false);
  });

  it("MRJSignin.isTeacher exposes the same API", async () => {
    const fetch = () => jsonResponse({ ok: false });
    const { sandbox } = loadMrjAuth(fetch, null, 200);
    const MRJSignin = sandbox.MRJSignin;
    assert.equal(typeof MRJSignin.isTeacher, "function");
    MRJSignin._test.applyServerRole("teacher");
    assert.equal(MRJSignin.isTeacher(), true);
  });
});
