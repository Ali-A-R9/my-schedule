import { BASE_STEP_MIN, formatTime, escapeHtml } from "./time.js";

function getCssPx(gridEl, varName, fallback) {
  const v = getComputedStyle(gridEl).getPropertyValue(varName).trim();
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function addCell(gridEl, gridRow, gridCol, text, classes) {
  const el = document.createElement("div");
  el.className = classes.join(" ");
  el.style.gridRow = String(gridRow);
  el.style.gridColumn = String(gridCol);
  el.textContent = text;
  gridEl.appendChild(el);
  return el;
}

export function buildGrid({ gridEl, gridConfig }) {
  const { startMinutes, endMinutes, days, use12h, gridLinesMinutes } = gridConfig;

  gridEl.innerHTML = "";
  const dayHeaderEls = new Map();

  const totalMinutes = Math.max(1, endMinutes - startMinutes);
  const rows = 1 + Math.ceil(totalMinutes / BASE_STEP_MIN);

  gridEl.style.gridTemplateColumns = `var(--timeColW) repeat(${days.length}, minmax(140px, 1fr))`;
  gridEl.style.gridTemplateRows = `var(--headerH) repeat(${rows - 1}, var(--rowH))`;

  addCell(gridEl, 1, 1, "Time", ["cell", "header", "corner"]);

  for (let c = 0; c < days.length; c++) {
    const day = days[c];
    const cell = addCell(gridEl, 1, 2 + c, day, ["cell", "header"]);
    dayHeaderEls.set(day, cell);
  }

  for (let r = 0; r < rows - 1; r++) {
    const rowMin = startMinutes + r * BASE_STEP_MIN;
    const isMajor = ((rowMin - startMinutes) % gridLinesMinutes) === 0;

    // Show label only on full hour marks
    const showLabel = (rowMin % 60) === 0;
    const label = showLabel ? formatTime(rowMin, use12h, false) : "";

    addCell(gridEl, 2 + r, 1, label, ["cell", "time"].concat(isMajor ? ["major"] : []));

    for (let c = 0; c < days.length; c++) {
      addCell(gridEl, 2 + r, 2 + c, "", ["cell"].concat(isMajor ? ["major"] : []));
    }
  }

  return dayHeaderEls;
}

export function renderEvents({ gridEl, events, gridConfig, dayHeaderEls, onEdit }) {
  gridEl.querySelectorAll(".eventBlock").forEach((x) => x.remove());

  const { startMinutes, endMinutes, days, use12h } = gridConfig;

  const rowH = getCssPx(gridEl, "--rowH", 24);
  const headerH = getCssPx(gridEl, "--headerH", 52);
  const pxPerMin = rowH / BASE_STEP_MIN;

  const gridRect = gridEl.getBoundingClientRect();

  for (const ev of events) {
    if (!days.includes(ev.day)) continue;
    if (ev.end <= startMinutes || ev.start >= endMinutes) continue;

    const headerCell = dayHeaderEls.get(ev.day);
    if (!headerCell) continue;

    const colRect = headerCell.getBoundingClientRect();

    const left = colRect.left - gridRect.left + 6;
    const width = colRect.width - 12;

    const top = headerH + (ev.start - startMinutes) * pxPerMin + 3;
    const height = (ev.end - ev.start) * pxPerMin - 6;

    const block = document.createElement("div");
    block.className = "eventBlock";
    if (height < 52) block.classList.add("compact");

    block.style.left = `${left}px`;
    block.style.top = `${top}px`;
    block.style.width = `${width}px`;
    block.style.height = `${Math.max(26, height)}px`;
    block.style.background = ev.color;

    const meta = `${formatTime(ev.start, use12h, false)} – ${formatTime(ev.end, use12h, true)}`;

    block.innerHTML = `
      <div class="eventMeta">${meta}</div>
      <div>${escapeHtml(ev.title)}</div>
    `;

    block.addEventListener("click", (e) => {
      e.preventDefault();
      onEdit(ev.id);
    });

    gridEl.appendChild(block);
  }
}

export function handleGridClickToPrefill({
  event,
  gridEl,
  gridConfig,
  dayHeaderEls,
  onPrefill,
  ignoreIfEventBlock = true,
}) {
  if (ignoreIfEventBlock && event.target.closest(".eventBlock")) return;

  const { startMinutes, endMinutes, days } = gridConfig;
  const gridRect = gridEl.getBoundingClientRect();

  let clickedDay = null;
  for (const day of days) {
    const headerCell = dayHeaderEls.get(day);
    if (!headerCell) continue;
    const r = headerCell.getBoundingClientRect();
    const x = event.clientX;
    if (x >= r.left && x <= r.right) {
      clickedDay = day;
      break;
    }
  }
  if (!clickedDay) return;

  const headerH = getCssPx(gridEl, "--headerH", 52);
  const rowH = getCssPx(gridEl, "--rowH", 24);
  const pxPerMin = rowH / BASE_STEP_MIN;

  const y = event.clientY - gridRect.top - headerH;
  if (y < 0) return;

  let clickedMinutes = startMinutes + Math.round(y / pxPerMin);
  clickedMinutes = Math.max(startMinutes, Math.min(endMinutes - 1, clickedMinutes));

  const roundTo = 5;
  clickedMinutes = Math.round(clickedMinutes / roundTo) * roundTo;

  let end = clickedMinutes + 60;
  end = Math.min(end, endMinutes);

  onPrefill({ day: clickedDay, start: clickedMinutes, end });
}
