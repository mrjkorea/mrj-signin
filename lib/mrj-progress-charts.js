/**
 * Chart helpers for MRJ progress dashboards (requires vendored Chart.js UMD).
 */
(function (global) {
  "use strict";

  var COLORS = {
    bar: "rgba(30, 92, 69, 0.85)",
    barBg: "rgba(36, 28, 22, 0.12)",
    line: "rgba(30, 92, 69, 1)",
    lineFill: "rgba(30, 92, 69, 0.15)",
    weak: "rgba(180, 60, 40, 0.9)",
  };

  function chartLib() {
    return global.Chart;
  }

  function destroyChart_(inst) {
    if (inst && typeof inst.destroy === "function") inst.destroy();
  }

  function baseFont() {
    return {
      family: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      size: 14,
      weight: "600",
    };
  }

  function renderCompletionBarChart(canvas, units) {
    destroyChart_(canvas._mrjChart);
    var Chart = chartLib();
    if (!Chart) return null;
    var labels = (units || []).map(function (u) {
      return u.label || u.id;
    });
    var data = (units || []).map(function (u) {
      return u.pct == null ? 0 : u.pct;
    });
    canvas._mrjChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Done %",
            data: data,
            backgroundColor: COLORS.bar,
            borderRadius: 6,
            maxBarThickness: 42,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: labels.length > 6 ? "y" : "x",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var u = units[ctx.dataIndex];
                if (!u) return ctx.parsed.y + "%";
                return (u.done || 0) + "/" + (u.total || 0) + " · " + ctx.parsed.y + "%";
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { font: baseFont(), maxRotation: 0, autoSkip: true },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            max: 100,
            ticks: { font: baseFont(), callback: function (v) { return v + "%"; } },
            grid: { color: COLORS.barBg },
          },
        },
      },
    });
    return canvas._mrjChart;
  }

  function renderScoreTrendChart(canvas, points) {
    destroyChart_(canvas._mrjChart);
    var Chart = chartLib();
    if (!Chart) return null;
    var pts = points || [];
    var labels = pts.map(function (p, i) {
      return p.date && p.date !== "?" ? p.date : String(i + 1);
    });
    var data = pts.map(function (p) {
      return p.pct;
    });
    canvas._mrjChart = new Chart(canvas, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Score %",
            data: data,
            borderColor: COLORS.line,
            backgroundColor: COLORS.lineFill,
            fill: true,
            tension: 0.25,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            ticks: { font: baseFont(), maxRotation: 45, autoSkip: true, maxTicksLimit: 8 },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            max: 100,
            ticks: { font: baseFont(), callback: function (v) { return v + "%"; } },
            grid: { color: COLORS.barBg },
          },
        },
      },
    });
    return canvas._mrjChart;
  }

  function renderClassCompletionChart(canvas, items) {
    destroyChart_(canvas._mrjChart);
    var Chart = chartLib();
    if (!Chart) return null;
    var labels = (items || []).map(function (it) {
      return it.label || it.program || it.id;
    });
    var data = (items || []).map(function (it) {
      return it.completionPct == null ? 0 : it.completionPct;
    });
    canvas._mrjChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Class avg completion %",
            data: data,
            backgroundColor: COLORS.bar,
            borderRadius: 6,
            maxBarThickness: 36,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: {
            beginAtZero: true,
            max: 100,
            ticks: { font: baseFont(), callback: function (v) { return v + "%"; } },
          },
          y: {
            ticks: { font: baseFont() },
            grid: { display: false },
          },
        },
      },
    });
    return canvas._mrjChart;
  }

  function renderRosterChart(canvas, students) {
    destroyChart_(canvas._mrjChart);
    var Chart = chartLib();
    if (!Chart) return null;
    var labels = (students || []).map(function (s) {
      return s.id || s.label;
    });
    var data = (students || []).map(function (s) {
      return s.completionPct == null ? 0 : s.completionPct;
    });
    canvas._mrjChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Completion %",
            data: data,
            backgroundColor: COLORS.bar,
            borderRadius: 5,
            maxBarThickness: 32,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: {
            beginAtZero: true,
            max: 100,
            ticks: { font: baseFont(), callback: function (v) { return v + "%"; } },
          },
          y: {
            ticks: { font: baseFont(), autoSkip: false },
            grid: { display: false },
          },
        },
      },
    });
    return canvas._mrjChart;
  }

  global.MRJ_PROGRESS_CHARTS = {
    renderCompletionBarChart: renderCompletionBarChart,
    renderScoreTrendChart: renderScoreTrendChart,
    renderClassCompletionChart: renderClassCompletionChart,
    renderRosterChart: renderRosterChart,
    destroyOnCanvas: function (canvas) {
      destroyChart_(canvas && canvas._mrjChart);
      if (canvas) canvas._mrjChart = null;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
