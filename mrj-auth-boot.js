/**
 * The only way a student web app starts the shared door.
 * Load mrj-auth.js before this file. This file does not sign anyone in.
 * data-mrj-app on this script tag names the app. Missing or blank falls back to "mrj".
 * data-mrj-score-programs="a,b" overrides score program names for the My scores panel.
 * data-mrj-chip="off" hides the fixed name chip (app shows its own control and may call MRJ_AUTH.openProgressPanel()).
 */
(function () {
  "use strict";

  var BOOT_VERSION = "20261007-progress-1.4.2";
  var APP = readApp_();
  var SCORE_PROGRAMS = readScorePrograms_();
  var OLD_SELECTOR = "#signin-card, #screen-name, .signin-screen, #btn-signin-skip, #signin-local";

  function readApp_() {
    var script = document.currentScript;
    if (!script || !script.getAttribute) return "mrj";
    var value = script.getAttribute("data-mrj-app");
    if (value == null) return "mrj";
    value = String(value).trim();
    return value ? value : "mrj";
  }

  function readScorePrograms_() {
    var script = document.currentScript;
    if (!script || !script.getAttribute) return "";
    return String(script.getAttribute("data-mrj-score-programs") || "").trim();
  }

  function readChipOff_() {
    try {
      var script = document.currentScript;
      if (script && String(script.getAttribute("data-mrj-chip") || "").trim().toLowerCase() === "off") {
        return true;
      }
      if (String(document.documentElement.getAttribute("data-mrj-chip") || "").trim().toLowerCase() === "off") {
        return true;
      }
      if (document.body && String(document.body.getAttribute("data-mrj-chip") || "").trim().toLowerCase() === "off") {
        return true;
      }
    } catch (ignore) {}
    return false;
  }

  function stripOldDoors(root) {
    if (!root) return;
    if (root.nodeType === 1 && root.matches && root.matches(OLD_SELECTOR)) {
      if (root.parentNode) root.parentNode.removeChild(root);
      return;
    }
    if (!root.querySelectorAll) return;
    var found = root.querySelectorAll(OLD_SELECTOR);
    for (var i = found.length - 1; i >= 0; i--) {
      var node = found[i];
      if (node.parentNode) node.parentNode.removeChild(node);
    }
  }

  function watchOldDoors() {
    stripOldDoors(document);
    if (!document.body || typeof MutationObserver !== "function") return;
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          stripOldDoors(added[j]);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function isNameCard(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.id === "mrj-auth-gate" || (node.closest && node.closest("#mrj-auth-gate, .mrj-auth"))) return false;
    var text = node.textContent || "";
    if (text.indexOf("What's your name") !== -1 || text.indexOf("What's your name") !== -1) return true;
    return !!(node.querySelector && node.querySelector("#lf-input"));
  }

  function lockBuiltNameCards(id) {
    if (!id || !document.querySelectorAll) return;
    var nodes = document.querySelectorAll(".name-card, form");
    for (var i = 0; i < nodes.length; i++) {
      var card = nodes[i];
      if (!isNameCard(card)) continue;
      var input = card.querySelector("input[type='text'], input:not([type])");
      if (input) {
        input.value = id;
        input.readOnly = true;
      }
      var button = card.querySelector("button.go, button[type='submit']");
      if (button) button.click();
      card.hidden = true;
    }
  }

  function onReady(info) {
    document.documentElement.classList.remove("mrj-auth-locked");
    gate.hidden = true;
    window.MRJ_STUDENT = window.MRJ_AUTH.student();
    info = info || {};
    var id = info.id != null ? info.id : window.MRJ_STUDENT;
    lockBuiltNameCards(id);
    document.dispatchEvent(new CustomEvent("mrj-auth-ready", {
      bubbles: true,
      detail: {
        id: id,
        progress: info.progress != null ? info.progress : [],
        progressError: info.progressError != null ? info.progressError : ""
      }
    }));
    setTimeout(function () { lockBuiltNameCards(id); }, 400);
    setTimeout(function () {
      try {
        if (window.MRJ_AUTH && typeof window.MRJ_AUTH.openProgressPanel !== "function") return;
        if (window.MRJ_AUTH.student && window.MRJ_AUTH.student()) {
          var chip = document.getElementById("mrj-auth-student-chip");
          if (chip && !chip.hidden) chip.focus = chip.focus || function () {};
        }
      } catch (ignore) {}
    }, 500);
  }

  var gate = null;

  function start() {
    if (!document.body) return;
    watchOldDoors();
    gate = document.getElementById("mrj-auth-gate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "mrj-auth-gate";
      document.body.appendChild(gate);
    }
    document.documentElement.classList.add("mrj-auth-locked");
    if (!window.MRJ_AUTH || typeof window.MRJ_AUTH.mount !== "function") {
      gate.textContent = "Sign-in book did not load.";
      return;
    }
    window.MRJ_AUTH.mount(gate, {
      app: APP,
      scorePrograms: SCORE_PROGRAMS,
      chipOff: readChipOff_(),
      onReady: onReady
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.MRJ_AUTH_BOOT_VERSION = BOOT_VERSION;
})();
