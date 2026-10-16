// Small dependency-free SVG/HTML charts.

import { esc, fmtDuration, fmtShortDate, parseYmd } from "./core.js";

/** Circular progress ring. `fraction` may exceed 1 (ring stays full). */
export function ring(fraction, { size = 120, stroke = 12, color = "var(--accent)", center = "" } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction || 0));
  return `
    <div style="position:relative;width:${size}px;height:${size}px;flex-shrink:0">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="transform:rotate(-90deg)">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
          stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}" style="transition:stroke-dashoffset 0.4s"/>
      </svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">${center}</div>
    </div>`;
}

function niceMax(value) {
  if (value <= 0) return 3600;
  const hours = value / 3600;
  const steps = [0.5, 1, 2, 3, 4, 6, 8, 10, 12, 16, 24];
  const h = steps.find((s) => s >= hours) || Math.ceil(hours);
  return h * 3600;
}

/**
 * Stacked bars per day.
 * days: [{date, total, by_category: {id: seconds}}]; categories: [{id, color, name}]
 */
export function stackedBars(days, categories, { goalSeconds = 0, height = 220 } = {}) {
  if (!days.length) return "";
  const colors = Object.fromEntries(categories.map((c) => [String(c.id), c.color]));
  const names = Object.fromEntries(categories.map((c) => [String(c.id), c.name]));
  const maxTotal = Math.max(...days.map((d) => d.total), goalSeconds);
  const yMax = niceMax(maxTotal);
  const padL = 36;
  const padB = 22;
  const padT = 8;
  const width = 720;
  const plotW = width - padL - 4;
  const plotH = height - padB - padT;
  const slot = plotW / days.length;
  const barW = Math.max(3, Math.min(34, slot * 0.68));
  const y = (s) => padT + plotH - (s / yMax) * plotH;

  let svg = "";
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (yMax / ticks) * i;
    svg += `<line class="grid-line" x1="${padL}" x2="${width}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? "0" : fmtDuration(v)}</text>`;
  }

  const labelEvery = days.length > 21 ? 7 : days.length > 10 ? 2 : 1;
  days.forEach((day, i) => {
    const x = padL + slot * i + (slot - barW) / 2;
    let acc = 0;
    const entries = Object.entries(day.by_category).sort((a, b) => b[1] - a[1]);
    const date = parseYmd(day.date);
    const tooltipLines = [`${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}: ${fmtDuration(day.total)}`];
    for (const [catId, secs] of entries) {
      tooltipLines.push(`${names[catId] || "Deleted"}: ${fmtDuration(secs)}`);
    }
    const tooltip = esc(tooltipLines.join("\n"));
    for (const [catId, secs] of entries) {
      const top = y(acc + secs);
      const h = y(acc) - top;
      svg += `<rect class="bar" x="${x}" y="${top}" width="${barW}" height="${Math.max(0, h)}" rx="2" fill="${esc(colors[catId] || "#888")}"><title>${tooltip}</title></rect>`;
      acc += secs;
    }
    if (!entries.length) {
      svg += `<rect x="${x}" y="${padT}" width="${barW}" height="${plotH}" fill="transparent"><title>${tooltip}</title></rect>`;
    }
    if (i % labelEvery === 0 || i === days.length - 1) {
      const label = days.length <= 10 ? date.toLocaleDateString([], { weekday: "short" }) : fmtShortDate(date);
      svg += `<text x="${x + barW / 2}" y="${height - 6}" text-anchor="middle">${esc(label)}</text>`;
    }
  });

  if (goalSeconds > 0) {
    svg += `<line class="goal-line" x1="${padL}" x2="${width}" y1="${y(goalSeconds)}" y2="${y(goalSeconds)}"><title>Daily goal: ${fmtDuration(goalSeconds)}</title></line>`;
  }

  return `<svg class="chart" viewBox="0 0 ${width} ${height}">${svg}</svg>`;
}

