/**
 * The only way a student web app starts the shared door.
 * Load mrj-auth.js before this file. This file does not sign anyone in.
 * data-mrj-app on this script tag names the app. Missing or blank falls back to "mrj".
 */
(function () {
  "use strict";

  var APP = readApp_();
  var OLD_SELECTOR = "#signin-card, #screen-name, .signin-screen, #btn-signin-skip, #signin-local";

  function readApp_() {
    var script = document.currentScript;
    if (!script || !script.getAttribute) return "mrj";
    var value = script.getAttribute("data-mrj-app");
    if (value == null) return "mrj";
    value = String(value).trim();
    return value ? value : "mrj";
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

  function onReady(info) {
    document.documentElement.classList.remove("mrj-auth-locked");
    gate.hidden = true;
    window.MRJ_STUDENT = window.MRJ_AUTH.student();
    info = info || {};
    document.dispatchEvent(new CustomEvent("mrj-auth-ready", {
      bubbles: true,
      detail: {
        id: info.id != null ? info.id : window.MRJ_STUDENT,
        progress: info.progress != null ? info.progress : []
      }
    }));
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
    window.MRJ_AUTH.mount(gate, { app: APP, onReady: onReady });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
