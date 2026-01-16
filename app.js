// ---------- Constants ----------
const STORAGE_EVENTS_V3 = "mySchedule_events_v3";
const STORAGE_EVENTS_V2 = "mySchedule_v2";
const STORAGE_SETTINGS = "mySchedule_settings_v1";

const ALL_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// Fixed base step for layout & positioning (events are minute-accurate)
const BASE_STEP_MIN = 15;

// ---------- State ----------
let events = loadEvents(); // [{id,title,day,start,end,color}]
let editingId = null;

let settings = loadSettings();
let gridConfig = {
  startMinutes: parseTimeAny(settings.gridStart, { allow24: false }) ?? 0,
  endMinutes: parseTimeAny(settings.gridEnd, { allow24: true }) ?? 1439,
  gridLinesMinutes: settings.gridLines ?? 30,
  weekStart: settings.weekStart ?? "Mon",
  use12h: settings.use12h ?? true,
  days: settings.days?.length ? settings.days : DEFAULT_DAYS.slice(),
};

let dayHeaderEls = new Map();

// ---------- Elements ----------
const gridEl = document.getElementById("grid");
const timeSuggestionsEl = document.getElementById("timeSuggestions");

const gridStartEl = document.getElementById("gridStart");
const gridEndEl = document.getElementById("gridEnd");
const slotMinutesEl = document.getElementById("slotMinutes");
const weekStartEl = document.getElementById("weekStart");
const buildGridBtn = document.getElementById("buildGridBtn");

const fmt24Btn = document.getElementById("fmt24");
const fmt12Btn = document.getElementById("fmt12");

const daysGridEl = document.getElementById("daysGrid");