/** Simple vertical bars with labels (e.g. weekday averages). */
export function simpleBars(items, { height = 160, color = "var(--accent)" } = {}) {
  const width = 360;
  const padB = 22;
  const padT = 16;
  const max = Math.max(...items.map((i) => i.seconds), 1);
  const slot = width / items.length;
  const barW = slot * 0.6;
  let svg = "";
  items.forEach((item, i) => {
    const h = ((height - padB - padT) * item.seconds) / max;
    const x = slot * i + (slot - barW) / 2;
    const yTop = height - padB - h;
    svg += `<rect class="bar" x="${x}" y="${yTop}" width="${barW}" height="${Math.max(0, h)}" rx="3" fill="${color}"><title>${esc(item.label)}: ${fmtDuration(item.seconds)}</title></rect>`;
    if (item.seconds > 0) svg += `<text x="${x + barW / 2}" y="${yTop - 4}" text-anchor="middle">${fmtDuration(item.seconds)}</text>`;
    svg += `<text x="${x + barW / 2}" y="${height - 6}" text-anchor="middle">${esc(item.label)}</text>`;
  });
  return `<svg class="chart chart-compact" viewBox="0 0 ${width} ${height}">${svg}</svg>`;
}

/** Horizontal bars: [{name, color, seconds, share}] */
export function hBars(items) {
  if (!items.length) return `<div class="empty-inline">No time tracked in this range.</div>`;
  const max = Math.max(...items.map((i) => i.seconds), 1);
  return `<div class="hbar-list">${items
    .map(
      (i) => `
      <div class="hbar-row">
        <span class="row" style="gap:0.4rem;flex-wrap:nowrap;min-width:0"><span class="dot" style="background:${esc(i.color)}"></span><span class="cat-name">${esc(i.name)}</span></span>
        <div class="hbar-track"><div class="hbar-fill" style="width:${(i.seconds / max) * 100}%;background:${esc(i.color)}"></div></div>
        <span class="num nowrap">${fmtDuration(i.seconds)} <span class="faint">${Math.round(i.share * 100)}%</span></span>
      </div>`
    )
    .join("")}</div>`;
}

/** GitHub-style calendar heatmap. cells: [{date, seconds}] starting on a Monday. */
export function heatmap(cells, { goalSeconds = 0 } = {}) {
  const cell = 12;
  const gap = 3;
  const padL = 28;
  const padT = 16;
  const weeks = Math.ceil(cells.length / 7);
  const width = padL + weeks * (cell + gap);
  const height = padT + 7 * (cell + gap);
  const max = Math.max(goalSeconds, ...cells.map((c) => c.seconds), 1);

  const level = (s) => {
    if (s <= 0) return 0;
    const f = s / max;
    if (f < 0.25) return 1;
    if (f < 0.5) return 2;
    if (f < 0.85) return 3;
    return 4;
  };
  const fill = (l) => (l === 0 ? "var(--heat-0)" : `color-mix(in srgb, var(--success) ${[0, 30, 55, 78, 100][l]}%, var(--heat-0))`);

  let svg = "";
  ["Mon", "", "Wed", "", "Fri", "", ""].forEach((label, i) => {
    if (label) svg += `<text x="0" y="${padT + i * (cell + gap) + cell - 2}" style="font-size:9px">${label}</text>`;
  });
  let lastMonth = -1;
  cells.forEach((c, idx) => {
    const week = Math.floor(idx / 7);
    const dow = idx % 7;
    const date = parseYmd(c.date);
    if (dow === 0 && date.getMonth() !== lastMonth) {
      lastMonth = date.getMonth();
      svg += `<text x="${padL + week * (cell + gap)}" y="10" style="font-size:9px">${date.toLocaleDateString([], { month: "short" })}</text>`;
    }
    const title = `${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}: ${fmtDuration(c.seconds)}`;
    svg += `<rect x="${padL + week * (cell + gap)}" y="${padT + dow * (cell + gap)}" width="${cell}" height="${cell}" rx="2" fill="${fill(level(c.seconds))}"><title>${esc(title)}</title></rect>`;
  });

  const legend = [0, 1, 2, 3, 4].map((l) => `<i style="background:${fill(l)}"></i>`).join("");
  return `
    <div class="heatmap-wrap"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="chart" style="max-width:none">${svg}</svg></div>
    <div class="heatmap-legend">Less ${legend} More</div>`;
}
