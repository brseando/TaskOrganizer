// Today: goal progress, comparisons with other days, what's running,
// quick add, and what's due.

import { ring } from "../charts.js";
import {
  ICONS,
  addDays,
  categoryOptions,
  esc,
  fmtClock,
  fmtDelta,
  fmtDuration,
  fmtTime,
  getCategory,
  greeting,
  mutate,
  openTasks,
  sortByDue,
  startOfDay,
  store,
  taskRow,
  toYmd,
} from "../core.js";
import { registerForms } from "../ui.js";

let lastQuickCategory = null;

function nowCard(state) {
  const timer = state.active_timer;
  const focus = state.focus;
  if (focus.status === "running" || focus.status === "paused") {
    const phase = focus.mode === "pomodoro" ? { work: "Focus", short_break: "Short break", long_break: "Long break" }[focus.phase] : "Countdown";
    return `
      <div class="stat-label">${esc(phase)}${focus.status === "paused" ? " \u00b7 paused" : ""}</div>
      <div class="now-time mono" ${focus.status === "running" ? `data-countdown-until="${esc(focus.ends_at)}"` : ""}>${focus.status === "paused" ? fmtClock(focus.remaining_seconds) : ""}</div>
      ${focus.task_title ? `<div class="now-title"><span class="dot" style="background:${esc(focus.category_color)}"></span>${esc(focus.task_title)}</div>` : ""}
      <div><a class="btn sm" href="#/focus">Open Focus</a></div>`;
  }
  if (timer) {
    return `
      <div class="stat-label">Tracking now</div>
      <div class="now-time mono" data-elapsed-since="${esc(timer.start_time)}"></div>
      <div class="now-title"><span class="dot" style="background:${esc(timer.category_color)}"></span>${esc(timer.task_title)}</div>
      <div class="row">
        <button type="button" class="btn sm danger" data-action="stop-timer" data-task-id="${timer.task_id}">${ICONS.stop} Stop</button>
        <button type="button" class="btn sm" data-action="open-task" data-task-id="${timer.task_id}">Details</button>
      </div>`;
  }
  if (focus.status === "finished") {
    return `
      <div class="stat-label">Focus timer</div>
      <div class="now-title">Time's up${focus.task_title ? ` for ${esc(focus.task_title)}` : ""}.</div>
      <div><a class="btn sm primary" href="#/focus">Open Focus</a></div>`;
  }
  return `
    <div class="stat-label">Nothing running</div>
    <div class="muted">Start a timer on a task below, study a class in general, or begin a focus session.</div>
    ${
      state.categories.length
        ? `<div class="row"><span class="small muted">Study:</span>${state.categories
            .map(
              (c) =>
                `<button type="button" class="btn sm" data-action="start-category-timer" data-category-id="${c.id}" title="Track general study time on ${esc(c.name)}"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</button>`
            )
            .join("")}</div>`
        : ""
    }
    <div class="row">
      <a class="btn sm primary" href="#/focus">Start a focus session</a>
    </div>`;
}

function section(title, tasks, { emptyText, showCount = true } = {}) {
  return `
    <section class="card">
      <div class="card-header"><h2>${esc(title)}</h2>${showCount ? `<span class="count-pill">${tasks.length}</span>` : ""}</div>
      ${tasks.length ? `<ul class="task-list">${tasks.map((t) => taskRow(t)).join("")}</ul>` : `<div class="empty-inline">${esc(emptyText)}</div>`}
    </section>`;
}

function todayLogsCard(state) {
  const logs = state.today_logs;
  const byCat = state.today.today_by_category;
  const total = Object.values(byCat).reduce((a, b) => a + b, 0);
  const split = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .map(([id, secs]) => {
      const cat = getCategory(id);
      return `<span style="width:${(secs / (total || 1)) * 100}%;background:${esc(cat?.color || "#888")}" title="${esc(cat?.name || "Deleted")}: ${fmtDuration(secs)}"></span>`;
    })
    .join("");
  const items = logs
    .map((log) => {
      const running = !log.end_time;
      return `
        <li class="log-item" data-action="open-task" data-task-id="${log.task_id}" style="cursor:pointer">
          <span class="dot" style="background:${esc(log.category_color)}"></span>
          <span class="log-title">${esc(log.task_title)}</span>
          <span class="log-time">${fmtTime(log.start_time)}${running ? " \u2013 now" : ` \u2013 ${fmtTime(log.end_time)}`}</span>
          <strong class="num">${running ? `<span class="mono" data-elapsed-since="${esc(log.start_time)}"></span>` : fmtDuration(log.duration_seconds)}</strong>
        </li>`;
    })
    .join("");
  return `
    <section class="card">
      <div class="card-header"><h2>Today's sessions</h2><span class="count-pill">${logs.length}</span></div>
      ${total ? `<div class="split-bar">${split}</div>` : ""}
      ${logs.length ? `<ul class="log-list">${items}</ul>` : `<div class="empty-inline">No time tracked yet today.</div>`}
    </section>`;
}