const eventTitleEl = document.getElementById("eventTitle");
const eventDayEl = document.getElementById("eventDay");
const eventStartEl = document.getElementById("eventStart");
const eventEndEl = document.getElementById("eventEnd");
const eventColorEl = document.getElementById("eventColor");
const saveEventBtn = document.getElementById("saveEventBtn");
const deleteEventBtn = document.getElementById("deleteEventBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const eventMsgEl = document.getElementById("eventMsg");

// Tools (Export/Import/Clear)
const exportBtn = document.getElementById("exportBtn");
const importFile = document.getElementById("importFile");
const clearBtn = document.getElementById("clearBtn");

// ---------- Utilities ----------
function uid() {
  return (crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random()}`).toString();
}

function setMsg(text, isError = false) {
  eventMsgEl.textContent = text;
  eventMsgEl.style.color = isError ? "rgba(239,68,68,0.95)" : "rgba(255,255,255,0.65)";
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatTime(mins, use12h, allow24Label = false) {
  // If we ever show 1440 as a label:
  if (allow24Label && mins === 1440) return use12h ? "12:00 AM" : "24:00";

  const safe = ((mins % 1440) + 1440) % 1440;
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  const mmPadded = String(mm).padStart(2, "0");

  if (!use12h) return `${String(hh).padStart(2, "0")}:${mmPadded}`;

  const period = hh >= 12 ? "PM" : "AM";
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour12}:${mmPadded} ${period}`;
}

function orderedWeekDays(weekStart) {
  const idx = ALL_DAYS.indexOf(weekStart);
  return ALL_DAYS.slice(idx).concat(ALL_DAYS.slice(0, idx));
}

function getCssPx(varName, fallback) {
  const v = getComputedStyle(gridEl).getPropertyValue(varName).trim();
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse time input accepting:
 * - 24h: "07:39", "7:39"
 * - 12h: "7:39 AM", "12:05 pm", also "12:00AM"
 * - end-only: "24:00" (only if allow24 = true)
 */
function parseTimeAny(str, { allow24 }) {
  if (str == null) return null;
  const s = String(str).trim().toUpperCase();
  if (!s) return null;

  if (allow24 && s === "24:00") return 1440;

  const m = s.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/);
  if (!m) return null;

  let hh = Number(m[1]);
  const mm = Number(m[2]);
  const ap = m[3] ?? null;

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (mm < 0 || mm > 59) return null;

  if (ap) {
    // 12h
    if (hh < 1 || hh > 12) return null;
    if (ap === "AM") hh = hh === 12 ? 0 : hh;
    else hh = hh === 12 ? 12 : hh + 12;
  } else {
    // 24h
    if (hh < 0 || hh > 23) return null;
  }

  return hh * 60 + mm;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function hasConflict(candidate, ignoreId = null) {
  return events.some((ev) => {
    if (ignoreId && ev.id === ignoreId) return false;
    if (ev.day !== candidate.day) return false;
    return overlaps(candidate.start, candidate.end, ev.start, ev.end);
  });
}

function minutesTo24h(mins) {
  const safe = ((mins % 1440) + 1440) % 1440;
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function minutesToInputString(mins, use12h, allow24) {
  // 24h mode: no AM/PM
  if (!use12h) {
    return mins === 1440 && allow24 ? "24:00" : minutesTo24h(mins);
  }
  // 12h mode: MUST include AM/PM (your requirement)
  return formatTime(mins, true, allow24);
}

function normalizeTimeInput(el, { allow24 }) {
  const m = parseTimeAny(el.value, { allow24 });
  if (m == null) return; // keep what user typed
  el.value = minutesToInputString(m, gridConfig.use12h, allow24);
}

function normalizeAllTimeInputs() {
  normalizeTimeInput(gridStartEl, { allow24: false });
  normalizeTimeInput(gridEndEl, { allow24: true });
  normalizeTimeInput(eventStartEl, { allow24: false });
  normalizeTimeInput(eventEndEl, { allow24: true });
}

// ---------- Storage ----------
function loadEvents() {
  for (const key of [STORAGE_EVENTS_V3, STORAGE_EVENTS_V2]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return [];
}

function saveEvents() {
  localStorage.setItem(STORAGE_EVENTS_V3, JSON.stringify(events));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS);
    if (!raw) {
      // ✅ Defaults you requested
      return {
        use12h: true,
        weekStart: "Mon",
        gridStart: "12:00 AM",
        gridEnd: "11:59 PM",
        gridLines: 30,
        days: DEFAULT_DAYS.slice(),
      };
    }
    const s = JSON.parse(raw);
    return {
      use12h: !!s.use12h,
      weekStart: s.weekStart ?? "Mon",
      gridStart: s.gridStart ?? "12:00 AM",
      gridEnd: s.gridEnd ?? "11:59 PM",
      gridLines: Number(s.gridLines ?? 30),
      days: Array.isArray(s.days) ? s.days : DEFAULT_DAYS.slice(),
    };
  } catch {
    return {
      use12h: true,
      weekStart: "Mon",
      gridStart: "12:00 AM",
      gridEnd: "11:59 PM",
      gridLines: 30,
      days: DEFAULT_DAYS.slice(),
    };
  }
}

function saveSettings() {
  const payload = {
    use12h: gridConfig.use12h,
    weekStart: gridConfig.weekStart,
    gridStart: gridStartEl.value.trim() || (gridConfig.use12h ? "12:00 AM" : "00:00"),
    gridEnd: gridEndEl.value.trim() || (gridConfig.use12h ? "11:59 PM" : "23:59"),
    gridLines: gridConfig.gridLinesMinutes,
    days: gridConfig.days,
  };
  localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(payload));
}

// ---------- Time suggestions ----------
function rebuildTimeSuggestions() {
  timeSuggestionsEl.innerHTML = "";

  // Suggestions every 15 minutes
  for (let m = 0; m <= 24 * 60; m += 15) {
    const opt = document.createElement("option");
    opt.value = minutesToInputString(m, gridConfig.use12h, true);
    timeSuggestionsEl.appendChild(opt);
  }
}

// ---------- Days picker ----------
function buildDaysCheckboxes() {
  const prevChecked = new Set(
    Array.from(document.querySelectorAll('input[name="days"]:checked')).map((x) => x.value)
  );

  daysGridEl.innerHTML = "";
  const order = orderedWeekDays(gridConfig.weekStart);

  for (const day of order) {
    const label = document.createElement("label");
    label.className = "dayChip";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "days";
    input.value = day;

    input.checked =
      prevChecked.size > 0 ? prevChecked.has(day) : gridConfig.days.includes(day);

    input.addEventListener("change", rebuildFromControls);

    label.appendChild(input);
    label.appendChild(document.createTextNode(day));
    daysGridEl.appendChild(label);
  }
}

function getSelectedDaysOrdered() {
  const checked = document.querySelectorAll('input[name="days"]:checked');
  const selectedSet = new Set(Array.from(checked).map((x) => x.value));
  const order = orderedWeekDays(gridConfig.weekStart);
  return order.filter((d) => selectedSet.has(d));
}

function rebuildEventDayOptions() {
  eventDayEl.innerHTML = "";
  for (const day of gridConfig.days) {
    const opt = document.createElement("option");
    opt.value = day;
    opt.textContent = day;
    eventDayEl.appendChild(opt);
  }
}

// ---------- Grid building (15-minute rows always) ----------
function buildGrid() {
  const { startMinutes, endMinutes, days, use12h, gridLinesMinutes } = gridConfig;

  gridEl.innerHTML = "";
  dayHeaderEls = new Map();

  const totalMinutes = Math.max(1, endMinutes - startMinutes);
  const rows = 1 + Math.ceil(totalMinutes / BASE_STEP_MIN);

  gridEl.style.gridTemplateColumns = `var(--timeColW) repeat(${days.length}, minmax(140px, 1fr))`;
  gridEl.style.gridTemplateRows = `var(--headerH) repeat(${rows - 1}, var(--rowH))`;

  addCell(1, 1, "Time", ["cell", "header", "corner"]);

  for (let c = 0; c < days.length; c++) {
    const day = days[c];
    const cell = addCell(1, 2 + c, day, ["cell", "header"]);
    dayHeaderEls.set(day, cell);
  }

  for (let r = 0; r < rows - 1; r++) {
    const rowMin = startMinutes + r * BASE_STEP_MIN;
    const isMajor = ((rowMin - startMinutes) % gridLinesMinutes) === 0;

    // Show label only on full hour marks
    const showLabel = (rowMin % 60) === 0;
    const label = showLabel ? formatTime(rowMin, use12h, false) : "";

    addCell(2 + r, 1, label, ["cell", "time"].concat(isMajor ? ["major"] : []));

    for (let c = 0; c < days.length; c++) {
      addCell(2 + r, 2 + c, "", ["cell"].concat(isMajor ? ["major"] : []));
    }
  }

  renderEvents();
}

function addCell(gridRow, gridCol, text, classes) {
  const el = document.createElement("div");
  el.className = classes.join(" ");
  el.style.gridRow = String(gridRow);
  el.style.gridColumn = String(gridCol);
  el.textContent = text;
  gridEl.appendChild(el);
  return el;
}

// ---------- Events ----------
function resetForm() {
  editingId = null;
  saveEventBtn.textContent = "Add Event";
  deleteEventBtn.style.display = "none";
  cancelEditBtn.style.display = "none";

  eventTitleEl.value = "";
  eventColorEl.value = "#4f46e5";

  eventDayEl.value = gridConfig.days[0] ?? "Mon";

  // Default event 9:00–10:00
  const s = 9 * 60;
  const e = 10 * 60;
  eventStartEl.value = minutesToInputString(s, gridConfig.use12h, false);
  eventEndEl.value = minutesToInputString(e, gridConfig.use12h, true);

  setMsg("");
}

function startEdit(id) {
  const ev = events.find((x) => x.id === id);
  if (!ev) return;

  editingId = id;
  saveEventBtn.textContent = "Save Changes";
  deleteEventBtn.style.display = "inline-block";
  cancelEditBtn.style.display = "inline-block";

  eventTitleEl.value = ev.title;
  eventColorEl.value = ev.color;
  eventDayEl.value = ev.day;

  eventStartEl.value = minutesToInputString(ev.start, gridConfig.use12h, false);
  eventEndEl.value = minutesToInputString(ev.end, gridConfig.use12h, true);

  setMsg("Editing: Save Changes or Delete.");
}

function readEventTimes() {
  const start = parseTimeAny(eventStartEl.value, { allow24: false });
  const end = parseTimeAny(eventEndEl.value, { allow24: true });

  if (start == null) return { error: "Invalid start time." };
  if (end == null) return { error: "Invalid end time." };
  return { start, end };
}

function addOrUpdateEvent() {
  const title = eventTitleEl.value.trim();
  const day = eventDayEl.value;
  const color = eventColorEl.value;

  if (!title) return setMsg("Please enter a title.", true);

  const { start, end, error } = readEventTimes();
  if (error) return setMsg(error, true);

  if (end <= start) return setMsg("End time must be after start time.", true);

  if (start < gridConfig.startMinutes || end > gridConfig.endMinutes) {
    return setMsg("Event must be inside the visible grid time range.", true);
  }

  const candidate = { day, start, end, title, color };

  if (hasConflict(candidate, editingId)) {
    return setMsg("Conflict: overlaps an existing event on this day.", true);
  }

  if (editingId) {
    events = events.map((ev) => (ev.id === editingId ? { ...ev, ...candidate } : ev));
    saveEvents();
    renderEvents();
    setMsg("Saved.");
    resetForm();
    return;
  }

  events.push({ id: uid(), ...candidate });
  saveEvents();
  renderEvents();
  setMsg("Added.");
  resetForm();
}

function deleteEditingEvent() {
  if (!editingId) return;
  events = events.filter((ev) => ev.id !== editingId);
  saveEvents();
  renderEvents();
  setMsg("Deleted.");
  resetForm();
}

function renderEvents() {
  gridEl.querySelectorAll(".eventBlock").forEach((x) => x.remove());

  const { startMinutes, endMinutes, days, use12h } = gridConfig;

  const rowH = getCssPx("--rowH", 24);
  const headerH = getCssPx("--headerH", 52);
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

    // ✅ Time on top, title below
    block.innerHTML = `
      <div class="eventMeta">${meta}</div>
      <div>${escapeHtml(ev.title)}</div>
    `;

    block.addEventListener("click", (e) => {
      e.preventDefault();
      startEdit(ev.id);
    });

    gridEl.appendChild(block);
  }
}

