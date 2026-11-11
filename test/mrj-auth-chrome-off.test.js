"use strict";

// A page that asks for no student chrome must not paint the Teacher button either.
// Reg/Metrics 2026-11-11, after the news quiz showed a lone "Teacher" button on a
// signed-in student page that had asked for chipOff.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth } = require("./helpers/load-mrj-auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

function loginFetch() {
  return (url, opts) => {
    const b = JSON.parse(opts.body);
    if (b.action === "login" || b.action === "register") {
      return jsonResponse({ ok: true, id: b.id, token: "tok-" + b.id, progress: [] });
    }
    if (b.action === "progress" || b.action === "student_dashboard") {
      return jsonResponse({ ok: true, id: b.id, token: b.token, progress: [], hasMore: false });
    }
    return jsonResponse({ ok: false, error: "bad_action" });
  };
}

async function signedIn(opts) {
  const { auth, root, body } = loadMrjAuth(loginFetch());
  auth.mount(root, Object.assign({ app: "daily-news-quiz", onReady: () => {} }, opts));
  auth._test.send({ action: "login", id: "kid1", password: "pw" }, () => {}, () => {});
  await wait(3500);
  return { auth, body };
}

const teacherBtn = (body) =>
  body.children.find((c) => c.classNames && c.classNames.includes("mrj-auth-teacher-btn")) ||
  body.querySelector(".mrj-auth-teacher-btn");

describe("chromeOff keeps the Teacher button off the page", () => {
  it("chipOff hides the Teacher button", async () => {
    const { body } = await signedIn({ chipOff: true });
    const btn = teacherBtn(body);
    assert.ok(btn, "teacher button element exists");
    assert.equal(btn.hidden, true);
  });

  it("chromeOff hides chip, and the Teacher button", async () => {
    const { body } = await signedIn({ chromeOff: true });
    const chip = body.querySelector("#mrj-auth-student-chip");
    assert.ok(chip);
    assert.equal(chip.hidden, true);
    const btn = teacherBtn(body);
    assert.ok(btn, "teacher button element exists");
    assert.equal(btn.hidden, true);
  });

  it("teacherButton: false hides the button but keeps the chip", async () => {
    const { body } = await signedIn({ teacherButton: false });
    const chip = body.querySelector("#mrj-auth-student-chip");
    assert.ok(chip);
    assert.equal(chip.hidden, false);
    const btn = teacherBtn(body);
    assert.ok(btn);
    assert.equal(btn.hidden, true);
  });

  it("a plain mount still shows the Teacher button to a signed-in student", async () => {
    const { body } = await signedIn({});
    const btn = teacherBtn(body);
    assert.ok(btn, "teacher button element exists");
    assert.equal(btn.hidden, false);
  });
});
