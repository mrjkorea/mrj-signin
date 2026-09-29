/**
 * Pure ID and password rules for the shared MRJ sign-in.
 * No DOM. Node tests import this file. The browser client uses the same rules.
 *
 * Match key: trim, lowercase, collapse inner whitespace.
 * The display ID stays exactly as first typed.
 * Passwords are exact and case-sensitive. No length rule and no digits-only rule.
 */
(function (root) {
  "use strict";

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

  /**
   * account is the stored row { password } or null when nobody has that ID.
   * Login never treats a missing account as a new student.
   */
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

  /** existingAccount is truthy when this match key is already in the book. */
  function decideRegister(existingAccount) {
    if (existingAccount) {
      return { ok: false, error: "id_taken", message: MESSAGES.id_taken };
    }
    return { ok: true, error: "", message: "" };
  }

  var api = {
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

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MRJAuthRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
