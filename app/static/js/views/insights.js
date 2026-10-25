// Insights: daily totals, comparisons, category breakdown, heatmap, streaks,
// estimate accuracy, and an editable list of every time session.

import { heatmap, hBars, simpleBars, stackedBars } from "../charts.js";
import {
  api,
  esc,
  fmtDelta,
  fmtDuration,
  fmtMinutes,
  fmtShortDate,
  fmtTime,
  mutate,
  parseTaskChoice,
  parseYmd,
  store,
  taskOptions,
  toLocalInput,
  toYmd,
  toast,
} from "../core.js";
import { confirmDialog, formValues, openModal, openPeriodPicker, registerActions, requestRender } from "../ui.js";

const RANGES = [
  ["7", "7 days"],
  ["14", "14 days"],
  ["30", "30 days"],
  ["90", "90 days"],
  ["period", "This period"],
];
const SOURCE_LABELS = { stopwatch: "Stopwatch", manual: "Manual", countdown: "Countdown", pomodoro: "Pomodoro" };

const ins = {
  range: "14",
  custom: null, // { start, end }
  data: null,
  logs: null,
  loadedKey: null,
  stale: true,
  loading: false,
  editingLogId: null,
  showAllLogs: false,
};

function rangeQuery() {
  if (ins.range === "custom" && ins.custom) return `start=${ins.custom.start}&end=${ins.custom.end}`;
  if (ins.range === "period") return "period=configured";
  return `days=${ins.range}`;
}

async function load() {
  const key = rangeQuery();
  if (ins.loading) return;
  if (!ins.stale && ins.loadedKey === key) return;
  ins.loading = true;
  try {
    const data = await api("GET", `/api/stats?${key}`);
    const logs = await api("GET", `/api/logs?start=${data.range.start}&end=${data.range.end}&limit=2000`);
    ins.data = data;
    ins.logs = logs.logs;
    ins.loadedKey = key;
    ins.stale = false;
  } catch (err) {
    toast(err.message, "error");
    // Don't retry in a loop; the next refresh or range change tries again.
    ins.loadedKey = key;
    ins.stale = false;
    ins.loading = false;
    return;
  }
  ins.loading = false;
  requestRender();
}

function statCard(label, value, sub = "") {
  return `
    <section class="card insight-stat">
      <span class="stat-label">${label}</span>
      <span class="big-number">${value}</span>
      ${sub ? `<span class="muted small">${sub}</span>` : ""}
    </section>`;
}

function summaryCards(d) {
  const s = d.summary;
  const c = d.comparisons;
  const best = s.best_day
    ? `${fmtDuration(s.best_day.total)}`
    : "\u2013";
  const bestSub = s.best_day ? parseYmd(s.best_day.date).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }) : "No tracked time yet";
  const vs7 = c.today_seconds - c.avg_7_seconds;
  return `
    <div class="insights-grid">
      ${statCard("Total in range", fmtDuration(s.total_seconds), `${fmtDuration(s.avg_per_day_seconds)}/day average \u00b7 ${s.active_days} active day${s.active_days === 1 ? "" : "s"}`)}
      ${statCard("Best day", best, esc(bestSub))}
      ${statCard(
        "Today vs average",
        `<span class="${vs7 >= 0 ? "positive" : "negative"}">${fmtDelta(vs7)}</span>`,
        `Today ${fmtDuration(c.today_seconds)} \u00b7 7-day avg ${fmtDuration(c.avg_7_seconds)} \u00b7 30-day avg ${fmtDuration(c.avg_30_seconds)}`
      )}
      ${statCard(
        "Goal streak",
        `${d.streak.current} day${d.streak.current === 1 ? "" : "s"}`,
        d.goal_seconds
          ? `Best ${d.streak.longest} \u00b7 goal of ${fmtDuration(d.goal_seconds)} met on ${s.goal_met_days} of ${s.elapsed_days} days`
          : `Set a daily goal in Settings to track streaks`
      )}
    </div>`;
}

