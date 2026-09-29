/**
 * Browser sign-in for every MRJ student app.
 * Load mrj-auth.css beside this file. GitHub Pages can host both.
 * POST stays text/plain so the Apps Script web app does not need a CORS preflight.
 * The endpoint stays a placeholder until the script is deployed by hand.
 */
(function (global) {
  "use strict";

  var ENDPOINT = "https://script.google.com/macros/s/AKfycbwtJTUO3gbcMrlAwsn1feWxyp7Rw2cxpfe1bOT9v2rxmQHa2Tlc6pFNWAjU6ZAdlD6kFQ/exec";
  var SESSION_KEY = "mrj.auth.session";

  var MESSAGES = {
    blank: "Type an ID and a password.",
    mismatch: "Those passwords do not match.",
    user_does_not_exist: "User does not exist.",
    wrong_password: "Wrong password.",
    id_taken: "That ID is already used. Log in instead."
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
  var state = { id: "", token: "", progress: [] };
  var viewGen = 0;
  var busy = false;

  function mount(el, opts) {
    var node = resolveEl_(el);
    if (!node) return;
    rootEl = node;
    options = opts || {};
    rootEl.classList.add("mrj-auth");
    viewGen += 1;
    busy = false;
    state = { id: "", token: "", progress: [] };
    var saved = readSession_();
    if (!saved) {
      renderDoors_();
      return;
    }
    var gen = viewGen;
    renderStatus_("Checking your ID…");
    post_({ action: "progress", id: saved.id, token: saved.token }).then(function (data) {
      if (gen !== viewGen) return;
      if (data && data.ok) {
        finish_(data.id || saved.id, data.token || saved.token, data.progress);
        return;
      }
      if (sessionRejected_(data)) {
        clearSession_();
        renderDoors_();
        return;
      }
      renderDoors_("Could not check the sign-in book. Try again.");
    }).catch(function () {
      if (gen !== viewGen) return;
      renderDoors_("Could not check the sign-in book. Try again.");
    });
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
    state = { id: "", token: "", progress: [] };
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

  function renderStatus_(text) {
    if (!rootEl) return;
    clear_(rootEl);
    var status = el_("p", "mrj-auth-status");
    status.textContent = text;
    rootEl.appendChild(status);
  }

  function send_(body, onOk, showError) {
    var gen = viewGen;
    busy = true;
    setBusy_(true);
    post_(body).then(function (data) {
      if (gen !== viewGen) return;
      busy = false;
      if (data && data.ok && data.token) {
        onOk(data);
        return;
      }
      showError(errorText_(data));
    }).catch(function () {
      if (gen !== viewGen) return;
      busy = false;
      showError("Could not reach the sign-in book. Try again.");
    });
  }

  function finish_(id, tokenValue, progress) {
    state.id = id == null ? "" : String(id);
    state.token = tokenValue == null ? "" : String(tokenValue);
    state.progress = Array.isArray(progress) ? progress : [];
    saveSession_();
    renderSignedIn_();
    if (typeof options.onReady === "function") {
      options.onReady({
        id: state.id,
        token: state.token,
        progress: state.progress
      });
    }
  }

  function post_(body) {
    return fetch(ENDPOINT, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text();
    }).then(function (text) {
      return JSON.parse(text);
    });
  }

  function errorText_(data) {
    if (data && data.message) return String(data.message);
    var code = data && data.error;
    if (code && rules.MESSAGES[code]) return rules.MESSAGES[code];
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

  global.MRJ_AUTH = {
    ENDPOINT: ENDPOINT,
    mount: mount,
    student: student,
    token: token,
    signOut: signOut,
    noteScore: noteScore
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