// ---------- Click-to-prefill on grid ----------
function handleGridClickToPrefill(e) {
  if (e.target.closest(".eventBlock")) return;

  const { startMinutes, endMinutes, days } = gridConfig;
  const gridRect = gridEl.getBoundingClientRect();

  let clickedDay = null;
  for (const day of days) {
    const headerCell = dayHeaderEls.get(day);
    if (!headerCell) continue;
    const r = headerCell.getBoundingClientRect();
    const x = e.clientX;
    if (x >= r.left && x <= r.right) {
      clickedDay = day;
      break;
    }
  }
  if (!clickedDay) return;

  const headerH = getCssPx("--headerH", 52);
  const rowH = getCssPx("--rowH", 24);
  const pxPerMin = rowH / BASE_STEP_MIN;

  const y = e.clientY - gridRect.top - headerH;
  if (y < 0) return;

  let clickedMinutes = startMinutes + Math.round(y / pxPerMin);
  clickedMinutes = Math.max(startMinutes, Math.min(endMinutes - 1, clickedMinutes));

  const roundTo = 5;
  clickedMinutes = Math.round(clickedMinutes / roundTo) * roundTo;

  eventDayEl.value = clickedDay;
  eventStartEl.value = minutesToInputString(clickedMinutes, gridConfig.use12h, false);

  let end = clickedMinutes + 60;
  end = Math.min(end, endMinutes);
  eventEndEl.value = minutesToInputString(end, gridConfig.use12h, true);

  eventTitleEl.focus();
  setMsg(`Picked ${clickedDay} at ${formatTime(clickedMinutes, gridConfig.use12h, false)}.`);
}

