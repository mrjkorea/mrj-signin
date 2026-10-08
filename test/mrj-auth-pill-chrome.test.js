"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth, mkNode } = require("./helpers/load-mrj-auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

describe("student pill chrome", () => {
  it("updates pill aria-label when the signed-in student changes", async () => {
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "progress" || b.action === "login") {
        return jsonResponse({
          ok: true,
          id: b.id || "alice",
          token: "tok",
          progress: [],
          hasMore: false
        });
      }
      return jsonResponse({ ok: false });
    };
    const { auth, root, body, storage } = loadMrjAuth(fetch);
    const pill = mkNode("span", "student-pill");
    pill.getBoundingClientRect = () => ({ width: 80, height: 24, top: 8, left: 100, right: 180, bottom: 32 });
    body.appendChild(pill);
    auth.mount(root, { app: "mrj-zap-grammar-books" });
    auth._test.send({ action: "login", id: "alice", password: "pw" }, () => {}, () => {});
    await wait(3500);
    assert.equal(pill.getAttribute("aria-label"), "My scores for alice");
    auth.signOut();
    auth._test.send({ action: "login", id: "bob", password: "pw" }, () => {}, () => {});
    await wait(3500);
    assert.equal(auth.student(), "bob");
    assert.equal(pill.getAttribute("aria-label"), "My scores for bob");
    assert.equal(pill.title, "My scores for bob");
  });

  it("shows the chip again when a wired pill is hidden", async () => {
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
    const { auth, root, body } = loadMrjAuth(fetch, { id: "kid", token: "tok" });
    const pill = mkNode("span", "student-pill");
    pill.getBoundingClientRect = () => ({ width: 80, height: 24, top: 8, left: 100, right: 180, bottom: 32 });
    body.appendChild(pill);
    auth.mount(root, { app: "mrj-zap-grammar-books" });
    await wait(3500);
    auth._test.applyStudentChrome();
    const chip = body.children.find((c) => c.id === "mrj-auth-student-chip");
    assert.equal(chip.hidden, true);
    pill.hidden = true;
    auth._test.applyStudentChrome();
    assert.equal(chip.hidden, false);
  });
});