export const todayView = {
  title: "Today",

  render() {
    const state = store.state;
    const t = state.today;
    const goal = t.goal_seconds;
    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const weekEnd = addDays(todayStart, 8);

    const open = openTasks().sort(sortByDue);
    const overdue = open.filter((x) => x.is_overdue);
    const dueToday = open.filter((x) => !x.is_overdue && x.due_date && new Date(x.due_date) < tomorrowStart);
    const upcoming = open.filter((x) => x.due_date && new Date(x.due_date) >= tomorrowStart && new Date(x.due_date) < weekEnd);
    const inProgressUndated = open.filter((x) => !x.due_date && (x.status === "in_progress" || x.timer_running));

    const vsYesterday = t.today_seconds - t.yesterday_seconds;
    const vsAvg = t.today_seconds - t.avg_7_seconds;
    const pct = goal ? t.today_seconds / goal : 0;

    const quickCat = lastQuickCategory && state.categories.some((c) => c.id === lastQuickCategory) ? lastQuickCategory : state.categories[0]?.id;

    return `
      <div class="page-header">
        <div>
          <h1>${greeting()}</h1>
          <p class="muted">${now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} \u00b7 <span data-clock></span></p>
        </div>
        <div class="header-actions">
          <button type="button" class="btn primary" data-action="new-task">+ New task <kbd>N</kbd></button>
        </div>
      </div>

      <div class="today-top">
        <section class="card goal-card">
          ${ring(pct, {
            size: 112,
            stroke: 11,
            color: pct >= 1 ? "var(--success)" : "var(--accent)",
            center: `<strong class="num" style="font-size:1.05rem">${Math.round(pct * 100)}%</strong><span class="faint small">of goal</span>`,
          })}
          <div class="goal-text">
            <span class="stat-label">Tracked today</span>
            <span class="big-number"${state.active_timer ? ` data-elapsed-since="${esc(state.server_time)}" data-elapsed-base="${t.today_seconds}" data-format="duration"` : ""}>${fmtDuration(t.today_seconds)}</span>
            <span class="muted small">${goal ? `Goal ${fmtDuration(goal)}${pct >= 1 ? " \u00b7 reached" : ` \u00b7 ${fmtDuration(goal - t.today_seconds)} to go`}` : "No daily goal set"}</span>
            <span class="small">Streak <strong>${t.streak.current} day${t.streak.current === 1 ? "" : "s"}</strong> <span class="faint">\u00b7 best ${t.streak.longest}</span></span>
          </div>
        </section>

        <section class="card">
          <div class="compare-list">
            <div>
              <div class="stat-label">vs yesterday</div>
              <div class="compare-item"><span class="muted">Yesterday ${fmtDuration(t.yesterday_seconds)}</span>
                <span class="compare-delta ${vsYesterday >= 0 ? "positive" : "negative"}">${fmtDelta(vsYesterday)}</span></div>
            </div>
            <div>
              <div class="stat-label">vs your 7-day average</div>
              <div class="compare-item"><span class="muted">Average ${fmtDuration(t.avg_7_seconds)}/day</span>
                <span class="compare-delta ${vsAvg >= 0 ? "positive" : "negative"}">${fmtDelta(vsAvg)}</span></div>
            </div>
            <a class="small" href="#/insights">See all insights &rarr;</a>
          </div>
        </section>

        <section class="card now-card">${nowCard(state)}</section>
      </div>

      ${
        state.categories.length
          ? `<form class="card quick-add" data-form="quick-add">
              <input type="text" name="title" placeholder="Quick add a task&hellip;" maxlength="200" required>
              <select name="category_id" aria-label="Class or activity">${categoryOptions(quickCat)}</select>
              <select name="due_date" aria-label="Due">
                <option value="">No due date</option>
                <option value="${toYmd(now)}">Due today</option>
                <option value="${toYmd(addDays(now, 1))}" selected>Due tomorrow</option>
                <option value="${toYmd(addDays(now, 7))}">Due in a week</option>
              </select>
              <input type="number" name="estimated_minutes" min="0" step="5" placeholder="Est. min">
              <button type="submit" class="btn primary">Add</button>
            </form>`
          : `<section class="card empty-state" style="margin-bottom:1rem">
              <h3>Welcome to Task Organizer</h3>
              <p>Start by adding a class or extracurricular, then add tasks to it.</p>
              <button type="button" class="btn primary" data-action="new-category">+ Add a class or activity</button>
            </section>`
      }

      <div class="today-columns">
        ${overdue.length ? section("Overdue", overdue) : ""}
        ${section("Due today", dueToday, { emptyText: "Nothing due today." })}
        ${section("Next 7 days", upcoming, { emptyText: "Nothing due in the next week." })}
        ${inProgressUndated.length ? section("In progress", inProgressUndated) : ""}
        ${todayLogsCard(state)}
      </div>`;
  },
};

registerForms({
  "quick-add": async (form, values) => {
    lastQuickCategory = Number(values.category_id);
    const result = await mutate("POST", "/api/tasks", values, "Task added");
    if (result) {
      const input = document.querySelector('[data-form="quick-add"] input[name="title"]');
      if (input) input.focus();
    }
  },
});