// ---------- Export / Import / Clear ----------
function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function exportJSON() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      use12h: gridConfig.use12h,
      weekStart: gridConfig.weekStart,
      gridStart: gridStartEl.value.trim(),
      gridEnd: gridEndEl.value.trim(),
      gridLinesMinutes: gridConfig.gridLinesMinutes,
      days: gridConfig.days,
    },
    events,
  };

  downloadTextFile("my-schedule.json", JSON.stringify(payload, null, 2));
  setMsg("Exported my-schedule.json");
}

function applyImportedData(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid file.");
  if (!Array.isArray(payload.events)) throw new Error("Missing events.");

  events = payload.events
    .filter((e) => e && typeof e === "object")
    .map((e) => ({
      id: String(e.id ?? uid()),
      title: String(e.title ?? ""),
      day: String(e.day ?? "Mon"),
      start: Number(e.start ?? 0),
      end: Number(e.end ?? 0),
      color: String(e.color ?? "#4f46e5"),
    }))
    .filter((e) => e.title && e.end > e.start);

  saveEvents();

  if (payload.settings && typeof payload.settings === "object") {
    const s = payload.settings;

    if (typeof s.weekStart === "string") {
      weekStartEl.value = s.weekStart;
      gridConfig.weekStart = s.weekStart;
    }

    if (typeof s.gridStart === "string") gridStartEl.value = s.gridStart;
    if (typeof s.gridEnd === "string") gridEndEl.value = s.gridEnd;

    if (Number.isFinite(Number(s.gridLinesMinutes))) {
      slotMinutesEl.value = String(s.gridLinesMinutes);
      gridConfig.gridLinesMinutes = Number(s.gridLinesMinutes);
    }

    if (Array.isArray(s.days) && s.days.length) {
      gridConfig.days = s.days.filter((d) => ALL_DAYS.includes(d));
      buildDaysCheckboxes();
    }

    if (typeof s.use12h === "boolean") {
      setUse12h(s.use12h);
    }
  }

  rebuildFromControls();
  setMsg("Imported schedule ✅");
}

async function importJSONFile(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  applyImportedData(payload);
}

function clearAll() {
  const ok = confirm("Delete all events? This cannot be undone.");
  if (!ok) return;

  events = [];
  saveEvents();
  renderEvents();
  resetForm();
  setMsg("All events cleared.");
}

