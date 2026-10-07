"use strict";

function rows(n) {
  return Array.from({ length: n }, (_, i) => ({
    program: "p",
    item: String(i),
    score: "1/1",
    date: ""
  }));
}

/**
 * Mock OLD live server (pre-1.4.0) progress behaviours for client tests.
 */
function fakeOldServer(progressMode) {
  const log = [];
  const ok = (o) => Promise.resolve({ text: () => Promise.resolve(JSON.stringify(o)) });
  const never = () => new Promise(() => {});

  const fetch = (url, opts) => {
    const b = JSON.parse(opts.body);
    log.push(b);
    if (b.action === "login" || b.action === "register") {
      return ok({
        ok: true,
        error: "",
        message: "",
        id: b.id,
        token: "T1",
        progress: []
      });
    }
    if (b.action === "progress") {
      if (progressMode === "ok20") {
        return ok({
          ok: true,
          error: "",
          message: "",
          id: b.id,
          token: b.token,
          progress: rows(20)
        });
      }
      if (progressMode === "okEmpty") {
        return ok({
          ok: true,
          error: "",
          message: "",
          id: b.id,
          token: b.token,
          progress: []
        });
      }
      if (progressMode === "timeout") return never();
      if (progressMode === "lockFail") {
        return ok({ ok: false, error: "server", message: "Something went wrong." });
      }
      if (progressMode === "html404") {
        return Promise.resolve({ text: () => Promise.resolve("<html>404</html>") });
      }
      if (progressMode === "newErr") {
        return ok({
          ok: false,
          error: "progress_load_failed",
          message: "Could not load saved progress.",
          id: b.id,
          token: b.token
        });
      }
    }
    return ok({ ok: false, error: "bad_action" });
  };
  fetch.log = log;
  return fetch;
}

module.exports = { fakeOldServer, rows };
