(function () {
  "use strict";

  var SESSION_KEY = "mrj.teacher.dashboard";
  var KNOWN_APPS = [
    "word-master",
    "greenzap",
    "skill-builder",
    "skill-builder-g1",
    "pronounce-whistle",
    "day2-words",
    "day3-workbook",
  ];

  var root = document.getElementById("td-root");
  var state = { id: "", token: "", teacherSecret: "", view: "class", student: "", app: "word-master" };

  function loadSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.id && parsed.token) {
        state.id = parsed.id;
        state.token = parsed.token;
        state.teacherSecret = parsed.teacherSecret || "";
      }
    } catch (ignore) {}
  }

  function saveSession() {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        id: state.id,
        token: state.token,
        teacherSecret: state.teacherSecret,
      })
    );
  }

  function clearSession() {
    state = { id: "", token: "", teacherSecret: "", view: "class", student: "", app: "word-master" };
    sessionStorage.removeItem(SESSION_KEY);
    renderLogin();
  }

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function post(action, extra) {
    var body = {
      action: action,
      id: state.id,
      token: state.token,
      teacher_secret: state.teacherSecret,
    };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k];
      }
    }
    return fetch(MRJ_AUTH.ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json();
      })
      .catch(function () {
        return { ok: false, message: "Network error." };
      });
  }

  function renderLogin(message) {
    root.innerHTML = "";
    var card = el("div", "td-card");
    if (message) {
      var err = el("p", "td-error");
      err.textContent = message;
      card.appendChild(err);
    }
    var idLabel = el("label", "td-label");
    idLabel.textContent = "Teacher ID";
    var idInput = el("input", "td-input");
    idInput.id = "td-id";
    idInput.autocomplete = "username";
    var pwLabel = el("label", "td-label");
    pwLabel.textContent = "Password";
    var pwInput = el("input", "td-input");
    pwInput.type = "password";
    pwInput.id = "td-pw";
    pwInput.autocomplete = "current-password";
    var secLabel = el("label", "td-label");
    secLabel.textContent = "Teacher secret (if your school uses one)";
    var secInput = el("input", "td-input");
    secInput.type = "password";
    secInput.id = "td-secret";
    secInput.autocomplete = "off";
    var btn = el("button", "td-btn");
    btn.type = "button";
    btn.textContent = "Sign in";
    btn.addEventListener("click", function () {
      var id = idInput.value.trim();
      var password = pwInput.value;
      var secret = secInput.value;
      fetch(MRJ_AUTH.ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "login", id: id, password: password, client_app: "teacher-dashboard" }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (!data || !data.ok || !data.token) {
            renderLogin((data && data.message) || "Could not sign in.");
            return;
          }
          state.id = data.id || id;
          state.token = data.token;
          state.teacherSecret = secret;
          saveSession();
          return post("teacher_list_students").then(function (listRes) {
            if (!listRes || !listRes.ok) {
              clearSession();
              renderLogin((listRes && listRes.message) || "Teacher access denied.");
              return;
            }
            renderClass(listRes.students || []);
          });
        })
        .catch(function () {
          renderLogin("Could not sign in.");
        });
    });
    card.appendChild(idLabel);
    card.appendChild(idInput);
    card.appendChild(pwLabel);
    card.appendChild(pwInput);
    card.appendChild(secLabel);
    card.appendChild(secInput);
    card.appendChild(btn);
    root.appendChild(card);
  }

  function renderClass(students) {
    root.innerHTML = "";
    var toolbar = el("div", "td-toolbar");
    var appBtn = el("button", "td-btn td-btn-secondary");
    appBtn.type = "button";
    appBtn.textContent = "Per-app view";
    appBtn.addEventListener("click", function () {
      renderAppRoster(state.app || "word-master");
    });
    var outBtn = el("button", "td-btn td-btn-secondary");
    outBtn.type = "button";
    outBtn.textContent = "Sign out";
    outBtn.addEventListener("click", clearSession);
    toolbar.appendChild(appBtn);
    toolbar.appendChild(outBtn);
    root.appendChild(toolbar);

    var card = el("div", "td-card");
    var title = el("h2", "td-section-title");
    title.textContent = "Students";
    card.appendChild(title);
    var list = el("ul", "td-student-list");
    students.forEach(function (s) {
      var li = el("li");
      var btn = el("button", "td-student-btn");
      btn.type = "button";
      btn.textContent = s.id;
      btn.addEventListener("click", function () {
        renderStudent(s.id);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
    card.appendChild(list);
    root.appendChild(card);
  }

  function renderStudent(studentId) {
    root.innerHTML = "";
    var toolbar = el("div", "td-toolbar");
    var back = el("button", "td-btn td-btn-secondary");
    back.type = "button";
    back.textContent = "Class list";
    back.addEventListener("click", function () {
      post("teacher_list_students").then(function (res) {
        renderClass((res && res.students) || []);
      });
    });
    toolbar.appendChild(back);
    root.appendChild(toolbar);

    var card = el("div", "td-card");
    var h = el("h2", "td-section-title");
    h.textContent = studentId;
    card.appendChild(h);
    var status = el("p", "td-meta");
    status.textContent = "Loading charts…";
    card.appendChild(status);
    root.appendChild(card);

    post("teacher_student_dashboard", { student: studentId }).then(function (res) {
      if (!res || !res.ok) {
        status.textContent = (res && res.message) || "Could not load student.";
        return;
      }
      status.textContent = "Across " + (res.apps || []).length + " apps with saved data";
      var apps = res.apps || [];
      if (apps.length) {
        var wrap = el("div", "td-chart-wrap");
        var canvas = document.createElement("canvas");
        wrap.appendChild(canvas);
        card.appendChild(wrap);
        MRJ_PROGRESS_CHARTS.renderClassCompletionChart(
          canvas,
          apps.map(function (a) {
            return {
              label: a.label || a.program,
              completionPct: a.completionPct == null ? 0 : a.completionPct,
            };
          })
        );
      }
      apps.forEach(function (app) {
        var block = el("div");
        var st = el("h3", "td-section-title");
        st.textContent = app.label || app.program;
        block.appendChild(st);
        var meta = el("p", "td-meta");
        meta.textContent =
          [
            app.completionPct != null ? "Completion " + app.completionPct + "%" : "",
            app.avgScorePct != null ? "Avg score " + app.avgScorePct + "%" : "",
            app.lastActive ? "Last active " + app.lastActive : "",
            app.weakCount ? "Weak items " + app.weakCount : "",
          ]
            .filter(Boolean)
            .join(" · ");
        block.appendChild(meta);
        var dash = res.dashboards && res.dashboards[app.program];
        if (dash && dash.scoreTrend && dash.scoreTrend.length) {
          var tw = el("div", "td-chart-wrap");
          tw.style.height = "12rem";
          var tc = document.createElement("canvas");
          tw.appendChild(tc);
          block.appendChild(tw);
          MRJ_PROGRESS_CHARTS.renderScoreTrendChart(tc, dash.scoreTrend);
        }
        card.appendChild(block);
      });
    });
  }

  function renderAppRoster(program) {
    root.innerHTML = "";
    var toolbar = el("div", "td-toolbar");
    var back = el("button", "td-btn td-btn-secondary");
    back.type = "button";
    back.textContent = "Class list";
    back.addEventListener("click", function () {
      post("teacher_list_students").then(function (res) {
        renderClass((res && res.students) || []);
      });
    });
    toolbar.appendChild(back);
    root.appendChild(toolbar);

    var card = el("div", "td-card");
    var title = el("h2", "td-section-title");
    title.textContent = "App roster";
    card.appendChild(title);
    var pickLabel = el("label", "td-label");
    pickLabel.textContent = "App";
    var select = el("select", "td-input");
    KNOWN_APPS.forEach(function (app) {
      var opt = document.createElement("option");
      opt.value = app;
      opt.textContent = app;
      if (app === program) opt.selected = true;
      select.appendChild(opt);
    });
    card.appendChild(pickLabel);
    card.appendChild(select);
    var chartWrap = el("div", "td-chart-wrap");
    var canvas = document.createElement("canvas");
    chartWrap.appendChild(canvas);
    card.appendChild(chartWrap);
    var status = el("p", "td-meta");
    card.appendChild(status);
    root.appendChild(card);

    function load() {
      var prog = select.value;
      status.textContent = "Loading…";
      post("teacher_app_roster", { program: prog, app: prog }).then(function (res) {
        if (!res || !res.ok) {
          status.textContent = (res && res.message) || "Could not load roster.";
          return;
        }
        status.textContent = (res.students || []).length + " students";
        MRJ_PROGRESS_CHARTS.renderRosterChart(
          canvas,
          (res.students || []).map(function (s) {
            var sum = s.summary || {};
            return { id: s.id, completionPct: sum.completionPct == null ? 0 : sum.completionPct };
          })
        );
      });
    }
    select.addEventListener("change", load);
    load();
  }

  loadSession();
  if (state.id && state.token) {
    post("teacher_list_students").then(function (res) {
      if (res && res.ok) renderClass(res.students || []);
      else renderLogin((res && res.message) || "Session expired.");
    });
  } else {
    renderLogin();
  }
})();
