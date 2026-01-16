import { DEFAULT_DAYS, parseTimeAny, minutesToInputString, formatTime, ALL_DAYS } from "./time.js";
import { loadEvents, saveEvents, loadSettings, saveSettings, downloadTextFile, readJsonFile } from "./storage.js";
import { uid, hasConflict, normalizeImportedPayload } from "./events.js";
import { buildGrid, renderEvents, handleGridClickToPrefill } from "./grid.js";
import {
  getElements,
  setMsg,
  normalizeTimeInput,
  normalizeAllTimeInputs,
  rebuildTimeSuggestions,
  buildDaysCheckboxes,
  getSelectedDaysOrdered,
  rebuildEventDayOptions,
  resetForm,
  startEdit,
  applySettingsToInputs,
} from "./ui.js";

window.addEventListener("DOMContentLoaded", () => {
  const els = getElements();

  const state = {
    events: loadEvents(),
    editingId: null,
    settings: loadSettings(),
    gridConfig: {
      startMinutes: parseTimeAny(loadSettings().gridStart, { allow24: false }) ?? 0,
      endMinutes: parseTimeAny(loadSettings().gridEnd, { allow24: true }) ?? 1439,
      gridLinesMinutes: loadSettings().gridLines ?? 30,
      weekStart: loadSettings().weekStart ?? "Mon",
      use12h: loadSettings().use12h ?? true,
      days: loadSettings().days?.length ? loadSettings().days : DEFAULT_DAYS.slice(),
    },
    dayHeaderEls: new Map(),
  };

  function persistSettingsFromUI() {
    const payload = {
      use12h: state.gridConfig.use12h,
      weekStart: state.gridConfig.weekStart,
      gridStart: els.gridStartEl.value.trim() || (state.gridConfig.use12h ? "12:00 AM" : "00:00"),
      gridEnd: els.gridEndEl.value.trim() || (state.gridConfig.use12h ? "11:59 PM" : "23:59"),
      gridLines: state.gridConfig.gridLinesMinutes,
      days: state.gridConfig.days,
    };
    saveSettings(payload);
  }

  function doRender() {
    state.dayHeaderEls = buildGrid({ gridEl: els.gridEl, gridConfig: state.gridConfig });
    renderEvents({
      gridEl: els.gridEl,
      events: state.events,
      gridConfig: state.gridConfig,
      dayHeaderEls: state.dayHeaderEls,
      onEdit: (id) => {
        startEdit(els, state, id);
        setMsg(els.eventMsgEl, "Editing: Save Changes or Delete.");
      },
    });
  }

  function setUse12h(v) {
    state.gridConfig.use12h = v;
    els.fmt12Btn.classList.toggle("active", v);
    els.fmt24Btn.classList.toggle("active", !v);

    normalizeAllTimeInputs(els, state.gridConfig);
    rebuildTimeSuggestions(els.timeSuggestionsEl, state.gridConfig);

    doRender();
    persistSettingsFromUI();
  }

  function rebuildFromControls() {
    state.gridConfig.weekStart = els.weekStartEl.value;

    const selectedDays = getSelectedDaysOrdered(state.gridConfig);
    if (selectedDays.length === 0) {
      els.gridEl.innerHTML = `<div style="padding:12px;color:rgba(239,68,68,0.95);">Select at least one day.</div>`;
      return;
    }
    state.gridConfig.days = selectedDays;

    state.gridConfig.gridLinesMinutes = Number(els.slotMinutesEl.value);

    const start = parseTimeAny(els.gridStartEl.value, { allow24: false });
    const end = parseTimeAny(els.gridEndEl.value, { allow24: true });

    if (start == null) {
      els.gridEl.innerHTML = `<div style="padding:12px;color:rgba(239,68,68,0.95);">Invalid grid start time.</div>`;
      return;
    }
    if (end == null) {
      els.gridEl.innerHTML = `<div style="padding:12px;color:rgba(239,68,68,0.95);">Invalid grid end time.</div>`;
      return;
    }
    if (end <= start) {
      els.gridEl.innerHTML = `<div style="padding:12px;color:rgba(239,68,68,0.95);">Grid end must be after start.</div>`;
      return;
    }

    state.gridConfig.startMinutes = start;
    state.gridConfig.endMinutes = end;

    normalizeAllTimeInputs(els, state.gridConfig);

    buildDaysCheckboxes(els.daysGridEl, state.gridConfig, rebuildFromControls);
    rebuildEventDayOptions(els.eventDayEl, state.gridConfig);
    rebuildTimeSuggestions(els.timeSuggestionsEl, state.gridConfig);

    doRender();
    resetForm(els, state);
    setMsg(els.eventMsgEl, "");
    persistSettingsFromUI();
  }

  function readEventTimes() {
    const start = parseTimeAny(els.eventStartEl.value, { allow24: false });
    const end = parseTimeAny(els.eventEndEl.value, { allow24: true });
    if (start == null) return { error: "Invalid start time." };
    if (end == null) return { error: "Invalid end time." };
    return { start, end };
  }

  function addOrUpdateEvent() {
    const title = els.eventTitleEl.value.trim();
    const day = els.eventDayEl.value;
    const color = els.eventColorEl.value;

    if (!title) return setMsg(els.eventMsgEl, "Please enter a title.", true);

    const { start, end, error } = readEventTimes();
    if (error) return setMsg(els.eventMsgEl, error, true);

    if (end <= start) return setMsg(els.eventMsgEl, "End time must be after start time.", true);

    if (start < state.gridConfig.startMinutes || end > state.gridConfig.endMinutes) {
      return setMsg(els.eventMsgEl, "Event must be inside the visible grid time range.", true);
    }

    const candidate = { day, start, end, title, color };

    if (hasConflict(state.events, candidate, state.editingId)) {
      return setMsg(els.eventMsgEl, "Conflict: overlaps an existing event on this day.", true);
    }

    if (state.editingId) {
      state.events = state.events.map((ev) => (ev.id === state.editingId ? { ...ev, ...candidate } : ev));
      saveEvents(state.events);
      doRender();
      setMsg(els.eventMsgEl, "Saved.");
      resetForm(els, state);
      return;
    }

    state.events.push({ id: uid(), ...candidate });
    saveEvents(state.events);
    doRender();
    setMsg(els.eventMsgEl, "Added.");
    resetForm(els, state);
  }

  function deleteEditingEvent() {
    if (!state.editingId) return;
    state.events = state.events.filter((ev) => ev.id !== state.editingId);
    saveEvents(state.events);
    doRender();
    setMsg(els.eventMsgEl, "Deleted.");
    resetForm(els, state);
  }

  function exportJSON() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        use12h: state.gridConfig.use12h,
        weekStart: state.gridConfig.weekStart,
        gridStart: els.gridStartEl.value.trim(),
        gridEnd: els.gridEndEl.value.trim(),
        gridLinesMinutes: state.gridConfig.gridLinesMinutes,
        days: state.gridConfig.days,
      },
      events: state.events,
    };
    downloadTextFile("my-schedule.json", JSON.stringify(payload, null, 2));
    setMsg(els.eventMsgEl, "Exported my-schedule.json");
  }

  async function importJSONFile(file) {
    const payload = await readJsonFile(file);
    const normalized = normalizeImportedPayload(payload);

    state.events = normalized.events;
    saveEvents(state.events);

    if (normalized.settings) {
      const s = normalized.settings;

      if (typeof s.weekStart === "string" && ALL_DAYS.includes(s.weekStart)) {
        els.weekStartEl.value = s.weekStart;
        state.gridConfig.weekStart = s.weekStart;
      }

      if (typeof s.gridStart === "string") els.gridStartEl.value = s.gridStart;
      if (typeof s.gridEnd === "string") els.gridEndEl.value = s.gridEnd;

      if (Number.isFinite(s.gridLinesMinutes)) {
        els.slotMinutesEl.value = String(s.gridLinesMinutes);
        state.gridConfig.gridLinesMinutes = Number(s.gridLinesMinutes);
      }

      if (Array.isArray(s.days) && s.days.length) {
        state.gridConfig.days = s.days;
      }

      if (typeof s.use12h === "boolean") {
        setUse12h(s.use12h);
      }
    }

    rebuildFromControls();
    setMsg(els.eventMsgEl, "Imported schedule ✅");
  }

  function clearAll() {
    const ok = confirm("Delete all events? This cannot be undone.");
    if (!ok) return;

    state.events = [];
    saveEvents(state.events);
    doRender();
    resetForm(els, state);
    setMsg(els.eventMsgEl, "All events cleared.");
  }

  // --- Wire listeners ---
  els.buildGridBtn.addEventListener("click", rebuildFromControls);

  els.weekStartEl.addEventListener("change", () => {
    state.gridConfig.weekStart = els.weekStartEl.value;
    buildDaysCheckboxes(els.daysGridEl, state.gridConfig, rebuildFromControls);
    rebuildFromControls();
  });

  els.slotMinutesEl.addEventListener("change", rebuildFromControls);

  els.fmt24Btn.addEventListener("click", () => setUse12h(false));
  els.fmt12Btn.addEventListener("click", () => setUse12h(true));

  els.gridStartEl.addEventListener("blur", () => normalizeTimeInput(els.gridStartEl, state.gridConfig, { allow24: false }));
  els.gridEndEl.addEventListener("blur", () => normalizeTimeInput(els.gridEndEl, state.gridConfig, { allow24: true }));
  els.eventStartEl.addEventListener("blur", () => normalizeTimeInput(els.eventStartEl, state.gridConfig, { allow24: false }));
  els.eventEndEl.addEventListener("blur", () => normalizeTimeInput(els.eventEndEl, state.gridConfig, { allow24: true }));

  els.saveEventBtn.addEventListener("click", (e) => {
    e.preventDefault();
    addOrUpdateEvent();
  });

  els.deleteEventBtn.addEventListener("click", (e) => {
    e.preventDefault();
    deleteEditingEvent();
  });

  els.cancelEditBtn.addEventListener("click", (e) => {
    e.preventDefault();
    resetForm(els, state);
    setMsg(els.eventMsgEl, "");
  });

  els.gridEl.addEventListener("click", (e) => {
    handleGridClickToPrefill({
      event: e,
      gridEl: els.gridEl,
      gridConfig: state.gridConfig,
      dayHeaderEls: state.dayHeaderEls,
      onPrefill: ({ day, start, end }) => {
        els.eventDayEl.value = day;
        els.eventStartEl.value = minutesToInputString(start, state.gridConfig.use12h, false);
        els.eventEndEl.value = minutesToInputString(end, state.gridConfig.use12h, true);
        els.eventTitleEl.focus();
        setMsg(els.eventMsgEl, `Picked ${day} at ${formatTime(start, state.gridConfig.use12h, false)}.`);
      },
    });
  });

  window.addEventListener("resize", () => doRender());

  if (els.exportBtn) els.exportBtn.addEventListener("click", exportJSON);

  if (els.importFile) {
    els.importFile.addEventListener("change", async () => {
      const file = els.importFile.files?.[0];
      if (!file) return;

      try {
        await importJSONFile(file);
      } catch (err) {
        setMsg(els.eventMsgEl, "Import failed: " + (err?.message ?? "Unknown error"), true);
      } finally {
        els.importFile.value = "";
      }
    });
  }

  if (els.clearBtn) els.clearBtn.addEventListener("click", clearAll);

  // --- Init ---
  applySettingsToInputs(els, state.gridConfig, state.settings);
  buildDaysCheckboxes(els.daysGridEl, state.gridConfig, rebuildFromControls);
  rebuildEventDayOptions(els.eventDayEl, state.gridConfig);
  normalizeAllTimeInputs(els, state.gridConfig);
  rebuildTimeSuggestions(els.timeSuggestionsEl, state.gridConfig);

  rebuildFromControls();
  resetForm(els, state);
  setMsg(els.eventMsgEl, "");
});
