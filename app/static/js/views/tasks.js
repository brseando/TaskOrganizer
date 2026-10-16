// Tasks: every task, grouped by class/activity, with search, filters,
// sorting, the period planned/estimated/actual totals, and completed history.

import {
  ICONS,
  addDays,
  esc,
  fmtMinutes,
  getCategory,
  refresh,
  sortByDue,
  sortByPriority,
  startOfDay,
  store,
  taskRow,
} from "../core.js";
import { openPeriodPicker, registerActions } from "../ui.js";

const filters = {
  q: "",
  status: "open", // open | in_progress | done | all
  priority: "all",
  due: "all", // all | overdue | today | week | none
  sort: "due", // due | priority | created | title
  group: true,
};

let currentCategoryId = null;

function matches(task) {
  if (currentCategoryId && task.category_id !== currentCategoryId) return false;
  if (filters.status === "open" && task.status === "done") return false;
  if (filters.status === "in_progress" && task.status !== "in_progress") return false;
  if (filters.status === "done" && task.status !== "done") return false;
  if (filters.priority !== "all" && task.priority !== filters.priority) return false;

  if (filters.due !== "all") {
    const today = startOfDay(new Date());
    const due = task.due_date ? new Date(task.due_date) : null;
    if (filters.due === "none" && due) return false;
    if (filters.due === "overdue" && !task.is_overdue) return false;
    if (filters.due === "today" && !(due && due < addDays(today, 1))) return false;
    if (filters.due === "week" && !(due && due < addDays(today, 8))) return false;
  }

  if (filters.q) {
    const q = filters.q.toLowerCase();
    const hay = `${task.title} ${task.description} ${task.category_name}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function sorter() {
  if (filters.status === "done") {
    return (a, b) => (b.completed_at || "").localeCompare(a.completed_at || "");
  }
  return {
    due: sortByDue,
    priority: sortByPriority,
    created: (a, b) => (b.created_at || "").localeCompare(a.created_at || ""),
    title: (a, b) => a.title.localeCompare(b.title),
  }[filters.sort];
}

function groupHtml(cat, tasks) {
  const p = cat.period;
  const kind = cat.kind === "class" ? "Class" : "Activity";
  return `
    <section class="card group-card" style="--group-color:${esc(cat.color)}">
      <div class="group-header">
        <span class="dot lg" style="background:${esc(cat.color)}"></span>
        <h2>${esc(cat.name)}</h2>
        <span class="chip">${kind}</span>
        ${p.planned ? `<span class="chip" title="Estimated time of everything due this period">Planned ${fmtMinutes(p.planned)}</span>` : ""}
        ${p.estimated ? `<span class="chip accent" title="Estimated time left on open tasks due this period">Left ${fmtMinutes(p.estimated)}</span>` : ""}
        ${p.actual ? `<span class="chip success" title="Time tracked this period">Actual ${fmtMinutes(p.actual)}</span>` : ""}
        <div class="header-actions">
          <button type="button" class="btn sm ghost" data-action="new-task" data-category-id="${cat.id}">+ Task</button>
          <button type="button" class="icon-button small" data-action="edit-category" data-category-id="${cat.id}" title="Edit">&#9998;</button>
          <button type="button" class="icon-button small" data-action="delete-category" data-category-id="${cat.id}" title="Delete">&times;</button>
        </div>
      </div>
      ${
        tasks.length
          ? `<ul class="task-list">${tasks.map((t) => taskRow(t, { showCategory: false, showDescription: true })).join("")}</ul>`
          : `<div class="empty-inline" style="padding:0.3rem 0.5rem 0.6rem">${filters.status === "done" ? "No completed tasks." : "Nothing pending."}</div>`
      }
    </section>`;
}

function resultsHtml() {
  const state = store.state;
  if (!state.categories.length) {
    return `
      <section class="card empty-state">
        <h3>No classes or activities yet</h3>
        <p>Tasks belong to a class or extracurricular. Add one to get started.</p>
        <button type="button" class="btn primary" data-action="new-category">+ Add a class or activity</button>
      </section>`;
  }

  const tasks = state.tasks.filter(matches).sort(sorter());
  const filtering = filters.q || filters.priority !== "all" || filters.due !== "all";

  if (!filters.group) {
    if (!tasks.length) return `<section class="card empty-state"><h3>No matching tasks</h3></section>`;
    return `<section class="card"><ul class="task-list">${tasks.map((t) => taskRow(t, { showDescription: true })).join("")}</ul></section>`;
  }

  const cats = currentCategoryId ? state.categories.filter((c) => c.id === currentCategoryId) : state.categories;
  const groups = cats
    .map((cat) => {
      const catTasks = tasks.filter((t) => t.category_id === cat.id);
      if (filtering && !catTasks.length) return "";
      return groupHtml(cat, catTasks);
    })
    .join("");
  return groups || `<section class="card empty-state"><h3>No matching tasks</h3><p>Try clearing the search or filters.</p></section>`;
}

function periodBarHtml() {
  const p = store.state.period;
  return `
    <section class="card period-bar">
      <div class="period-stat">
        <span class="stat-label">Period</span>
        <button type="button" class="period-label-btn" data-action="pick-period" title="Choose a different period">${esc(p.label)}${p.is_custom ? " (custom)" : ""} &#9662;</button>
      </div>
      <div class="period-stat" title="Estimated time of every task due in this period, done or not">
        <span class="stat-label">Planned</span><strong>${fmtMinutes(p.total_planned_minutes)}</strong>
      </div>
      <div class="period-stat" title="Estimated time left on open tasks due in this period">
        <span class="stat-label">Left (est.)</span><strong>${fmtMinutes(p.total_estimated_minutes)}</strong>
      </div>
      <div class="period-stat" title="Time actually tracked during this period">
        <span class="stat-label">Actual</span><strong class="positive">${fmtMinutes(p.total_actual_minutes)}</strong>
      </div>
    </section>`;
}

function segmented(name, options, value) {
  return `<div class="segmented" data-filter-seg="${name}">${options
    .map(([v, label]) => `<button type="button" data-value="${v}" class="${v === value ? "active" : ""}">${label}</button>`)
    .join("")}</div>`;
}

function select(name, options, value) {
  return `<select data-filter="${name}">${options
    .map(([v, label]) => `<option value="${v}" ${v === value ? "selected" : ""}>${label}</option>`)
    .join("")}</select>`;
}

export const tasksView = {
  title: "Tasks",

  render(params) {
    const catParam = Number(params.get("cat")) || null;
    currentCategoryId = catParam && getCategory(catParam) ? catParam : null;
    const cat = currentCategoryId ? getCategory(currentCategoryId) : null;

    return `
      <div class="page-header">
        <div>
          <h1>${cat ? `<span class="dot lg" style="background:${esc(cat.color)};vertical-align:middle;margin-right:0.4rem"></span>${esc(cat.name)}` : "All tasks"}</h1>
          ${cat ? `<p><a href="#/tasks">&larr; All classes &amp; activities</a></p>` : ""}
        </div>
        <div class="header-actions">
          <button type="button" class="btn" data-action="new-category">+ Class / activity</button>
          <button type="button" class="btn primary" data-action="new-task" ${cat ? `data-category-id="${cat.id}"` : ""}>+ New task <kbd>N</kbd></button>
        </div>
      </div>

      ${periodBarHtml()}

      <div class="toolbar">
        <label class="search">${ICONS.search}<input type="search" id="task-search" placeholder="Search tasks  ( / )" value="${esc(filters.q)}"></label>
        ${segmented("status", [["open", "Open"], ["in_progress", "In progress"], ["done", "Completed"], ["all", "All"]], filters.status)}
        ${select("priority", [["all", "Any priority"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]], filters.priority)}
        ${select("due", [["all", "Any due date"], ["overdue", "Overdue"], ["today", "Due today"], ["week", "Due this week"], ["none", "No due date"]], filters.due)}
        ${select("sort", [["due", "Sort: due date"], ["priority", "Sort: priority"], ["created", "Sort: newest"], ["title", "Sort: title"]], filters.sort)}
        <label class="checkbox small"><input type="checkbox" data-filter="group" ${filters.group ? "checked" : ""}> Group</label>
      </div>

      <div class="task-groups" id="task-results">${resultsHtml()}</div>`;
  },

  mount(root) {
    const results = root.querySelector("#task-results");
    const rerender = () => {
      results.innerHTML = resultsHtml();
      document.dispatchEvent(new CustomEvent("tick-now"));
    };
    root.querySelector("#task-search").addEventListener("input", (event) => {
      filters.q = event.target.value.trim();
      rerender();
    });
    root.querySelectorAll("[data-filter]").forEach((el) => {
      el.addEventListener("change", () => {
        filters[el.dataset.filter] = el.type === "checkbox" ? el.checked : el.value;
        rerender();
      });
    });
    root.querySelectorAll("[data-filter-seg]").forEach((seg) => {
      seg.addEventListener("click", (event) => {
        const btn = event.target.closest("button");
        if (!btn) return;
        filters[seg.dataset.filterSeg] = btn.dataset.value;
        seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
        rerender();
      });
    });
  },

  focusSearch() {
    const input = document.getElementById("task-search");
    if (input) {
      input.focus();
      input.select();
    }
  },
};

registerActions({
  "pick-period": () => {
    openPeriodPicker({
      configuredLabel: store.state.period.configured_label,
      current: store.periodOverride,
      onApply(range) {
        store.periodOverride = range;
        refresh();
      },
    });
  },
});
