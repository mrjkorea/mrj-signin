"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth, mkNode } = require("./helpers/load-mrj-auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

describe("mrj-auth teacher PIN unlock", () => {
  it("shows Teacher next to the student chip and elevates on correct PIN", async () => {
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
          hasMore: false
        });
      }
      if (b.action === "study_teacher_check") {
        if (String(b.pin).toLowerCase() !== "class-pin") {
          return jsonResponse({ ok: false, error: "forbidden", message: "Wrong PIN." });
        }
        return jsonResponse({ ok: true, error: "", message: "" });
      }
      return jsonResponse({ ok: false, error: "bad_action" });
    };
    const { auth, root, sandbox } = loadMrjAuth(fetch, null, 200);
    const body = sandbox.document.body;
    auth.mount(root, { app: "word-master" });
    auth._test.send({ action: "login", id: "studentA", password: "pw" }, () => {}, () => {});
    await wait(400);

    const chrome = sandbox.document.querySelector("#mrj-auth-chip-chrome");
    const chip = sandbox.document.querySelector("#mrj-auth-student-chip");
    const teacherBtn = sandbox.document.querySelector(".mrj-auth-teacher-btn");
    assert.ok(chrome);
    assert.ok(chip);
    assert.ok(teacherBtn);
    assert.equal(teacherBtn.hidden, false);
    assert.equal(chip.parentNode, chrome);
    assert.equal(teacherBtn.parentNode, chrome);
    assert.equal(auth.isTeacher(), false);

    teacherBtn.listeners.click[0]({ stopPropagation() {} });
    const panel = body.children.find((c) => c.id === "mrj-auth-progress-panel-root");
    assert.ok(panel && !panel.hidden);
    const pwInput = (function findInput(node) {
      if (node.tagName === "input" && node.type === "password") return node;
      for (let i = 0; i < node.children.length; i++) {
        const hit = findInput(node.children[i]);
        if (hit) return hit;
      }
      return null;
    })(panel);
    assert.ok(pwInput);
    pwInput.value = "class-pin";
    let form = pwInput.parentNode;
    while (form && form.tagName !== "form") form = form.parentNode;
    assert.ok(form);
    form.listeners.submit[0]({ preventDefault() {} });
    await wait(50);

    assert.equal(auth.isTeacher(), true);
    assert.equal(sandbox.document.body.classList.contains("mrj-teacher"), true);
    assert.equal(teacherBtn.textContent, "Exit");
    auth._test.setChipLayoutLastRun(0);
    auth._test.updateStudentChip();
    auth._test.scheduleChipLayout();
    await wait(50);
    const badge = (chip.children || []).find((c) =>
      String(c.className || "").includes("mrj-auth-teacher-badge")
    );
    assert.ok(badge, "chip should show TEACHER badge after unlock");
  });

  it("places Teacher beside a wired student pill", async () => {
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "progress") {
        return jsonResponse({
          ok: true,
          id: "kid",
          token: "tok",
          progress: [],
          hasMore: false
        });
      }
      return jsonResponse({ ok: false });
    };
    const { auth, root, sandbox } = loadMrjAuth(fetch, { id: "kid", token: "tok" });
    const pill = mkNode("span", "student-pill");
    pill.getBoundingClientRect = () => ({ width: 80, height: 24, top: 8, left: 100, right: 180, bottom: 32 });
    sandbox.document.body.appendChild(pill);
    auth.mount(root, { app: "mrj-zap-grammar-books" });
    await wait(3500);
    auth._test.applyStudentChrome();
    const teacherBtn = sandbox.document.querySelector(".mrj-auth-teacher-btn");
    assert.ok(teacherBtn);
    const pillIdx = pill.parentNode.children.indexOf(pill);
    assert.equal(pill.parentNode.children[pillIdx - 1], teacherBtn);
    assert.equal(teacherBtn.hidden, false);
  });
});