function legend(d) {
  const used = new Set(d.breakdown.map((b) => b.id));
  const cats = d.categories.filter((c) => used.has(c.id));
  if (!cats.length) return "";
  return `<div class="legend">${cats.map((c) => `<span><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</span>`).join("")}
    ${d.goal_seconds ? `<span><span style="display:inline-block;width:14px;border-top:2px dashed var(--warning)"></span>Daily goal</span>` : ""}</div>`;
}

function accuracyCard(acc) {
  const o = acc.overall;
  if (!o) {
    return `
      <section class="card">
        <div class="card-header"><h2>Estimate accuracy</h2></div>
        <div class="empty-inline">Complete a few tasks that have both an estimate and tracked time to see how your estimates compare.</div>
      </section>`;
  }
  const pct = o.avg_pct_diff;
  const headline =
    Math.abs(pct) <= 10
      ? `Your estimates are usually <strong>about right</strong> (${pct > 0 ? "+" : ""}${pct}% on average).`
      : pct > 0
        ? `Tasks usually take <strong>${pct}% longer</strong> than you estimate.`
        : `Tasks usually take <strong>${-pct}% less time</strong> than you estimate.`;
  const rows = acc.by_category
    .map(
      (c) => `
      <tr>
        <td><span class="row" style="gap:0.4rem;flex-wrap:nowrap"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</span></td>
        <td class="num">${c.count}</td>
        <td class="num">${fmtMinutes(c.total_estimated_minutes)}</td>
        <td class="num">${fmtMinutes(c.total_actual_minutes)}</td>
        <td class="num ${Math.abs(c.avg_pct_diff) <= 10 ? "" : c.avg_pct_diff > 0 ? "negative" : "positive"}">${c.avg_pct_diff > 0 ? "+" : ""}${c.avg_pct_diff}%</td>
      </tr>`
    )
    .join("");
  const recent = acc.recent
    .map((t) => {
      const delta = t.actual_minutes - t.estimated_minutes;
      return `<li class="log-item" data-action="open-task" data-task-id="${t.id}" style="cursor:pointer">
        <span class="dot" style="background:${esc(t.category_color)}"></span>
        <span class="log-title">${esc(t.title)}</span>
        <span class="log-time">Est ${fmtMinutes(t.estimated_minutes)} \u00b7 Actual ${fmtMinutes(t.actual_minutes)}</span>
        <strong class="num ${delta > 0 ? "negative" : delta < 0 ? "positive" : ""}">${delta === 0 ? "on target" : `${delta > 0 ? "+" : "\u2212"}${fmtMinutes(Math.abs(delta))}`}</strong>
      </li>`;
    })
    .join("");
  return `
    <section class="card">
      <div class="card-header"><h2>Estimate accuracy</h2><span class="faint small">all completed tasks</span></div>
      <p style="margin-top:0">${headline}</p>
      <div class="row small muted" style="margin-bottom:0.8rem">
        <span class="chip success">${o.within_10pct} within 10%</span>
        <span class="chip danger">${o.over} over</span>
        <span class="chip accent">${o.under} under</span>
        ${acc.untracked_count ? `<span class="faint">${acc.untracked_count} done without tracked time not counted</span>` : ""}
      </div>
      <div class="accuracy-grid">
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Class / activity</th><th>Tasks</th><th>Est.</th><th>Actual</th><th>Avg diff</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div><div class="stat-label" style="margin-bottom:0.3rem">Recently completed</div><ul class="log-list">${recent}</ul></div>
      </div>
    </section>`;
}

