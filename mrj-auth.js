/**
 * Browser sign-in for every MRJ student app.
 * Load mrj-auth.css beside this file. GitHub Pages can host both.
 * POST stays text/plain so the Apps Script web app does not need a CORS preflight.
 * The endpoint stays a placeholder until the script is deployed by hand.
 */
(function (global) {
  "use strict";

  var AUTH_VERSION = "20261007-progress-1.4.2";
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
  var PROGRESS_PANEL_MAX_PAGES = 40;
  var DAY2_PACK_ITEM_RE = /^(basic_[abc]|int[23][abc])_u\d+:/;
  var DECODABLE_41_ITEM_RE = /^mlr_dec_(04[1-9]|0[5-6]\d|070):/;
  var DECODABLE_71_ITEM_RE = /^mlr_dec_(07[1-9]|0[89]\d|100):/;
  var WHISTLE_ITEM_RE = /^whistle:/;
  var APP_SCORE_PROGRAM_MAP = {
    "word-master": ["word-master"],
    "day2-words": ["day2-words", "word-master"],
    "day3-workbook": ["day3-workbook", "conversation"],
    "day4-speak": ["day4-speak"],
    "day5-practice": ["day5-practice"],
    "day6-talk": ["day6-talk"],
    "leap-frog": ["leap-frog"],
    "ski-jump": ["ski-jump"],
    "firefighter-spelling": ["firefighter-spelling"],
    "typing-kids": ["typing-kids"],
    "skill-builder-g1": ["skill-builder-g1"],
    "mrj-zap-grammar-books": ["greenzap"],
    "pronounce": ["pronounce"],
    "pronounce-whistle": ["pronounce"],
    "mrj-decodable-try-41": ["decodable"],
    "mrj-decodable-try-71": ["decodable"],
    "news-words": ["news-words"]
  };
  var viewGen = 0;
  var sessionGen = 0;
  var chipEl = null;
  var panelRootEl = null;
  var panelBodyEl = null;
  var panelFetchGen = 0;
  var panelOpen = false;
  var panelKeyHandler = null;
  var panelRowsProvider = null;
  var chipMutationObserver = null;
  var chipLayoutScheduled = false;
  var chipLayoutLastRun = 0;
  var chipLayoutTrailingTimer = null;
  var loadPlaceSeq = 0;
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

  function appKey_() {
    return String(appProgram_() || "").trim().toLowerCase();
  }

  function chipDisabled_() {
    try {
      if (options && options.chipOff === true) return true;
      var doc = global.document;
      if (!doc || !doc.documentElement) return false;
      var script = doc.currentScript;
      if (script && script.getAttribute && String(script.getAttribute("data-mrj-chip") || "").trim().toLowerCase() === "off") {
        return true;
      }
      var boot = doc.querySelector && doc.querySelector("script[data-mrj-app][src*='mrj-auth-boot']");
      if (boot && String(boot.getAttribute("data-mrj-chip") || "").trim().toLowerCase() === "off") {
        return true;
      }
      if (String(doc.documentElement.getAttribute("data-mrj-chip") || "").trim().toLowerCase() === "off") {
        return true;
      }
      if (doc.body && String(doc.body.getAttribute("data-mrj-chip") || "").trim().toLowerCase() === "off") {
        return true;
      }
    } catch (ignore) {}
    return false;
  }

  function readBootAttr_(name) {
    try {
      var doc = global.document;
      if (!doc) return "";
      if (options && options.bootAttrs && options.bootAttrs[name]) {
        return String(options.bootAttrs[name]);
      }
      var boot = doc.querySelector && doc.querySelector("script[data-mrj-app][src*='mrj-auth-boot']");
      if (boot && boot.getAttribute) {
        var v = boot.getAttribute(name);
        if (v != null && String(v).trim()) return String(v).trim();
      }
      if (doc.documentElement && doc.documentElement.getAttribute) {
        var hv = doc.documentElement.getAttribute(name);
        if (hv != null && String(hv).trim()) return String(hv).trim();
      }
      if (doc.body && doc.body.getAttribute) {
        var bv = doc.body.getAttribute(name);
        if (bv != null && String(bv).trim()) return String(bv).trim();
      }
    } catch (ignore) {}
    return "";
  }

  function panelAppKey_() {
    var override = (options && options.panelApp) || readBootAttr_("data-mrj-panel-app");
    if (override && String(override).trim()) {
      return String(override).trim().toLowerCase();
    }
    var key = appKey_();
    if (key === "pronounce") {
      try {
        var path = global.location && global.location.pathname ? String(global.location.pathname) : "";
        if (path.indexOf("/pronounce-whistle/") !== -1) return "pronounce-whistle";
      } catch (ignore) {}
    }
    return key;
  }

  function scoreProgramsForApp_() {
    var override = options && options.scorePrograms;
    if (override != null && String(override).trim()) {
      return String(override)
        .split(",")
        .map(function (s) { return String(s).trim(); })
        .filter(Boolean);
    }
    var key = panelAppKey_();
    if (key && APP_SCORE_PROGRAM_MAP[key]) {
      return APP_SCORE_PROGRAM_MAP[key].slice();
    }
    if (key && APP_SCORE_PROGRAM_MAP[appKey_()]) {
      return APP_SCORE_PROGRAM_MAP[appKey_()].slice();
    }
    if (key) return [key];
    return [];
  }

  function compileItemRegex_(source) {
    if (!source || !String(source).trim()) return null;
    try {
      return new RegExp(String(source).trim());
    } catch (ignore) {
      return null;
    }
  }

  function bootItemInclude_() {
    var s = (options && options.itemInclude) || readBootAttr_("data-mrj-item-include");
    return compileItemRegex_(s);
  }

  function bootItemExclude_() {
    var s = (options && options.itemExclude) || readBootAttr_("data-mrj-item-exclude");
    return compileItemRegex_(s);
  }

  function rowPassesItemFilter_(row) {
    var itemId = rowItemId_(row);
    if (!itemId) return false;
    var prog = rowProgramName_(row).toLowerCase();
    var key = panelAppKey_();

    if (key === "word-master") {
      if (DAY2_PACK_ITEM_RE.test(itemId)) return false;
    } else if (key === "day2-words") {
      if (prog === "word-master" && !DAY2_PACK_ITEM_RE.test(itemId)) return false;
    } else if (key === "pronounce-whistle") {
      if (!WHISTLE_ITEM_RE.test(itemId)) return false;
    } else if (key === "pronounce") {
      if (WHISTLE_ITEM_RE.test(itemId)) return false;
    } else if (key === "mrj-decodable-try-41") {
      if (!DECODABLE_41_ITEM_RE.test(itemId)) return false;
    } else if (key === "mrj-decodable-try-71") {
      if (!DECODABLE_71_ITEM_RE.test(itemId)) return false;
    }

    var inc = bootItemInclude_();
    if (inc && !inc.test(itemId)) return false;
    var exc = bootItemExclude_();
    if (exc && exc.test(itemId)) return false;
    return true;
  }

  function programNameSet_() {
    var set = {};
    scoreProgramsForApp_().forEach(function (name) {
      set[String(name).trim().toLowerCase()] = true;
    });
    return set;
  }

  function rowProgramName_(row) {
    if (!row || typeof row !== "object") return "";
    return String(row.program || row.curriculum_program || "").trim();
  }

  function rowItemId_(row) {
    if (!row || typeof row !== "object") return "";
    return String(row.item_id || row.itemId || row.item || "").trim();
  }

  function normalizeProgressRow_(row) {
    row = row || {};
    var scoreVal = row.score_value != null ? row.score_value : row.scoreValue;
    var scoreMax = row.score_max != null ? row.score_max : row.scoreMax;
    var scorePct = row.score_pct != null ? row.score_pct : row.scorePct;
    if (scorePct == null && scoreVal != null && scoreMax != null && Number(scoreMax) > 0) {
      scorePct = Math.round((Number(scoreVal) / Number(scoreMax)) * 100);
    }
    var scoreText = "";
    if (scoreVal != null && scoreMax != null) {
      scoreText = String(scoreVal) + "/" + String(scoreMax);
      if (scorePct != null) scoreText += " (" + String(scorePct) + "%)";
    } else if (scorePct != null) {
      scoreText = String(scorePct) + "%";
    } else if (row.score != null) {
      scoreText = String(row.score);
    }
    return {
      program: rowProgramName_(row),
      item_id: rowItemId_(row),
      score_value: scoreVal,
      score_max: scoreMax,
      score_pct: scorePct,
      local_date: row.local_date || row.localDate || row.date || "",
      updated_at: row.updated_at || row.updatedAt || "",
      label: row.label != null ? String(row.label) : "",
      scoreText: scoreText
    };
  }

  function rowMatchesAppPrograms_(row, programSet) {
    var p = rowProgramName_(row).toLowerCase();
    return !!(p && programSet[p]);
  }

  function itemIdSortKey_(itemId) {
    var id = String(itemId || "");
    var m = id.match(/^(g(\d+):)?(u(\d+)|unit(\d+))?(.*)$/i);
    if (!m) return { book: 0, unit: 0, rest: id.toLowerCase() };
    var book = m[2] ? parseInt(m[2], 10) : 1;
    var unit = 0;
    if (m[4]) unit = parseInt(m[4], 10);
    else if (m[5]) unit = parseInt(m[5], 10);
    return { book: book, unit: unit, rest: (m[6] || id).toLowerCase() };
  }

  function compareItemIds_(a, b) {
    var ka = itemIdSortKey_(a);
    var kb = itemIdSortKey_(b);
    if (ka.book !== kb.book) return ka.book - kb.book;
    if (ka.unit !== kb.unit) return ka.unit - kb.unit;
    if (ka.rest < kb.rest) return -1;
    if (ka.rest > kb.rest) return 1;
    return 0;
  }

  function sortPanelRows_(rows) {
    rows = rows.slice();
    rows.sort(function (a, b) {
      var cmp = compareItemIds_(a.item_id, b.item_id);
      if (cmp !== 0) return cmp;
      var da = String(a.local_date || a.updated_at || "");
      var db = String(b.local_date || b.updated_at || "");
      if (da < db) return -1;
      if (da > db) return 1;
      return 0;
    });
    return rows;
  }

  function averagePct_(rows) {
    var sum = 0;
    var n = 0;
    rows.forEach(function (row) {
      if (row.score_pct == null || row.score_pct === "") return;
      var v = Number(row.score_pct);
      if (!isNaN(v)) {
        sum += v;
        n += 1;
      }
    });
    if (!n) return null;
    return Math.round(sum / n);
  }

  function itemLabel_(itemId, row) {
    if (row && row.label != null && String(row.label).trim()) {
      return String(row.label).trim();
    }
    try {
      var labels = global.MRJ_ITEM_LABELS;
      if (labels && typeof labels === "object" && labels[itemId] != null) {
        return String(labels[itemId]);
      }
    } catch (ignore) {}
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
      updateStudentChip_();
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
    sessionGen += 1;
    loadPlaceSeq += 1;
    busy = false;
    activeLoginFlight = null;
    state = { id: "", token: "", progress: [], progressError: "" };
    packState = {};
    clearSession_();
    closeProgressPanel();
    disconnectChipObserver_();
    updateStudentChip_();
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
      loadPlaceSeq += 1;
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

  function fetchAllProgress_(id, tokenValue, program, hook, fetchOpts) {
    fetchOpts = fetchOpts || {};
    var maxPages = fetchOpts.panel ? PROGRESS_PANEL_MAX_PAGES : PROGRESS_MAX_PAGES;
    var all = [];
    var offset = 0;
    var nextId = id;
    var nextToken = tokenValue;
    var pages = 0;
    var hitCap = false;
    function pullPage() {
      if (fetchOpts.cancelCheck && fetchOpts.cancelCheck()) {
        return Promise.resolve({ ok: false, error: "cancelled" });
      }
      pages += 1;
      return post_(progressBody_(id, tokenValue, program, offset), hook).then(function (data) {
        if (fetchOpts.cancelCheck && fetchOpts.cancelCheck()) {
          return { ok: false, error: "cancelled" };
        }
        if (!data || !data.ok) {
          return {
            ok: false,
            error: data && data.error ? data.error : "progress_load_failed",
            message: data && data.message ? data.message : "",
            id: data && data.id ? data.id : nextId,
            token: data && data.token ? data.token : nextToken
          };
        }
        if (!fetchOpts.panel) {
          if (data.id) nextId = data.id;
          if (data.token) nextToken = data.token;
        }
        var chunk = Array.isArray(data.progress) ? data.progress : [];
        all = all.concat(chunk);
        var hasMore = data.hasMore === true;
        if (!hasMore && data.hasMore !== false && chunk.length >= PROGRESS_PAGE_SIZE) {
          hasMore = true;
        }
        if (typeof data.total === "number" && all.length >= data.total) hasMore = false;
        if (pages >= maxPages) {
          if (hasMore) hitCap = true;
          hasMore = false;
        }
        if (hasMore && chunk.length > 0) {
          offset += chunk.length;
          return pullPage();
        }
        return {
          ok: true,
          id: nextId,
          token: nextToken,
          progress: all,
          capped: hitCap
        };
      });
    }
    return pullPage();
  }

  function filterProgressForApp_(rows) {
    var programSet = programNameSet_();
    var out = [];
    (rows || []).forEach(function (row) {
      if (!rowMatchesAppPrograms_(row, programSet)) return;
      if (!rowPassesItemFilter_(row)) return;
      out.push(row);
    });
    return out;
  }

  function providerRowToRaw_(row) {
    row = row || {};
    return {
      program: row.program || "",
      item_id: row.item_id || row.itemId || row.item || "",
      itemId: row.item_id || row.itemId || row.item || "",
      score_value: row.score_value != null ? row.score_value : row.scoreValue,
      score_max: row.score_max != null ? row.score_max : row.scoreMax,
      score_pct: row.score_pct != null ? row.score_pct : row.scorePct,
      local_date: row.local_date || row.localDate || row.date || "",
      label: row.label != null ? String(row.label) : ""
    };
  }

  function rowUpdatedMs_(row) {
    var t = row.updated_at || row.updatedAt || row.local_date || row.localDate || "";
    var ms = Date.parse(String(t));
    return isNaN(ms) ? 0 : ms;
  }

  function primaryScoreProgram_() {
    var programs = scoreProgramsForApp_();
    if (programs.length) return String(programs[0]).trim().toLowerCase();
    return appKey_();
  }

  function collapseServerRowsByItemId_(rows) {
    var primary = primaryScoreProgram_();
    var groups = {};
    (rows || []).forEach(function (row) {
      var id = rowItemId_(row);
      if (!id) return;
      if (!groups[id]) groups[id] = [];
      groups[id].push(row);
    });
    var out = [];
    for (var id in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, id)) continue;
      var pool = groups[id];
      var primaryRows = pool.filter(function (row) {
        return rowProgramName_(row).toLowerCase() === primary;
      });
      var pickFrom = primaryRows.length ? primaryRows : pool;
      pickFrom.sort(function (a, b) {
        return rowUpdatedMs_(b) - rowUpdatedMs_(a);
      });
      out.push(pickFrom[0]);
    }
    return out;
  }

  function mergeProviderRows_(serverRows, providerRows) {
    serverRows = collapseServerRowsByItemId_(serverRows || []);
    var map = {};
    serverRows.forEach(function (row) {
      var id = rowItemId_(row);
      if (!id) return;
      map[id] = row;
    });
    (providerRows || []).forEach(function (row) {
      var raw = providerRowToRaw_(row);
      var id = rowItemId_(raw);
      if (!id) return;
      map[id] = raw;
    });
    var out = [];
    for (var k in map) {
      if (Object.prototype.hasOwnProperty.call(map, k)) out.push(map[k]);
    }
    return out;
  }

  function invokePanelRowsProvider_(studentId) {
    if (!panelRowsProvider) return Promise.resolve([]);
    try {
      var out = panelRowsProvider(studentId);
      if (out && typeof out.then === "function") return out.then(function (rows) {
        return Array.isArray(rows) ? rows : [];
      });
      return Promise.resolve(Array.isArray(out) ? out : []);
    } catch (ignore) {
      return Promise.resolve([]);
    }
  }

  function setPanelRowsProvider(fn) {
    try {
      panelRowsProvider = typeof fn === "function" ? fn : null;
    } catch (ignore) {
      panelRowsProvider = null;
    }
  }

  function fetchPanelProgress_(snap, fetchOpts) {
    fetchOpts = fetchOpts || {};
    var programs = scoreProgramsForApp_();
    var capped = false;

    function runPrograms(list, index, acc) {
      if (fetchOpts.cancelCheck && fetchOpts.cancelCheck()) {
        return Promise.resolve({ ok: false, error: "cancelled" });
      }
      if (index >= list.length) {
        return Promise.resolve({ ok: true, progress: acc, capped: capped });
      }
      var prog = list[index];
      return fetchAllProgress_(snap.id, snap.token, prog, null, {
        panel: true,
        cancelCheck: fetchOpts.cancelCheck
      }).then(function (result) {
        if (fetchOpts.cancelCheck && fetchOpts.cancelCheck()) {
          return { ok: false, error: "cancelled" };
        }
        if (!result || !result.ok) return result;
        if (result.capped) capped = true;
        return runPrograms(list, index + 1, acc.concat(result.progress || []));
      });
    }

    var chain;
    if (programs.length) {
      chain = runPrograms(programs, 0, []);
    } else {
      chain = fetchAllProgress_(snap.id, snap.token, "", null, {
        panel: true,
        cancelCheck: fetchOpts.cancelCheck
      });
    }

    return chain.then(function (result) {
      if (!result || !result.ok) return result;
      var filtered = filterProgressForApp_(result.progress || []);
      return invokePanelRowsProvider_(snap.id).then(function (providerRows) {
        if (fetchOpts.cancelCheck && fetchOpts.cancelCheck()) {
          return { ok: false, error: "cancelled" };
        }
        return {
          ok: true,
          progress: mergeProviderRows_(filtered, providerRows),
          capped: !!(result.capped || capped)
        };
      });
    });
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
    var seq = ++loadPlaceSeq;
    var loadGen = sessionGen;
    var loadId = id == null ? "" : String(id);
    var loadToken = tokenValue == null ? "" : String(tokenValue);
    renderStatus_(MESSAGES.loading_place);
    fetchAllProgress_(loadId, loadToken, appProgram_()).then(function (result) {
      if (seq !== loadPlaceSeq) return;
      if (loadGen !== sessionGen) return;
      if (state.id && rules.idKey(state.id) !== rules.idKey(loadId)) return;
      if (result && result.ok) {
        finish_(result.id || loadId, result.token || loadToken, result.progress);
        return;
      }
      if (sessionRejected_(result)) {
        renderLogin_("Sign in again.", [loadId, ""]);
        return;
      }
      var err = (result && result.error) ? result.error : "progress_load_failed";
      finish_((result && result.id) || loadId, (result && result.token) || loadToken, [], err);
      retryProgressInBackground_(state.id, state.token);
    }).catch(function () {
      if (seq !== loadPlaceSeq) return;
      if (loadGen !== sessionGen) return;
      if (state.id && rules.idKey(state.id) !== rules.idKey(loadId)) return;
      finish_(loadId, loadToken, [], "network");
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

  function captureSession_() {
    return {
      gen: sessionGen,
      id: state.id,
      token: state.token
    };
  }

  function sessionMatches_(snap) {
    if (!snap) return false;
    if (snap.gen !== sessionGen) return false;
    if (!state.id || rules.idKey(state.id) !== rules.idKey(snap.id)) return false;
    if (String(state.token) !== String(snap.token)) return false;
    return true;
  }

  function finish_(id, tokenValue, progress, progressError) {
    sessionGen += 1;
    state.id = id == null ? "" : String(id);
    state.token = tokenValue == null ? "" : String(tokenValue);
    state.progress = Array.isArray(progress) ? progress : [];
    state.progressError = progressError ? String(progressError) : "";
    saveSession_();
    renderSignedIn_();
    updateStudentChip_();
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
    var snap = captureSession_();
    packState[program] = { loaded: false, json: "", error: "loading" };
    return post_({
      action: "load_pack",
      id: snap.id,
      token: snap.token,
      program: program
    }).then(function (data) {
      if (!sessionMatches_(snap)) {
        return { ok: false, error: "stale_session" };
      }
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
      if (!sessionMatches_(snap)) {
        return { ok: false, error: "stale_session" };
      }
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
    var snap = captureSession_();
    return post_({
      action: "save_pack",
      id: snap.id,
      token: snap.token,
      program: program,
      progress_json: progressJson == null ? "{}" : String(progressJson)
    }).then(function (data) {
      if (!sessionMatches_(snap)) {
        return { ok: false, error: "stale_session" };
      }
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
      if (!sessionMatches_(snap)) {
        return { ok: false, error: "stale_session" };
      }
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
    var snap = captureSession_();
    return fetchAllProgress_(snap.id, snap.token, program).then(function (result) {
      if (!sessionMatches_(snap)) {
        return { ok: false, error: "stale_session", progress: [] };
      }
      return result;
    });
  }

  function idKey(id) {
    return String(id == null ? "" : id).trim().toLowerCase();
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

  function disconnectChipObserver_() {
    try {
      if (chipMutationObserver && chipMutationObserver.disconnect) {
        chipMutationObserver.disconnect();
      }
    } catch (ignore) {}
    chipMutationObserver = null;
    if (chipLayoutTrailingTimer) {
      clearTimeout(chipLayoutTrailingTimer);
      chipLayoutTrailingTimer = null;
    }
    namePillRefreshTimer = null;
  }

  var namePillRefreshTimer = null;

  function refreshNamePillUi_() {
    if (!state.id || chipDisabled_()) return;
    var pill = findNamePill_();
    if (pill) {
      if (chipEl && !chipEl.hidden) chipEl.hidden = true;
      wireNamePill_(pill);
    }
  }

  function scheduleNamePillRefresh_() {
    if (namePillRefreshTimer) return;
    var raf = global.requestAnimationFrame || function (fn) { setTimeout(fn, 16); };
    namePillRefreshTimer = raf(function () {
      namePillRefreshTimer = null;
      refreshNamePillUi_();
      scheduleChipLayout_();
    });
  }

  function installChipObserver_() {
    if (!global.document || !global.document.body || chipMutationObserver) return;
    if (typeof MutationObserver !== "function") return;
    chipMutationObserver = new MutationObserver(function () {
      scheduleNamePillRefresh_();
    });
    try {
      chipMutationObserver.observe(global.document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden"]
      });
    } catch (ignore) {}
  }

  function scheduleChipLayout_() {
    if (!chipEl || chipEl.hidden) return;
    var now = Date.now();
    var since = now - chipLayoutLastRun;
    if (since >= 500) {
      if (chipLayoutTrailingTimer) {
        clearTimeout(chipLayoutTrailingTimer);
        chipLayoutTrailingTimer = null;
      }
      var raf = global.requestAnimationFrame || function (fn) { setTimeout(fn, 16); };
      raf(function () {
        chipLayoutLastRun = Date.now();
        adjustChipPosition_();
      });
      return;
    }
    if (chipLayoutTrailingTimer) return;
    chipLayoutTrailingTimer = setTimeout(function () {
      chipLayoutTrailingTimer = null;
      chipLayoutLastRun = Date.now();
      adjustChipPosition_();
    }, 500 - since);
  }

  function chipOffsetStyles_() {
    var top = readBootAttr_("data-mrj-chip-top") || (options && options.chipTop) || "";
    var right = readBootAttr_("data-mrj-chip-right") || (options && options.chipRight) || "";
    return { top: top, right: right };
  }

  function rectsOverlap_(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function isChipObstacle_(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node === chipEl || node === panelRootEl) return false;
    if (node.closest && node.closest("#mrj-auth-student-chip, .mrj-auth-panel-root, #mrj-auth-gate, .mrj-auth")) {
      return false;
    }
    try {
      var style = global.getComputedStyle ? global.getComputedStyle(node) : null;
      if (style) {
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      }
      if (node.hidden) return false;
      var r = node.getBoundingClientRect();
      if (!r || r.width < 2 || r.height < 2) return false;
      if (r.bottom < 0 || r.top > (global.innerHeight || 800)) return false;
    } catch (ignore) {
      return false;
    }
    var tag = (node.tagName || "").toLowerCase();
    if (tag === "button" || tag === "a" || tag === "select" || tag === "input" || tag === "textarea") {
      return true;
    }
    if (node.getAttribute && node.getAttribute("role") === "button") return true;
    if (node.getAttribute && node.getAttribute("onclick")) return true;
    if (node.classList) {
      if (node.classList.contains("pill")) return true;
      var cls = node.className && String(node.className);
      if (cls && (cls.indexOf("pill") !== -1 || cls.indexOf("badge") !== -1)) return true;
    }
    return false;
  }

  function collectChipObstacles_() {
    var out = [];
    if (!global.document || !global.document.querySelectorAll) return out;
    var nodes = global.document.querySelectorAll(
      "button, a, select, input, textarea, [role='button'], [onclick], .pill, [class*='pill'], [class*='badge']"
    );
    for (var i = 0; i < nodes.length; i++) {
      if (isChipObstacle_(nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  function adjustChipPosition_() {
    if (!chipEl || chipEl.hidden || !global.document) return;
    try {
      var vw = global.innerWidth || 800;
      var compact = vw < 480;
      chipEl.classList.toggle("mrj-auth-chip-compact", compact);
      var offsets = chipOffsetStyles_();
      var baseTop = offsets.top
        ? offsets.top
        : "calc(0.55rem + env(safe-area-inset-top, 0px))";
      var baseRight = offsets.right
        ? offsets.right
        : "calc(0.55rem + env(safe-area-inset-right, 0px))";
      chipEl.style.top = baseTop;
      chipEl.style.right = baseRight;
      chipEl.style.marginRight = "";
      chipEl.style.marginTop = "";
      var displayId = state.id || "";
      if (compact && displayId.length > 10) {
        chipEl.textContent = displayId.slice(0, 8) + "…";
        chipEl.title = displayId;
      } else {
        chipEl.textContent = displayId;
        chipEl.title = "";
      }
      var obstacles = collectChipObstacles_();
      var maxIter = 24;
      var extraTop = 0;
      while (maxIter-- > 0) {
        var chipRect = chipEl.getBoundingClientRect();
        if (!chipRect || !chipRect.width) break;
        var bump = 0;
        for (var j = 0; j < obstacles.length; j++) {
          var or = obstacles[j].getBoundingClientRect();
          if (!or || !or.width) continue;
          if (or.top > chipRect.bottom + 40) continue;
          if (rectsOverlap_(chipRect, or)) {
            var need = or.bottom - chipRect.top + 6;
            if (need > bump) bump = need;
          }
        }
        if (bump <= 0) break;
        extraTop += bump;
        chipEl.style.marginTop = extraTop + "px";
      }
    } catch (ignore) {}
  }

  function isElementVisible_(node) {
    if (!node || node.nodeType !== 1) return false;
    try {
      if (node.hidden) return false;
      var style = global.getComputedStyle ? global.getComputedStyle(node) : null;
      if (style) {
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          return false;
        }
      }
      var r = node.getBoundingClientRect();
      return !!(r && r.width > 1 && r.height > 1);
    } catch (ignore) {
      return false;
    }
  }

  function findNamePill_() {
    if (!global.document) return null;
    var pill = null;
    if (global.document.querySelector) {
      pill = global.document.querySelector(".student-pill, [data-mrj-name-pill]");
    }
    if ((!pill || !isElementVisible_(pill)) && global.document.querySelectorAll) {
      var nodes = global.document.querySelectorAll(".student-pill, [data-mrj-name-pill]");
      for (var i = 0; i < nodes.length; i++) {
        if (isElementVisible_(nodes[i])) {
          pill = nodes[i];
          break;
        }
      }
    }
    if ((!pill || !isElementVisible_(pill)) && global.document.body && global.document.body.children) {
      var kids = global.document.body.children;
      for (var j = 0; j < kids.length; j++) {
        var node = kids[j];
        if (!node || node.nodeType !== 1) continue;
        var isPill = false;
        if (node.classList && node.classList.contains("student-pill")) isPill = true;
        if (node.getAttribute && node.getAttribute("data-mrj-name-pill")) isPill = true;
        if (node.className && String(node.className).indexOf("student-pill") !== -1) isPill = true;
        if (isPill && isElementVisible_(node)) {
          pill = node;
          break;
        }
      }
    }
    if (!pill || !isElementVisible_(pill)) return null;
    return pill;
  }

  function wireNamePill_(pill) {
    if (!pill || pill.getAttribute("data-mrj-pill-wired") === "1") return;
    pill.setAttribute("data-mrj-pill-wired", "1");
    pill.setAttribute("role", "button");
    pill.setAttribute("tabindex", "0");
    try {
      pill.style.cursor = "pointer";
    } catch (ignore) {}
    pill.setAttribute("aria-label", "My scores for " + (state.id || ""));
    pill.addEventListener("click", function () {
      try {
        openProgressPanel();
      } catch (ignore) {}
    });
    pill.addEventListener("keydown", function (ev) {
      if (!ev) return;
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        try {
          openProgressPanel();
        } catch (ignore) {}
      }
    });
  }

  function ensureChipDom_() {
    if (!global.document || !global.document.body) return;
    if (!chipEl) {
      chipEl = el_("button", "mrj-auth-chip");
      chipEl.type = "button";
      chipEl.id = "mrj-auth-student-chip";
      chipEl.setAttribute("aria-haspopup", "dialog");
      chipEl.addEventListener("click", function () {
        try {
          openProgressPanel();
        } catch (ignore) {}
      });
      global.document.body.appendChild(chipEl);
      if (global.addEventListener) {
        global.addEventListener("resize", function () { scheduleChipLayout_(); });
        global.addEventListener("orientationchange", function () { scheduleChipLayout_(); });
      }
    }
    if (!panelRootEl) {
      panelRootEl = el_("div", "mrj-auth-panel-root");
      panelRootEl.id = "mrj-auth-progress-panel-root";
      panelRootEl.hidden = true;
      panelRootEl.setAttribute("aria-hidden", "true");
      global.document.body.appendChild(panelRootEl);
    }
  }

  function updateStudentChip_() {
    try {
      if (!global.document || !global.document.body) return;
      ensureChipDom_();
      if (!state.id) {
        if (chipEl) chipEl.hidden = true;
        return;
      }
      installChipObserver_();
      if (!chipDisabled_()) {
        var pill = findNamePill_();
        if (pill) {
          if (chipEl && !chipEl.hidden) chipEl.hidden = true;
          wireNamePill_(pill);
          return;
        }
      }
      if (chipDisabled_()) {
        if (chipEl) chipEl.hidden = true;
        return;
      }
      chipEl.hidden = false;
      chipEl.setAttribute("aria-label", "My scores for " + state.id);
      installChipObserver_();
      adjustChipPosition_();
    } catch (ignore) {}
  }

  function panelShell_(titleText) {
    clear_(panelRootEl);
    var backdrop = el_("button", "mrj-auth-panel-backdrop");
    backdrop.type = "button";
    backdrop.setAttribute("aria-label", "Close scores");
    backdrop.addEventListener("click", function () {
      closeProgressPanel();
    });
    var dialog = el_("div", "mrj-auth-panel");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", titleText || "My scores");
    var header = el_("div", "mrj-auth-panel-header");
    var title = el_("h2", "mrj-auth-panel-title");
    title.textContent = titleText || "My scores";
    var closeBtn = button_("×", "mrj-auth-panel-close");
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", function () {
      closeProgressPanel();
    });
    header.appendChild(title);
    header.appendChild(closeBtn);
    var body = el_("div", "mrj-auth-panel-body");
    dialog.appendChild(header);
    dialog.appendChild(body);
    panelRootEl.appendChild(backdrop);
    panelRootEl.appendChild(dialog);
    return { body: body, dialog: dialog };
  }

  function renderPanelLoading_(body) {
    clear_(body);
    var wait = el_("div", "mrj-auth-wait");
    wait.setAttribute("aria-busy", "true");
    var status = el_("p", "mrj-auth-status");
    status.textContent = "Loading your scores…";
    wait.appendChild(status);
    wait.appendChild(waitBar_());
    body.appendChild(wait);
  }

  function renderPanelError_(body, message, onRetry) {
    clear_(body);
    var err = el_("p", "mrj-auth-error");
    err.textContent = message || "Could not load scores.";
    body.appendChild(err);
    var retry = button_("Retry", "mrj-auth-submit");
    retry.addEventListener("click", function () {
      if (typeof onRetry === "function") onRetry();
    });
    body.appendChild(retry);
  }

  function renderPanelRows_(body, rows, meta) {
    meta = meta || {};
    clear_(body);
    var normalized = sortPanelRows_(rows.map(normalizeProgressRow_));
    var avg = averagePct_(normalized);
    var summary = el_("p", "mrj-auth-panel-summary");
    summary.textContent =
      normalized.length +
      " score" +
      (normalized.length === 1 ? "" : "s") +
      (avg != null ? " · average " + avg + "%" : "");
    body.appendChild(summary);
    if (meta.capped) {
      var cap = el_("p", "mrj-auth-panel-cap");
      cap.textContent = "Showing the most recent scores we could load. Ask your teacher if something is missing.";
      body.appendChild(cap);
    }
    if (!normalized.length) {
      var empty = el_("p", "mrj-auth-empty");
      empty.textContent = "No scores yet.";
      body.appendChild(empty);
      return;
    }
    var list = el_("ul", "mrj-auth-panel-list");
    normalized.forEach(function (row) {
      var item = el_("li", "mrj-auth-panel-row");
      var label = itemLabel_(row.item_id, row);
      if (label) {
        var main = el_("span", "mrj-auth-prog-main");
        main.textContent = label;
        var sub = el_("span", "mrj-auth-panel-item-id");
        sub.textContent = row.item_id;
        item.appendChild(main);
        item.appendChild(sub);
      } else {
        var mainOnly = el_("span", "mrj-auth-prog-main");
        mainOnly.textContent = row.item_id || "—";
        item.appendChild(mainOnly);
      }
      var scoreLine = el_("span", "mrj-auth-panel-score");
      scoreLine.textContent = [row.scoreText, row.local_date].filter(Boolean).join(" · ");
      item.appendChild(scoreLine);
      list.appendChild(item);
    });
    body.appendChild(list);
    var foot = el_("div", "mrj-auth-panel-foot");
    var signOutBtn = button_("Sign out", "mrj-auth-signout");
    signOutBtn.addEventListener("click", function () {
      closeProgressPanel();
      signOut();
    });
    foot.appendChild(signOutBtn);
    body.appendChild(foot);
  }

  function loadPanelProgress_(fetchGen, snap) {
    if (!panelRootEl || panelRootEl.hidden) return;
    var body = panelBodyEl;
    if (!body && panelRootEl.querySelector) {
      body = panelRootEl.querySelector(".mrj-auth-panel-body");
    }
    if (!body) return;
    renderPanelLoading_(body);
    function cancelled() {
      return !panelOpen || fetchGen !== panelFetchGen || !sessionMatches_(snap);
    }
    fetchPanelProgress_(snap, { cancelCheck: cancelled }).then(function (result) {
      if (cancelled()) return;
      if (!result || !result.ok) {
        if (result && result.error === "cancelled") return;
        renderPanelError_(body, (result && result.message) || "Could not load scores.", function () {
          if (!state.id || !state.token) return;
          loadPanelProgress_(fetchGen, captureSession_());
        });
        return;
      }
      renderPanelRows_(body, result.progress || [], { capped: result.capped });
    }).catch(function () {
      if (cancelled()) return;
      renderPanelError_(body, "Could not load scores.", function () {
        if (!state.id || !state.token) return;
        loadPanelProgress_(fetchGen, captureSession_());
      });
    });
  }

  function openProgressPanel() {
    try {
      if (!state.id || !state.token) return;
      if (panelOpen && panelRootEl && !panelRootEl.hidden) return;
      ensureChipDom_();
      panelOpen = true;
      panelFetchGen += 1;
      var fetchGen = panelFetchGen;
      var snap = captureSession_();
      panelRootEl.hidden = false;
      panelRootEl.setAttribute("aria-hidden", "false");
      var shell = panelShell_("My scores");
      panelBodyEl = shell.body;
      renderPanelLoading_(shell.body);
      if (panelKeyHandler && global.removeEventListener) {
        global.removeEventListener("keydown", panelKeyHandler);
      }
      panelKeyHandler = function (ev) {
        if (!panelOpen) return;
        if (ev && (ev.key === "Escape" || ev.key === "Esc")) closeProgressPanel();
      };
      if (global.addEventListener) global.addEventListener("keydown", panelKeyHandler);
      loadPanelProgress_(fetchGen, snap);
      if (shell.dialog && shell.dialog.focus) shell.dialog.focus();
    } catch (ignore) {}
  }

  function closeProgressPanel() {
    try {
      panelOpen = false;
      panelFetchGen += 1;
      if (panelKeyHandler && global.removeEventListener) {
        global.removeEventListener("keydown", panelKeyHandler);
        panelKeyHandler = null;
      }
      if (panelRootEl) {
        panelRootEl.hidden = true;
        panelRootEl.setAttribute("aria-hidden", "true");
        clear_(panelRootEl);
      }
      panelBodyEl = null;
    } catch (ignore) {}
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
    progressError: progressError,
    idKey: idKey,
    openProgressPanel: openProgressPanel,
    closeProgressPanel: closeProgressPanel,
    setPanelRowsProvider: setPanelRowsProvider
  };

  if (global.MRJ_AUTH_TEST_MODE) {
    api._test = {
      post: post_,
      postOnce: postOnce_,
      send: send_,
      sessionRejected: sessionRejected_,
      fetchAllProgress: fetchAllProgress_,
      fetchPanelProgress: fetchPanelProgress_,
      retryProgressInBackground: retryProgressInBackground_,
      progressBody: progressBody_,
      scoreProgramsForApp: scoreProgramsForApp_,
      filterProgressForApp: filterProgressForApp_,
      rowPassesItemFilter: rowPassesItemFilter_,
      panelAppKey: panelAppKey_,
      chipDisabled: chipDisabled_,
      updateStudentChip: updateStudentChip_,
      adjustChipPosition: adjustChipPosition_,
      mergeProviderRows: mergeProviderRows_,
      collapseServerRowsByItemId: collapseServerRowsByItemId_,
      loadPlace: loadPlace_,
      scheduleChipLayout: scheduleChipLayout_,
      setChipLayoutLastRun: function (t) {
        chipLayoutLastRun = t;
      },
      chipTrailingPending: function () {
        return !!chipLayoutTrailingTimer;
      },
      findNamePill: findNamePill_,
      REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
      AUTH_VERSION: AUTH_VERSION,
      APP_SCORE_PROGRAM_MAP: APP_SCORE_PROGRAM_MAP,
      DAY2_PACK_ITEM_RE: DAY2_PACK_ITEM_RE
    };
  }

  global.MRJ_AUTH = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