// ---------- Controls & rebuild ----------
function setUse12h(v) {
  gridConfig.use12h = v;
  fmt12Btn.classList.toggle("active", v);
  fmt24Btn.classList.toggle("active", !v);

  // Important: show AM/PM in inputs when 12h mode
  normalizeAllTimeInputs();

  rebuildTimeSuggestions();
  buildGrid();
  renderEvents();
  saveSettings();
}

function rebuildFromControls() {
  gridConfig.weekStart = weekStartEl.value;

  const selectedDays = getSelectedDaysOrdered();
  if (selectedDays.length === 0) {
    gridEl.innerHTML = `<div style="padding:12px;color:rgba(239,68,68,0.95);">Select at least one day.</div>`;
    return;
  }
  gridConfig.days = selectedDays;

  gridConfig.gridLinesMinutes = Number(slotMinutesEl.value);

  const start = parseTimeAny(gridStartEl.value, { allow24: false });
  const end = parseTimeAny(gridEndEl.value, { allow24: true });

  if (start == null) {
    gridEl.innerHTML = `<div style="padding:12px;color:rgba(239,68,68,0.95);">Invalid grid start time.</div>`;
    return;
  }
  if (end == null) {
    gridEl.innerHTML = `<div style="padding:12px;color:rgba(239,68,68,0.95);">Invalid grid end time.</div>`;
    return;
  }
  if (end <= start) {
    gridEl.innerHTML = `<div style="padding:12px;color:rgba(239,68,68,0.95);">Grid end must be after start.</div>`;
    return;
  }

  // Keep exact start/end (don’t force 24:00)
  gridConfig.startMinutes = start;
  gridConfig.endMinutes = end;

  normalizeAllTimeInputs();

  buildDaysCheckboxes();
  rebuildEventDayOptions();
  rebuildTimeSuggestions();
  buildGrid();
  resetForm();

  saveSettings();
}

// ---------- Listeners ----------
buildGridBtn.addEventListener("click", rebuildFromControls);
gridEl.addEventListener("click", handleGridClickToPrefill);

weekStartEl.addEventListener("change", () => {
  gridConfig.weekStart = weekStartEl.value;
  buildDaysCheckboxes();
  rebuildFromControls();
});

slotMinutesEl.addEventListener("change", rebuildFromControls);

fmt24Btn.addEventListener("click", () => setUse12h(false));
fmt12Btn.addEventListener("click", () => setUse12h(true));

// Normalize when user leaves the input
gridStartEl.addEventListener("blur", () => normalizeTimeInput(gridStartEl, { allow24: false }));
gridEndEl.addEventListener("blur", () => normalizeTimeInput(gridEndEl, { allow24: true }));
eventStartEl.addEventListener("blur", () => normalizeTimeInput(eventStartEl, { allow24: false }));
eventEndEl.addEventListener("blur", () => normalizeTimeInput(eventEndEl, { allow24: true }));

saveEventBtn.addEventListener("click", (e) => {
  e.preventDefault();
  addOrUpdateEvent();
});

deleteEventBtn.addEventListener("click", (e) => {
  e.preventDefault();
  deleteEditingEvent();
});

cancelEditBtn.addEventListener("click", (e) => {
  e.preventDefault();
  resetForm();
});

window.addEventListener("resize", () => renderEvents());

// Export/Import/Clear listeners (only if elements exist)
if (exportBtn) exportBtn.addEventListener("click", exportJSON);

if (importFile) {
  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) return;

    try {
      await importJSONFile(file);
    } catch (err) {
      setMsg("Import failed: " + (err?.message ?? "Unknown error"), true);
    } finally {
      importFile.value = "";
    }
  });
}

if (clearBtn) clearBtn.addEventListener("click", clearAll);

// ---------- Init UI ----------
function initUIFromSettings() {
  // Input defaults (these get overridden by saved settings if present)
  gridStartEl.value = settings.gridStart ?? "12:00 AM";
  gridEndEl.value = settings.gridEnd ?? "11:59 PM";

  weekStartEl.value = gridConfig.weekStart;
  slotMinutesEl.value = String(gridConfig.gridLinesMinutes);

  fmt12Btn.classList.toggle("active", gridConfig.use12h);
  fmt24Btn.classList.toggle("active", !gridConfig.use12h);

  buildDaysCheckboxes();

  deleteEventBtn.style.display = "none";
  cancelEditBtn.style.display = "none";

  // Ensure inputs show correct format immediately
  normalizeAllTimeInputs();
}

// Run
initUIFromSettings();
rebuildTimeSuggestions();
rebuildFromControls();
resetForm();
