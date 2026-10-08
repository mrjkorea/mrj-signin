"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth, mkNode } = require("./helpers/load-mrj-auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

describe("data-mrj-own-record", () => {
  it("hides chip and does not wire the app's own record control", async () => {
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
    const own = mkNode("button", "");
    own.setAttribute("data-mrj-own-record", "1");
    own.textContent = "kid";
    own.getBoundingClientRect = () => ({ width: 80, height: 28, top: 8, left: 900, right: 980, bottom: 36 });
    body.appendChild(own);
    auth.mount(root, { app: "word-master" });
    await wait(3500);
    auth._test.applyStudentChrome();
    const chip = body.children.find((c) => c.id === "mrj-auth-student-chip");
    assert.ok(chip);
    assert.equal(chip.hidden, true);
    assert.equal(own.getAttribute("data-mrj-pill-wired"), null);
    assert.equal(own.getAttribute("role"), null);
  });
});