function logRow(log) {
  const start = new Date(log.start_time);
  const running = !log.end_time;
  if (ins.editingLogId === log.id) {
    return `
      <tr class="editing">
        <td colspan="7">
          <form class="inline-form" data-insights-log-edit="${log.id}" style="grid-template-columns:repeat(4,minmax(0,1fr));background:none;padding:0">
            <label class="field"><span>Task</span><select name="task_id">${taskOptions(log.task_id, { includeDone: true })}</select></label>
            <label class="field"><span>Started</span><input type="datetime-local" name="start_time" value="${toLocalInput(start)}" required></label>
            ${
              running
                ? `<div class="field"><span>Minutes</span><span class="muted small">Still running</span></div>`
                : `<label class="field"><span>Minutes</span><input type="number" name="duration_minutes" min="1" value="${Math.max(1, Math.round(log.duration_seconds / 60))}" required></label>`
            }
            <label class="field"><span>Note</span><input type="text" name="note" value="${esc(log.note)}"></label>
            <div class="form-actions full">
              <button type="button" class="btn sm" data-action="insights-cancel-edit">Cancel</button>
              <button type="submit" class="btn sm primary">Save</button>
            </div>
          </form>
        </td>
      </tr>`;
  }
  return `
    <tr>
      <td class="nowrap">${esc(start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }))}</td>
      <td class="nowrap muted">${fmtTime(start)} \u2013 ${running ? "now" : fmtTime(log.end_time)}</td>
      <td class="num nowrap"><strong>${running ? `<span class="mono" data-elapsed-since="${esc(log.start_time)}"></span>` : fmtDuration(log.duration_seconds)}</strong></td>
      <td><span class="row" style="gap:0.4rem;flex-wrap:nowrap;cursor:pointer" data-action="open-task" data-task-id="${log.task_id}"><span class="dot" style="background:${esc(log.category_color)}"></span><span class="cat-name">${esc(log.task_title)}</span></span></td>
      <td><span class="chip">${SOURCE_LABELS[log.source] || esc(log.source)}</span></td>
      <td class="muted">${esc(log.note)}</td>
      <td class="actions">
        <button type="button" class="icon-button small" data-action="insights-edit-log" data-log-id="${log.id}" title="Edit">&#9998;</button>
        <button type="button" class="icon-button small" data-action="insights-delete-log" data-log-id="${log.id}" title="Delete">&times;</button>
      </td>
    </tr>`;
}

function logsCard(d) {
  const logs = ins.logs || [];
  const limit = 25;
  const shown = ins.showAllLogs ? logs : logs.slice(0, limit);
  return `
    <section class="card">
      <div class="card-header">
        <h2>Time sessions</h2><span class="count-pill">${logs.length}</span>
        <div class="header-actions">
          <button type="button" class="btn sm" data-action="insights-add-entry">+ Add entry</button>
          <a class="btn sm" href="/api/export/time-logs.csv?start=${d.range.start}&end=${d.range.end}" download>Export CSV</a>
        </div>
      </div>
      <p class="muted small" style="margin-top:-0.4rem">Fix a session that was tracked wrong: change when it started, how long it ran, which task it belongs to, or add a note.</p>
      ${
        logs.length
          ? `<div class="table-wrap"><table class="data">
              <thead><tr><th>Date</th><th>Time</th><th>Duration</th><th>Task</th><th>Source</th><th>Note</th><th></th></tr></thead>
              <tbody>${shown.map(logRow).join("")}</tbody>
            </table></div>
            ${logs.length > limit && !ins.showAllLogs ? `<div style="text-align:center;margin-top:0.6rem"><button type="button" class="btn sm" data-action="insights-show-all">Show all ${logs.length}</button></div>` : ""}`
          : `<div class="empty-inline">No sessions in this range.</div>`
      }
    </section>`;
}

