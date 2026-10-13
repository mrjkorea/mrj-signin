/**
 * Client device fingerprint for sign-in metrics (no IP).
 */
(function (global) {
  "use strict";

  function detectOs(ua) {
    ua = String(ua || "");
    if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
    if (/Android/i.test(ua)) return "Android";
    if (/Windows/i.test(ua)) return "Windows";
    if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
    if (/CrOS/i.test(ua)) return "ChromeOS";
    if (/Linux/i.test(ua)) return "Linux";
    return "unknown";
  }

  function detectBrowser(ua) {
    ua = String(ua || "");
    if (/Edg\//i.test(ua)) return "Edge";
    if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "Chrome";
    if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
    if (/Firefox\//i.test(ua)) return "Firefox";
    return "unknown";
  }

  function detectType(ua, w) {
    ua = String(ua || "");
    if (/iPad|Tablet/i.test(ua)) return "tablet";
    if (/Mobi|iPhone|Android/i.test(ua)) return "phone";
    if (w && w < 768) return "phone";
    return "desktop";
  }

  function collectDevice() {
    var nav = global.navigator || {};
    var ua = nav.userAgent || "";
    var sw = 0;
    var sh = 0;
    try {
      if (global.screen) {
        sw = global.screen.width || 0;
        sh = global.screen.height || 0;
      }
    } catch (ignore) {}
    return {
      type: detectType(ua, sw),
      os: detectOs(ua),
      browser: detectBrowser(ua),
      screenW: sw,
      screenH: sh,
    };
  }

  global.MRJ_DEVICE = {
    collect: collectDevice,
    detectOs: detectOs,
    detectBrowser: detectBrowser,
    detectType: detectType,
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
