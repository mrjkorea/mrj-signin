"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth } = require("./helpers/load-mrj-auth");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(obj) {
  return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(obj)) });
}

describe("chip layout throttle", () => {
  it("schedules a trailing layout run inside the 500ms window", async () => {
    const fetch = (url, opts) => {
      const b = JSON.parse(opts.body);
      if (b.action === "login") {
        return jsonResponse({ ok: true, id: "kid", token: "tok", progress: [] });
      }
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
    const { auth, root } = loadMrjAuth(fetch);
    auth.mount(root, { app: "word-master", onReady: () => {} });
    auth._test.send({ action: "login", id: "kid", password: "pw" }, () => {}, () => {});
    await wait(3500);
    auth._test.setChipLayoutLastRun(Date.now());
    auth._test.scheduleChipLayout();
    assert.equal(auth._test.chipTrailingPending(), true);
    await wait(520);
    assert.equal(auth._test.chipTrailingPending(), false);
  });
});