export const insightsView = {
  title: "Insights",

  onStateChange({ fromPoll }) {
    if (ins.editingLogId !== null && fromPoll) return;
    ins.stale = true;
  },

  isBusy() {
    return ins.editingLogId !== null;
  },

  render() {
    load();
    const d = ins.data;
    const rangeButtons = RANGES.map(
      ([key, label]) => `<button type="button" data-action="insights-range" data-range="${key}" class="${ins.range === key ? "active" : ""}">${label}</button>`
    ).join("");
    const customLabel = ins.range === "custom" && ins.custom ? `${fmtShortDate(parseYmd(ins.custom.start))} \u2013 ${fmtShortDate(parseYmd(ins.custom.end))}` : "Custom\u2026";

    const header = `
      <div class="page-header">
        <div><h1>Insights</h1><p class="muted">${d ? esc(d.range.label) : "&nbsp;"}</p></div>
        <div class="header-actions">
          <div class="segmented">${rangeButtons}<button type="button" data-action="insights-custom" class="${ins.range === "custom" ? "active" : ""}">${esc(customLabel)}</button></div>
        </div>
      </div>`;

    if (!d) return `${header}<div class="loading">Crunching the numbers&hellip;</div>`;

    return `
      ${header}
      ${summaryCards(d)}
      <div class="insights-two">
        <section class="card">
          <div class="card-header"><h2>Time per day</h2></div>
          ${stackedBars(d.days, d.categories, { goalSeconds: d.goal_seconds })}
          ${legend(d)}
        </section>
        <section class="card">
          <div class="card-header"><h2>By class / activity</h2></div>
          ${hBars(d.breakdown)}
        </section>
      </div>
      <div class="insights-two">
        <section class="card">
          <div class="card-header"><h2>Last 6 months</h2><span class="faint small">every day you tracked time</span></div>
          ${heatmap(d.heatmap, { goalSeconds: d.goal_seconds })}
        </section>
        <section class="card">
          <div class="card-header"><h2>Busiest weekdays</h2><span class="faint small">average in range</span></div>
          ${simpleBars(d.weekday_avg)}
        </section>
      </div>
      <div class="stack">
        ${accuracyCard(d.accuracy)}
        ${logsCard(d)}
      </div>`;
  },

  mount(root) {
    const form = root.querySelector("[data-insights-log-edit]");
    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const result = await mutate("PATCH", `/api/logs/${form.dataset.insightsLogEdit}`, formValues(form), "Session updated");
        if (result) {
          ins.editingLogId = null;
          ins.stale = true;
          requestRender();
        }
      });
    }
  },
};

function openAddEntry() {
  const today = new Date();
  openModal({
    title: "Add a time entry",
    body: `
      <form class="form-grid" data-add-entry>
        <label class="field full"><span>Task</span><select name="task_id" required><option value="">Choose&hellip;</option>${taskOptions(null, { includeDone: true, byCategory: true })}</select></label>
        <label class="field"><span>Minutes</span><input type="number" name="minutes" min="1" required placeholder="e.g. 45"></label>
        <label class="field"><span>Date</span><input type="date" name="logged_date" value="${toYmd(today)}" max="${toYmd(today)}"></label>
        <label class="field"><span>Start time</span><input type="time" name="logged_time" value="${String(today.getHours()).padStart(2, "0")}:00"></label>
        <label class="field"><span>Note</span><input type="text" name="note" placeholder="Optional"></label>
        <div class="form-actions full">
          <button type="button" class="btn" data-modal-close>Cancel</button>
          <button type="submit" class="btn primary">Add entry</button>
        </div>
      </form>`,
    onMount(el, modal) {
      const form = el.querySelector("[data-add-entry]");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const values = formValues(form);
        const { task_id: taskId, category_id: categoryId } = parseTaskChoice(values.task_id);
        const url = categoryId ? `/api/categories/${categoryId}/timer/log` : `/api/tasks/${taskId}/timer/log`;
        const result = await mutate("POST", url, values, "Entry added");
        if (result) modal.close();
      });
    },
  });
}

registerActions({
  "insights-range": (el) => {
    ins.range = el.dataset.range;
    ins.showAllLogs = false;
    requestRender();
  },
  "insights-custom": () => {
    openPeriodPicker({
      configuredLabel: store.state.settings.period_label,
      current: ins.custom,
      onApply(range) {
        if (range) {
          ins.custom = range;
          ins.range = "custom";
        } else {
          ins.range = "period";
        }
        requestRender();
      },
    });
  },
  "insights-edit-log": (el) => {
    ins.editingLogId = Number(el.dataset.logId);
    requestRender();
  },
  "insights-cancel-edit": () => {
    ins.editingLogId = null;
    requestRender();
  },
  "insights-delete-log": async (el) => {
    if (await confirmDialog("Delete this time session?")) {
      await mutate("DELETE", `/api/logs/${el.dataset.logId}`, undefined, "Session deleted");
    }
  },
  "insights-show-all": () => {
    ins.showAllLogs = true;
    requestRender();
  },
  "insights-add-entry": () => openAddEntry(),
});
