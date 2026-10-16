// Calendar: due dates on a month or week grid, plus time tracked each day.

import { addDays, api, esc, fmtDuration, fmtTime, sameDay, startOfDay, store, toYmd } from "../core.js";
import { openTaskForm } from "../drawer.js";
import { registerActions } from "../ui.js";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS_MONTH = 3;

const cal = {
  mode: "month",
  cursor: startOfDay(new Date()),
  daily: {},
  loadedKey: null,
};

function mondayOf(date) {
  return addDays(date, -((date.getDay() + 6) % 7));
}

function visibleRange() {
  if (cal.mode === "week") {
    const start = mondayOf(cal.cursor);
    return { start, days: 7 };
  }
  const first = new Date(cal.cursor.getFullYear(), cal.cursor.getMonth(), 1);
  const start = mondayOf(first);
  const last = new Date(cal.cursor.getFullYear(), cal.cursor.getMonth() + 1, 0);
  const days = Math.ceil(((last - start) / 86400000 + 1) / 7) * 7;
  return { start, days };
}

async function loadDaily(rerender) {
  const { start, days } = visibleRange();
  const end = addDays(start, days - 1);
  const key = `${toYmd(start)}_${toYmd(end)}_${store.state?.server_time?.slice(0, 16)}`;
  if (cal.loadedKey === key) return;
  cal.loadedKey = key;
  try {
    const data = await api("GET", `/api/stats/daily?start=${toYmd(start)}&end=${toYmd(end)}`);
    cal.daily = data.days;
    rerender();
  } catch {
    /* daily totals are a nice-to-have */
  }
}

function chip(task, { showTime }) {
  const due = new Date(task.due_date);
  const isEod = due.getHours() === 23 && due.getMinutes() === 59;
  const cls = ["cal-chip"];
  if (task.status === "done") cls.push("done");
  if (task.is_overdue) cls.push("overdue");
  return `<div class="${cls.join(" ")}" style="--chip-color:${esc(task.category_color)}" data-action="open-task" data-task-id="${task.id}" title="${esc(task.title)} \u00b7 ${esc(task.category_name)}">
    ${showTime && !isEod ? `<span class="cal-chip-time">${fmtTime(due)}</span>` : ""}<span>${esc(task.title)}</span></div>`;
}

function cellsHtml() {
  const { start, days } = visibleRange();
  const today = new Date();
  const byDay = {};
  for (const task of store.state.tasks) {
    if (!task.due_date) continue;
    const key = task.due_date.slice(0, 10);
    (byDay[key] ||= []).push(task);
  }
  Object.values(byDay).forEach((list) => list.sort((a, b) => a.due_date.localeCompare(b.due_date)));

  let html = WEEKDAY_LABELS.map((d) => `<div class="calendar-head">${d}</div>`).join("");
  for (let i = 0; i < days; i++) {
    const day = addDays(start, i);
    const key = toYmd(day);
    const tasks = byDay[key] || [];
    const cls = ["calendar-cell"];
    if (cal.mode === "month" && day.getMonth() !== cal.cursor.getMonth()) cls.push("other-month");
    if (sameDay(day, today)) cls.push("today");
    const tracked = cal.daily[key] || 0;
    const limit = cal.mode === "month" ? MAX_CHIPS_MONTH : Infinity;
    const shown = tasks.slice(0, limit);
    const more = tasks.length - shown.length;
    html += `
      <div class="${cls.join(" ")}" data-action="calendar-day" data-date="${key}" title="Click to add a task due ${esc(day.toLocaleDateString())}">
        <div class="cal-day-top">
          <span class="cal-day-num">${day.getDate()}</span>
          ${tracked >= 60 ? `<span class="cal-tracked" title="Time tracked">${fmtDuration(tracked)}</span>` : ""}
        </div>
        ${shown.map((t) => chip(t, { showTime: true })).join("")}
        ${more > 0 ? `<button type="button" class="cal-more btn ghost sm" data-action="calendar-week-of" data-date="${key}">+${more} more</button>` : ""}
      </div>`;
  }
  return html;
}

function titleText() {
  if (cal.mode === "month") {
    return cal.cursor.toLocaleDateString([], { month: "long", year: "numeric" });
  }
  const start = mondayOf(cal.cursor);
  const end = addDays(start, 6);
  const fmt = (d) => d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${fmt(start)} \u2013 ${fmt(end)}, ${end.getFullYear()}`;
}

let rerenderCalendar = () => {};

export const calendarView = {
  title: "Calendar",

  render() {
    return `
      <div class="page-header">
        <div><h1>Calendar</h1><p class="muted">Click a day to add a task due then. Green numbers show time tracked that day.</p></div>
        <div class="header-actions"><button type="button" class="btn primary" data-action="new-task">+ New task</button></div>
      </div>
      <div class="calendar-toolbar">
        <button type="button" class="btn sm" data-action="calendar-prev" aria-label="Previous">&lsaquo;</button>
        <button type="button" class="btn sm" data-action="calendar-today">Today</button>
        <button type="button" class="btn sm" data-action="calendar-next" aria-label="Next">&rsaquo;</button>
        <h2 id="calendar-title">${esc(titleText())}</h2>
        <span class="spacer"></span>
        <div class="segmented">
          <button type="button" data-action="calendar-mode" data-mode="month" class="${cal.mode === "month" ? "active" : ""}">Month</button>
          <button type="button" data-action="calendar-mode" data-mode="week" class="${cal.mode === "week" ? "active" : ""}">Week</button>
        </div>
      </div>
      <div class="calendar ${cal.mode}" id="calendar-grid">${cellsHtml()}</div>`;
  },

  mount(root) {
    rerenderCalendar = () => {
      const grid = root.querySelector("#calendar-grid");
      if (!grid || !grid.isConnected) return;
      grid.className = `calendar ${cal.mode}`;
      grid.innerHTML = cellsHtml();
      root.querySelector("#calendar-title").textContent = titleText();
      root.querySelectorAll('[data-action="calendar-mode"]').forEach((b) => b.classList.toggle("active", b.dataset.mode === cal.mode));
    };
    loadDaily(rerenderCalendar);
  },
};

function moveCursor(direction) {
  if (cal.mode === "month") {
    cal.cursor = new Date(cal.cursor.getFullYear(), cal.cursor.getMonth() + direction, 1);
  } else {
    cal.cursor = addDays(cal.cursor, 7 * direction);
  }
  rerenderCalendar();
  loadDaily(rerenderCalendar);
}

registerActions({
  "calendar-day": (el) => openTaskForm({ dueDate: el.dataset.date }),
  "calendar-prev": () => moveCursor(-1),
  "calendar-next": () => moveCursor(1),
  "calendar-today": () => {
    cal.cursor = startOfDay(new Date());
    rerenderCalendar();
    loadDaily(rerenderCalendar);
  },
  "calendar-mode": (el) => {
    cal.mode = el.dataset.mode;
    rerenderCalendar();
    loadDaily(rerenderCalendar);
  },
  "calendar-week-of": (el) => {
    const [y, m, d] = el.dataset.date.split("-").map(Number);
    cal.cursor = new Date(y, m - 1, d);
    cal.mode = "week";
    rerenderCalendar();
    loadDaily(rerenderCalendar);
  },
});
