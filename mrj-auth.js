/**
 * Browser sign-in for every MRJ student app.
 * Load mrj-auth.css beside this file. GitHub Pages can host both.
 * POST stays text/plain so the Apps Script web app does not need a CORS preflight.
 * The endpoint stays a placeholder until the script is deployed by hand.
 */
(function (global) {
  "use strict";

  var AUTH_VERSION = "20261007-progress-1.4";
  var ENDPOINT = "https://script.google.com/macros/s/AKfycbwtJTUO3gbcMrlAwsn1feWxyp7Rw2cxpfe1bOT9v2rxmQHa2Tlc6pFNWAjU6ZAdlD6kFQ/exec";
  var SESSION_KEY = "mrj.auth.session";
  var REQUEST_TIMEOUT_MS = 30000;

  var MESSAGES = {
    blank: "Type an ID and a password.",
    mismatch: "Those passwords do not match.",
    user_does_not_exist: "User does not exist.",
    wrong_password: "Wrong password.",
    id_taken: "That ID is already used. Log in instead.",
    server_busy: "The sign-in server is busy, trying again…",
    checking: "Checking your ID…",
    loading_place: "Loading your place…",
    still_signing_in: "Still signing you in… You can wait here or go back and try again in a moment.",
    resume_busy: "The sign-in server is slow. You are signed in on this device — we are double-checking in the background."
  };

  var NO_RETRY_ERRORS = {
    blank: true,
    wrong_password: true,
    user_does_not_exist: true,
    id_taken: true,
    password_mismatch: true,
    bad_token: true
  };

  function idKey(id) {
    return String(id == null ? "" : id)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function isBlankId(id) {
    return String(id == null ? "" : id).trim() === "";
  }

  function isBlankPassword(password) {
    return password == null || String(password) === "";
  }

  function rejectBlank(id, password) {
    if (isBlankId(id) || isBlankPassword(password)) {
      return { ok: false, error: "blank", message: MESSAGES.blank };
    }
    return { ok: true, error: "", message: "" };
  }

  function passwordAllowed(password) {
    return !isBlankPassword(password);
  }

  function passwordsEqual(a, b) {
    return String(a == null ? "" : a) === String(b == null ? "" : b);
  }

  function passwordsMatch(password, confirm) {
    if (!passwordsEqual(password, confirm)) {
      return { ok: false, error: "password_mismatch", message: MESSAGES.mismatch };
    }
    return { ok: true, error: "", message: "" };
  }

  function decideLogin(account, password) {
    if (!account) {
      return {
        ok: false,
        error: "user_does_not_exist",
        message: MESSAGES.user_does_not_exist
      };
    }
    if (!passwordsEqual(account.password, password)) {
      return {
        ok: false,
        error: "wrong_password",
        message: MESSAGES.wrong_password
      };
    }
    return { ok: true, error: "", message: "" };
  }

  function decideRegister(existingAccount) {
    if (existingAccount) {
      return { ok: false, error: "id_taken", message: MESSAGES.id_taken };
    }
    return { ok: true, error: "", message: "" };
  }

  function localRules() {
    return {
      MESSAGES: MESSAGES,
      idKey: idKey,
      isBlankId: isBlankId,
      isBlankPassword: isBlankPassword,
      rejectBlank: rejectBlank,
      passwordAllowed: passwordAllowed,
      passwordsEqual: passwordsEqual,
      passwordsMatch: passwordsMatch,
      decideLogin: decideLogin,
      decideRegister: decideRegister
    };
  }

  var rules = global.MRJAuthRules || localRules();

  var rootEl = null;
  var options = {};
  var state = { id: "", token: "", progress: [], progressError: "" };
  var packState = {};
  var PROGRESS_PAGE_SIZE = 500;
  var PROGRESS_MAX_PAGES = 40;
  var viewGen = 0;
  var busy = false;
  var loginFlightSeq = 0;
  var activeLoginFlight = null;
  var storageListenerInstalled = false;

  function delay_(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function parseJsonResponse_(text) {
    var trimmed = String(text == null ? "" : text).trim();
    if (!trimmed || (trimmed.charAt(0) !== "{" && trimmed.charAt(0) !== "[")) {
      var err = new Error("bad_response");
      err.kind = "bad_response";
      throw err;
    }
    try {
      return JSON.parse(trimmed);
    } catch (parseErr) {
      var err = new Error("bad_response");
      err.kind = "bad_response";
      throw err;
    }
  }

  function postOnce_(body, timeoutMs) {
    var opts = {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    };
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    if (ctrl) opts.signal = ctrl.signal;
    var ms = timeoutMs == null ? REQUEST_TIMEOUT_MS : timeoutMs;
    var timedOut = new Promise(function (_, reject) {
      setTimeout(function () {
        if (ctrl) ctrl.abort();
        var err = new Error("timeout");
        err.kind = "timeout";
        reject(err);
      }, ms);
    });
    var req = fetch(ENDPOINT, opts).then(function (res) {
      return res.text();
    }).then(function (text) {
      return parseJsonResponse_(text);
    });
    return Promise.race([req, timedOut]);
  }

  function shouldRetryResponse_(data) {
    if (!data || typeof data !== "object") return true;
    if (data.ok) return false;
    var code = data.error == null ? "" : String(data.error);
    if (NO_RETRY_ERRORS[code]) return false;
    return true;
  }

  function retryPlan_(action) {
    if (action === "login" || action === "register") {
      return { attempts: 3, delays: [0, 2000, 4000] };
    }
    return { attempts: 2, delays: [0, 1500] };
  }

  function post_(body, hook) {
    var action = body && body.action ? String(body.action) : "";
    var plan = retryPlan_(action);
    function runAttempt(index) {
      return postOnce_(body, REQUEST_TIMEOUT_MS).then(function (data) {
        if (!shouldRetryResponse_(data) || index >= plan.attempts - 1) return data;
        if (hook && typeof hook.onRetry === "function") hook.onRetry(index + 1, MESSAGES.server_busy);
        return delay_(plan.delays[index + 1] || 1500).then(function () {
          return runAttempt(index + 1);
        });
      }).catch(function (err) {
        if (index >= plan.attempts - 1) throw err;
        if (hook && typeof hook.onRetry === "function") hook.onRetry(index + 1, MESSAGES.server_busy);
        return delay_(plan.delays[index + 1] || 1500).then(function () {
          return runAttempt(index + 1);
        });
      });
    }
    return runAttempt(0);
  }

  function installStorageListener_() {
    if (storageListenerInstalled || !global.addEventListener) return;
    storageListenerInstalled = true;
    global.addEventListener("storage", function (event) {
      if (!event || event.key !== SESSION_KEY || !event.newValue) return;
      try {
        var parsed = JSON.parse(event.newValue);
        if (!parsed || !parsed.id || !parsed.token) return;
        if (!state.id || rules.idKey(parsed.id) !== rules.idKey(state.id)) return;
        if (String(parsed.token) === String(state.token)) return;
        state.token = String(parsed.token);
        saveSession_();
        if (state.id && rootEl) {
          fetchAllProgress_(state.id, state.token, appProgram_()).then(function (result) {
            if (result && result.ok) {
              if (result.token) state.token = String(result.token);
              state.progress = result.progress;
              state.progressError = "";
              saveSession_();
              if (typeof options.onReady === "function") {
                options.onReady({
                  id: state.id,
                  token: state.token,
                  progress: state.progress
                });
              }
            }
          }).catch(function () {});
        }
      } catch (ignore) {}
    });
  }

  function appProgram_() {
    if (options && options.app) return String(options.app).trim();
    return "";
  }

  function mount(el, opts) {
    installStorageListener_();
    var node = resolveEl_(el);
    if (!node) return;
    rootEl = node;
    options = opts || {};
    packState = {};
    rootEl.classList.add("mrj-auth");
    viewGen += 1;
    busy = false;
    state = { id: "", token: "", progress: [], progressError: "" };
    packState = {};
    var saved = readSession_();
    if (!saved) {
      renderDoors_();
      return;
    }
    resumeSession_(saved);
  }

  function resumeSession_(saved) {
    var gen = viewGen;
    renderStatus_(MESSAGES.checking, { resume: true });
    fetchAllProgress_(saved.id, saved.token, appProgram_(), {
      onRetry: function () {
        if (gen !== viewGen) return;
        renderStatus_(MESSAGES.server_busy, { resume: true });
      }
    }).then(function (result) {
      if (gen !== viewGen) return;
      if (result && result.ok) {
        finish_(result.id || saved.id, result.token || saved.token, result.progress);
        return;
      }
      if (sessionRejected_(result)) {
        clearSession_();
        renderDoors_();
        return;
      }
      optimisticResume_(saved, gen);
    }).catch(function () {
      if (gen !== viewGen) return;
      optimisticResume_(saved, gen);
    });
  }

  function optimisticResume_(saved, gen) {
    finish_(saved.id, saved.token, [], "resume_pending");
    if (rootEl) {
      var note = el_("p", "mrj-auth-status");
      note.textContent = MESSAGES.resume_busy;
      rootEl.insertBefore(note, rootEl.firstChild);
    }
    fetchAllProgress_(saved.id, saved.token, appProgram_()).then(function (result) {
      if (gen !== viewGen) return;
      if (!state.id || rules.idKey(state.id) !== rules.idKey(saved.id)) return;
      if (sessionRejected_(result)) {
        signOut();
        return;
      }
      if (!result || !result.ok) return;
      state.id = result.id || saved.id;
      state.token = result.token || saved.token;
      state.progress = result.progress;
      state.progressError = "";
      saveSession_();
      renderSignedIn_();
      dispatchReady_();
    }).catch(function () {});
  }

  function student() {
    return state.id || "";
  }

  function token() {
    return state.token || "";
  }

  function signOut() {
    viewGen += 1;
    busy = false;
    activeLoginFlight = null;
    state = { id: "", token: "", progress: [], progressError: "" };
    packState = {};
    clearSession_();
    if (rootEl) renderDoors_();
  }

  function renderDoors_(notice) {
    if (!rootEl) return;
    clear_(rootEl);
    if (notice) rootEl.appendChild(errorNode_(notice));
    var doors = el_("div", "mrj-auth-doors");
    var have = button_("I already have an ID", "mrj-auth-door mrj-auth-door-login");
    var make = button_("Make a new ID", "mrj-auth-door mrj-auth-door-new");
    have.addEventListener("click", function () { renderLogin_(); });
    make.addEventListener("click", function () { renderCreate_(); });
    doors.appendChild(have);
    doors.appendChild(make);
    rootEl.appendChild(doors);
  }

  function renderLogin_(message, values) {
    renderForm_({
      message: message,
      values: values,
      fields: [
        field_("ID", "text", "username"),
        field_("Password", "password", "current-password")
      ],
      submitLabel: "Log in",
      onSubmit: function (entered) {
        var id = entered[0];
        var password = entered[1];
        var blank = rules.rejectBlank(id, password);
        if (!blank.ok) {
          renderLogin_(blank.message, entered);
          return;
        }
        renderStatus_(MESSAGES.checking);
        send_({ action: "login", id: id, password: password }, function (data) {
          finish_(data.id || id, data.token, data.progress);
        }, function (msg) {
          renderLogin_(msg, entered);
        });
      },
      onBack: function () { renderDoors_(); }
    });
  }

  function renderCreate_(message, values) {
    renderForm_({
      message: message,
      values: values,
      fields: [
        field_("ID", "text", "username"),
        field_("Password", "password", "new-password"),
        field_("Type password again", "password", "new-password")
      ],
      submitLabel: "Make my ID",
      onSubmit: function (entered) {
        var id = entered[0];
        var password = entered[1];
        var again = entered[2];
        var blank = rules.rejectBlank(id, password);
        if (!blank.ok) {
          renderCreate_(blank.message, entered);
          return;
        }
        var match = rules.passwordsMatch(password, again);
        if (!match.ok) {
          renderCreate_(match.message, entered);
          return;
        }
        renderStatus_("Making your ID…");
        send_({ action: "register", id: id, password: password }, function (data) {
          finish_(data.id || id, data.token, data.progress);
        }, function (msg) {
          renderCreate_(msg, entered);
        });
      },
      onBack: function () { renderDoors_(); }
    });
  }

  function renderForm_(spec) {
    if (!rootEl) return;
    clear_(rootEl);
    if (spec.message) rootEl.appendChild(errorNode_(spec.message));
    var form = el_("form", "mrj-auth-form");
    form.setAttribute("novalidate", "novalidate");
    form.autocomplete = "on";
    var inputs = [];
    spec.fields.forEach(function (meta, index) {
      var wrap = el_("label", "mrj-auth-field");
      var name = el_("span", "mrj-auth-label");
      name.textContent = meta.label;
      var input = el_("input", "mrj-auth-input");
      input.type = meta.type;
      input.autocomplete = meta.autocomplete;
      input.spellcheck = false;
      input.autocapitalize = "off";
      input.autocorrect = "off";
      if (meta.type === "text") input.inputMode = "text";
      if (spec.values && spec.values[index] != null) input.value = spec.values[index];
      wrap.appendChild(name);
      wrap.appendChild(input);
      form.appendChild(wrap);
      inputs[index] = input;
    });
    var actions = el_("div", "mrj-auth-actions");
    var submit = button_(spec.submitLabel, "mrj-auth-submit");
    submit.type = "submit";
    var back = button_("Back", "mrj-auth-back");
    back.type = "button";
    back.addEventListener("click", function () {
      if (busy) return;
      spec.onBack();
    });
    actions.appendChild(submit);
    actions.appendChild(back);
    form.appendChild(actions);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (busy) return;
      var values = inputs.map(function (input) { return input.value; });
      spec.onSubmit(values);
    });
    rootEl.appendChild(form);
    if (inputs[0]) inputs[0].focus();
  }

  function renderSignedIn_() {
    if (!rootEl) return;
    clear_(rootEl);
    var title = el_("p", "mrj-auth-signed");
    title.textContent = "Signed in as " + state.id;
    rootEl.appendChild(title);
    var rows = state.progress || [];
    if (!rows.length) {
      var empty = el_("p", "mrj-auth-empty");
      empty.textContent = "No scores in the book yet.";
      rootEl.appendChild(empty);
    } else {
      var list = el_("ul", "mrj-auth-progress");
      rows.forEach(function (row) {
        var item = el_("li");
        var main = el_("span", "mrj-auth-prog-main");
        main.textContent = [row.program, row.item].filter(Boolean).join(" · ");
        var detail = el_("span");
        detail.textContent = [row.score, row.date].filter(Boolean).join(" · ");
        item.appendChild(main);
        if (detail.textContent) item.appendChild(detail);
        list.appendChild(item);
      });
      rootEl.appendChild(list);
    }
    var out = button_("Sign out", "mrj-auth-signout");
    out.addEventListener("click", signOut);
    rootEl.appendChild(out);
  }

  function waitBar_() {
    var bar = el_("div", "mrj-auth-wait-bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Working");
    return bar;
  }

  function renderStatus_(text, meta) {
    if (!rootEl) return;
    clear_(rootEl);
    var wait = el_("div", "mrj-auth-wait");
    wait.setAttribute("aria-busy", "true");
    var status = el_("p", "mrj-auth-status");
    status.setAttribute("aria-live", "polite");
    status.textContent = text;
    wait.appendChild(status);
    wait.appendChild(waitBar_());
    rootEl.appendChild(wait);
    var again = button_("Try again", "mrj-auth-back");
    again.addEventListener("click", function () {
      if (activeLoginFlight) {
        renderDoors_(MESSAGES.still_signing_in);
        return;
      }
      if (meta && meta.resume) {
        renderDoors_("Could not check the sign-in book. Try again.");
        return;
      }
      viewGen += 1;
      busy = false;
      renderDoors_("Didn't save. Try again.");
    });
    rootEl.appendChild(again);
  }

  function send_(body, onOk, showError) {
    var flightId = ++loginFlightSeq;
    activeLoginFlight = { id: flightId, body: body };
    busy = true;
    setBusy_(true);
    post_(body, {
      onRetry: function () {
        if (activeLoginFlight && activeLoginFlight.id === flightId) {
          renderStatus_(MESSAGES.server_busy);
        }
      }
    }).then(function (data) {
      var stillCurrent = activeLoginFlight && activeLoginFlight.id === flightId;
      if (data && data.ok && data.token) {
        if (activeLoginFlight && activeLoginFlight.id !== flightId) return;
        activeLoginFlight = null;
        busy = false;
        setBusy_(false);
        if (body && (body.action === "login" || body.action === "register")) {
          loadPlace_(data.id || body.id, data.token);
        } else {
          finish_(data.id || (body && body.id), data.token, data.progress);
        }
        return;
      }
      if (!stillCurrent) return;
      activeLoginFlight = null;
      busy = false;
      setBusy_(false);
      showError(errorText_(data));
    }).catch(function () {
      var stillCurrent = activeLoginFlight && activeLoginFlight.id === flightId;
      if (!stillCurrent) return;
      activeLoginFlight = null;
      busy = false;
      setBusy_(false);
      showError(MESSAGES.server_busy.replace("trying again…", "Please try again in a moment."));
    });
  }


  function progressBody_(id, tokenValue, program, offset) {
    var body = { action: "progress", id: id, token: tokenValue };
    if (program) body.program = program;
    if (offset) body.offset = offset;
    body.limit = PROGRESS_PAGE_SIZE;
    return body;
  }

  function fetchAllProgress_(id, tokenValue, program, hook) {
    var all = [];
    var offset = 0;
    var nextId = id;
    var nextToken = tokenValue;
    var pages = 0;
    function pullPage() {
      pages += 1;
      return post_(progressBody_(id, tokenValue, program, offset), hook).then(function (data) {
        if (!data || !data.ok) {
          return {
            ok: false,
            error: data && data.error ? data.error : "progress_load_failed",
            message: data && data.message ? data.message : "",
            id: data && data.id ? data.id : nextId,
            token: data && data.token ? data.token : nextToken
          };
        }
        if (data.id) nextId = data.id;
        if (data.token) nextToken = data.token;
        var chunk = Array.isArray(data.progress) ? data.progress : [];
        all = all.concat(chunk);
        var hasMore = data.hasMore === true;
        if (!hasMore && data.hasMore !== false && chunk.length >= PROGRESS_PAGE_SIZE) {
          hasMore = true;
        }
        if (typeof data.total === "number" && all.length >= data.total) hasMore = false;
        if (pages >= PROGRESS_MAX_PAGES) hasMore = false;
        if (hasMore && chunk.length > 0) {
          offset += chunk.length;
          return pullPage();
        }
        return {
          ok: true,
          id: nextId,
          token: nextToken,
          progress: all
        };
      });
    }
    return pullPage();
  }

  function retryProgressInBackground_(id, tokenValue) {
    var gen = viewGen;
    fetchAllProgress_(id, tokenValue, appProgram_()).then(function (result) {
      if (gen !== viewGen) return;
      if (!state.id || rules.idKey(state.id) !== rules.idKey(id)) return;
      if (!result || !result.ok) return;
      state.id = result.id || id;
      state.token = result.token || tokenValue;
      state.progress = result.progress;
      state.progressError = "";
      saveSession_();
      renderSignedIn_();
      dispatchReady_();
    }).catch(function () {});
  }

  function loadPlace_(id, tokenValue) {
    renderStatus_(MESSAGES.loading_place);
    fetchAllProgress_(id, tokenValue, appProgram_()).then(function (result) {
      if (result && result.ok) {
        finish_(result.id || id, result.token || tokenValue, result.progress);
        return;
      }
      if (sessionRejected_(result)) {
        renderLogin_("Sign in again.", [id, ""]);
        return;
      }
      var err = (result && result.error) ? result.error : "progress_load_failed";
      finish_((result && result.id) || id, (result && result.token) || tokenValue, [], err);
      retryProgressInBackground_(state.id, state.token);
    }).catch(function () {
      finish_(id, tokenValue, [], "network");
      retryProgressInBackground_(state.id, state.token);
    });
  }

  function dispatchReady_() {
    if (typeof options.onReady === "function") {
      options.onReady({
        id: state.id,
        token: state.token,
        progress: state.progress,
        progressError: state.progressError
      });
    }
  }

  function finish_(id, tokenValue, progress, progressError) {
    state.id = id == null ? "" : String(id);
    state.token = tokenValue == null ? "" : String(tokenValue);
    state.progress = Array.isArray(progress) ? progress : [];
    state.progressError = progressError ? String(progressError) : "";
    saveSession_();
    renderSignedIn_();
    dispatchReady_();
  }

  function progressError() {
    return state.progressError || "";
  }

  function packKey_(program) {
    return String(program || appProgram_() || "decodable").trim() || "decodable";
  }

  function loadPack(program) {
    program = packKey_(program);
    if (!state.id || !state.token) {
      return Promise.resolve({ ok: false, error: "bad_token" });
    }
    packState[program] = { loaded: false, json: "", error: "loading" };
    return post_({
      action: "load_pack",
      id: state.id,
      token: state.token,
      program: program
    }).then(function (data) {
      if (!data || !data.ok) {
        packState[program] = {
          loaded: false,
          json: "",
          error: data && data.error ? data.error : "pack_load_failed"
        };
        return data || { ok: false, error: "pack_load_failed" };
      }
      var json = data.progress_json != null ? String(data.progress_json) : "";
      packState[program] = { loaded: true, json: json, error: "" };
      return { ok: true, found: !!data.found, progress_json: json };
    }).catch(function () {
      packState[program] = { loaded: false, json: "", error: "network" };
      return { ok: false, error: "network" };
    });
  }

  function savePack(program, progressJson) {
    program = packKey_(program);
    if (!state.id || !state.token) {
      return Promise.resolve({ ok: false, error: "bad_token" });
    }
    var ps = packState[program];
    if (!ps || !ps.loaded) {
      return Promise.resolve({ ok: false, error: "pack_not_loaded" });
    }
    return post_({
      action: "save_pack",
      id: state.id,
      token: state.token,
      program: program,
      progress_json: progressJson == null ? "{}" : String(progressJson)
    }).then(function (data) {
      if (data && data.ok) {
        packState[program] = {
          loaded: true,
          json: String(progressJson == null ? "{}" : progressJson),
          error: ""
        };
      } else if (ps) {
        ps.loaded = false;
        ps.error = data && data.error ? data.error : "save_failed";
      }
      return data || { ok: false, error: "save_failed" };
    }).catch(function () {
      if (packState[program]) {
        packState[program].loaded = false;
        packState[program].error = "network";
      }
      return { ok: false, error: "network" };
    });
  }

  function packReady(program) {
    program = packKey_(program);
    var ps = packState[program];
    return !!(ps && ps.loaded && !ps.error);
  }

  function loadProgressForApp(program) {
    program = packKey_(program);
    if (!state.id || !state.token) {
      return Promise.resolve({ ok: false, error: "bad_token", progress: [] });
    }
    return fetchAllProgress_(state.id, state.token, program);
  }

  function errorText_(data) {
    if (data && data.message) return String(data.message);
    var code = data && data.error;
    if (code && rules.MESSAGES[code]) return rules.MESSAGES[code];
    if (code && MESSAGES[code]) return MESSAGES[code];
    return "Something went wrong.";
  }

  function sessionRejected_(data) {
    if (!data) return false;
    if (data.error === "user_does_not_exist" || data.error === "bad_token") return true;
    return data.message === rules.MESSAGES.user_does_not_exist;
  }

  function readSession_() {
    try {
      var raw = global.localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.id || !parsed.token) return null;
      return { id: String(parsed.id), token: String(parsed.token) };
    } catch (ignore) {
      return null;
    }
  }

  function saveSession_() {
    try {
      global.localStorage.setItem(SESSION_KEY, JSON.stringify({
        id: state.id,
        token: state.token
      }));
    } catch (ignore) {}
  }

  function clearSession_() {
    try {
      global.localStorage.removeItem(SESSION_KEY);
    } catch (ignore) {}
  }

  function resolveEl_(el) {
    if (!el) return null;
    if (typeof el === "string") return global.document.querySelector(el);
    return el;
  }

  function clear_(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function el_(tag, className) {
    var node = global.document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function button_(label, className) {
    var node = el_("button", className);
    node.type = "button";
    node.textContent = label;
    return node;
  }

  function errorNode_(message) {
    var node = el_("p", "mrj-auth-error");
    node.setAttribute("role", "alert");
    node.textContent = message;
    return node;
  }

  function field_(label, type, autocomplete) {
    return { label: label, type: type, autocomplete: autocomplete };
  }

  function setBusy_(on) {
    if (!rootEl) return;
    var buttons = rootEl.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = on;
  }

  function noteScore(fields) {
    fields = fields || {};
    if (!state.id || !state.token) return Promise.resolve({ ok: false, error: "bad_token" });
    return post_({
      action: "note_score",
      id: state.id,
      token: state.token,
      program: fields.program || "",
      itemId: fields.itemId || "",
      scoreValue: fields.scoreValue,
      scoreMax: fields.scoreMax,
      scorePct: fields.scorePct,
      localDate: fields.localDate || ""
    }).catch(function () {
      return { ok: false, error: "network" };
    });
  }

  var api = {
    AUTH_VERSION: AUTH_VERSION,
    ENDPOINT: ENDPOINT,
    mount: mount,
    student: student,
    token: token,
    signOut: signOut,
    noteScore: noteScore,
    app: appProgram_,
    loadProgressForApp: loadProgressForApp,
    loadPack: loadPack,
    savePack: savePack,
    packReady: packReady,
    progressError: progressError
  };

  if (global.MRJ_AUTH_TEST_MODE) {
    api._test = {
      post: post_,
      postOnce: postOnce_,
      send: send_,
      sessionRejected: sessionRejected_,
      fetchAllProgress: fetchAllProgress_,
      retryProgressInBackground: retryProgressInBackground_,
      progressBody: progressBody_,
      REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
      AUTH_VERSION: AUTH_VERSION
    };
  }

  global.MRJ_AUTH = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
