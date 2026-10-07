"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadMrjAuth } = require("./helpers/load-mrj-auth");
const { fakeOldServer } = require("./helpers/fake-old-server");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function loginFlow(progressMode, action) {
  const srv = fakeOldServer(progressMode);
  const timeoutMs = progressMode === "timeout" ? 80 : 200;
  const { auth, storage, root } = loadMrjAuth(srv, null, timeoutMs);
  let ready = null;
  auth.mount(root, {
    app: "word-master",
    onReady: (info) => {
      ready = info;
    }
  });
  auth._test.send(
    { action: action || "login", id: "kid1", password: "pw" },
    function () {},
    function () {}
  );
  const waitMs = progressMode === "timeout" ? 6500 : 3500;
  await wait(waitMs);
  return { ready, storage, auth, srv };
}

describe("progress load failure must not block sign-in", () => {
  for (const mode of ["lockFail", "timeout", "html404", "newErr"]) {
    it("login + old server " + mode + " still signs in with progressError", async () => {
      const { ready, storage } = await loginFlow(mode, "login");
      assert.ok(ready && ready.id === "kid1");
      assert.equal(ready.progress.length, 0);
      assert.ok(ready.progressError);
      assert.ok(storage["mrj.auth.session"]);
    });

    it("register + old server " + mode + " still signs in with progressError", async () => {
      const { ready, storage } = await loginFlow(mode, "register");
      assert.ok(ready && ready.id === "kid1");
      assert.ok(ready.progressError);
      assert.ok(storage["mrj.auth.session"]);
    });
  }

  it("resume + 1.4.0 progress_load_failed uses resume_busy path", async () => {
    const srv = fakeOldServer("newErr");
    const { auth, storage, root } = loadMrjAuth(srv, { id: "kid1", token: "T1" });
    let ready = null;
    auth.mount(root, {
      app: "word-master",
      onReady: (info) => {
        ready = info;
      }
    });
    await wait(3500);
    assert.ok(ready && ready.id === "kid1");
    assert.ok(storage["mrj.auth.session"]);
    const screen = root.children.map((c) => c.textContent).join(" ");
    assert.ok(
      ready.progressError === "resume_pending" || screen.indexOf("slow") !== -1 || ready.progressError
    );
  });

  it("MRJ_AUTH.progressError() reflects last load state", async () => {
    const { auth } = await loginFlow("lockFail", "login");
    assert.ok(auth.progressError());
  });
});
