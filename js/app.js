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
  buildRepeatDaysCheckboxes,
  getRepeatDaysSelected,
  setRepeatDaysSelected,
} from "./ui.js";
import { exportElementAsPng } from "./export.js";

export class App {
  constructor() {
    this.els = getElements();

    this.state = {
      events: loadEvents(),
      editingId: null,
      settings: loadSettings(),
      gridConfig: {
        startMinutes: 0,
        endMinutes: 1439,
        gridLinesMinutes: 30,
        weekStart: "Mon",
        use12h: true,
        days: DEFAULT_DAYS.slice(),
      },
      dayHeaderEls: new Map(),
    };
  }

  init() {
    const year = new Date().getFullYear();
    const footerCopy = document.getElementById("footerCopy");
    if (footerCopy) footerCopy.textContent = `© ${year} ! K9 - My Schedule.`;

    const s = this.state.settings;
    this.state.gridConfig.use12h = !!s.use12h;
    this.state.gridConfig.weekStart = s.weekStart ?? "Mon";
    this.state.gridConfig.gridLinesMinutes = Number(s.gridLines ?? 30);
    this.state.gridConfig.days = Array.isArray(s.days) && s.days.length ? s.days : DEFAULT_DAYS.slice();

    this.state.gridConfig.startMinutes = parseTimeAny(s.gridStart, { allow24: false }) ?? 0;
    this.state.gridConfig.endMinutes = parseTimeAny(s.gridEnd, { allow24: true }) ?? 1439;

    applySettingsToInputs(this.els, this.state.gridConfig, this.state.settings);
    buildDaysCheckboxes(this.els.daysGridEl, this.state.gridConfig, () => this.rebuildFromControls());
    rebuildEventDayOptions(this.els.eventDayEl, this.state.gridConfig);
    normalizeAllTimeInputs(this.els, this.state.gridConfig);
    rebuildTimeSuggestions(this.els.timeSuggestionsEl, this.state.gridConfig);

    buildRepeatDaysCheckboxes(this.els.repeatDaysEl, this.state.gridConfig, () => {});
    setRepeatDaysSelected([this.els.eventDayEl.value || this.state.gridConfig.days[0]]);

    this.wire();

    this.rebuildFromControls();
    resetForm(this.els, this.state);
    setMsg(this.els.eventMsgEl, "");
  }

  wire() {
    const els = this.els;

    els.buildGridBtn.addEventListener("click", () => this.rebuildFromControls());

    els.weekStartEl.addEventListener("change", () => {
      this.state.gridConfig.weekStart = els.weekStartEl.value;
      buildDaysCheckboxes(els.daysGridEl, this.state.gridConfig, () => this.rebuildFromControls());
      this.rebuildFromControls();
    });

    els.slotMinutesEl.addEventListener("change", () => this.rebuildFromControls());

    els.fmt24Btn.addEventListener("click", () => this.setUse12h(false));
    els.fmt12Btn.addEventListener("click", () => this.setUse12h(true));

    els.gridStartEl.addEventListener("blur", () =>
      normalizeTimeInput(els.gridStartEl, this.state.gridConfig, { allow24: false })
    );
    els.gridEndEl.addEventListener("blur", () =>
      normalizeTimeInput(els.gridEndEl, this.state.gridConfig, { allow24: true })
    );
    els.eventStartEl.addEventListener("blur", () =>
      normalizeTimeInput(els.eventStartEl, this.state.gridConfig, { allow24: false })
    );
    els.eventEndEl.addEventListener("blur", () =>
      normalizeTimeInput(els.eventEndEl, this.state.gridConfig, { allow24: true })
    );

    // UX improvement:
    // If user changes the Day dropdown and they haven't checked any repeat days,
    // keep repeat selection synced to that single day.
    els.eventDayEl.addEventListener("change", () => {
      if (this.state.editingId) return;
      const repeat = getRepeatDaysSelected();
      if (repeat.length === 0) setRepeatDaysSelected([els.eventDayEl.value]);
    });

    els.saveEventBtn.addEventListener("click", (e) => {
      e.preventDefault();
      this.addOrUpdateEvent();
    });

    els.deleteEventBtn.addEventListener("click", (e) => {
      e.preventDefault();
      this.deleteEditingEvent();
    });

    els.cancelEditBtn.addEventListener("click", (e) => {
      e.preventDefault();
      resetForm(els, this.state);
      setMsg(els.eventMsgEl, "");
    });

    els.gridEl.addEventListener("click", (e) => this.onGridClick(e));

    window.addEventListener("resize", () => this.render());

    if (els.exportBtn) els.exportBtn.addEventListener("click", () => this.exportJSON());
    if (els.exportPngBtn) els.exportPngBtn.addEventListener("click", () => this.exportPNG());

    if (els.importFile) {
      els.importFile.addEventListener("change", async () => {
        const file = els.importFile.files?.[0];
        if (!file) return;

        try {
          await this.importJSONFile(file);
        } catch (err) {
          setMsg(els.eventMsgEl, "Import failed: " + (err?.message ?? "Unknown error"), true);
        } finally {
          els.importFile.value = "";
        }
      });
    }

    if (els.clearBtn) els.clearBtn.addEventListener("click", () => this.clearAll());
  }

  persistSettingsFromUI() {
    const els = this.els;
    const g = this.state.gridConfig;

    const payload = {
      use12h: g.use12h,
      weekStart: g.weekStart,
      gridStart: els.gridStartEl.value.trim() || (g.use12h ? "12:00 AM" : "00:00"),
      gridEnd: els.gridEndEl.value.trim() || (g.use12h ? "11:59 PM" : "23:59"),
      gridLines: g.gridLinesMinutes,
      days: g.days,
    };

    saveSettings(payload);
  }

  render() {
    const els = this.els;
    const g = this.state.gridConfig;

    this.state.dayHeaderEls = buildGrid({ gridEl: els.gridEl, gridConfig: g });

    renderEvents({
      gridEl: els.gridEl,
      events: this.state.events,
      gridConfig: g,
      dayHeaderEls: this.state.dayHeaderEls,
      onEdit: (id) => {
        startEdit(els, this.state, id);
        setMsg(els.eventMsgEl, "Editing: Save Changes or Delete.");
      },
    });
  }

  setUse12h(v) {
    const els = this.els;
    const g = this.state.gridConfig;

    g.use12h = v;
    els.fmt12Btn.classList.toggle("active", v);
    els.fmt24Btn.classList.toggle("active", !v);

    normalizeAllTimeInputs(els, g);
    rebuildTimeSuggestions(els.timeSuggestionsEl, g);

    this.render();
    this.persistSettingsFromUI();
  }

  rebuildFromControls() {
    const els = this.els;
    const g = this.state.gridConfig;

    g.weekStart = els.weekStartEl.value;

    const selectedDays = getSelectedDaysOrdered(g);
    if (selectedDays.length === 0) {
      els.gridEl.innerHTML = `<div style="padding:12px;color:rgba(239,68,68,0.95);">Select at least one day.</div>`;
      return;
    }
    g.days = selectedDays;

    g.gridLinesMinutes = Number(els.slotMinutesEl.value);

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

    g.startMinutes = start;
    g.endMinutes = end;

    normalizeAllTimeInputs(els, g);

    buildDaysCheckboxes(els.daysGridEl, g, () => this.rebuildFromControls());
    rebuildEventDayOptions(els.eventDayEl, g);
    rebuildTimeSuggestions(els.timeSuggestionsEl, g);

    buildRepeatDaysCheckboxes(els.repeatDaysEl, g, () => {});
    if (!this.state.editingId) setRepeatDaysSelected([els.eventDayEl.value || g.days[0]]);

    this.render();
    resetForm(els, this.state);
    setMsg(els.eventMsgEl, "");
    this.persistSettingsFromUI();
  }

  readEventTimes() {
    const els = this.els;
    const start = parseTimeAny(els.eventStartEl.value, { allow24: false });
    const end = parseTimeAny(els.eventEndEl.value, { allow24: true });
    if (start == null) return { error: "Invalid start time." };
    if (end == null) return { error: "Invalid end time." };
    return { start, end };
  }

  addOrUpdateEvent() {
    const els = this.els;
    const g = this.state.gridConfig;

    const title = els.eventTitleEl.value.trim();
    const day = els.eventDayEl.value;
    const color = els.eventColorEl.value;

    if (!title) return setMsg(els.eventMsgEl, "Please enter a title.", true);

    const { start, end, error } = this.readEventTimes();
    if (error) return setMsg(els.eventMsgEl, error, true);
    if (end <= start) return setMsg(els.eventMsgEl, "End time must be after start time.", true);

    if (start < g.startMinutes || end > g.endMinutes) {
      return setMsg(els.eventMsgEl, "Event must be inside the visible grid time range.", true);
    }

    // Editing stays single-day
    if (this.state.editingId) {
      const candidate = { day, start, end, title, color };

      if (hasConflict(this.state.events, candidate, this.state.editingId)) {
        return setMsg(els.eventMsgEl, "Conflict: overlaps an existing event on this day.", true);
      }

      this.state.events = this.state.events.map((ev) =>
        ev.id === this.state.editingId ? { ...ev, ...candidate } : ev
      );
      saveEvents(this.state.events);
      this.render();
      setMsg(els.eventMsgEl, "Saved.");
      resetForm(els, this.state);
      return;
    }

    // Adding: realistic repeat behavior
    const checked = getRepeatDaysSelected().filter((d) => g.days.includes(d));
    const targetDays = checked.length > 0 ? checked : [day];

    const conflicts = [];
    const added = [];

    for (const d of targetDays) {
      const candidate = { day: d, start, end, title, color };
      if (hasConflict(this.state.events, candidate, null)) {
        conflicts.push(d);
      } else {
        this.state.events.push({ id: uid(), ...candidate });
        added.push(d);
      }
    }

    if (added.length > 0) {
      saveEvents(this.state.events);
      this.render();
    }

    if (added.length === 0) {
      return setMsg(
        els.eventMsgEl,
        `Could not add: conflict on ${conflicts.join(", ")}.`,
        true
      );
    }

    if (conflicts.length > 0) {
      setMsg(
        els.eventMsgEl,
        `Added to ${added.join(", ")}. Skipped (conflict): ${conflicts.join(", ")}.`,
        true
      );
    } else {
      setMsg(els.eventMsgEl, added.length === 1 ? "Added." : `Added to ${added.length} days ✅`);
    }

    resetForm(els, this.state);
  }

  deleteEditingEvent() {
    const els = this.els;
    if (!this.state.editingId) return;

    this.state.events = this.state.events.filter((ev) => ev.id !== this.state.editingId);
    saveEvents(this.state.events);
    this.render();
    setMsg(els.eventMsgEl, "Deleted.");
    resetForm(els, this.state);
  }

  onGridClick(e) {
    const els = this.els;
    handleGridClickToPrefill({
      event: e,
      gridEl: els.gridEl,
      gridConfig: this.state.gridConfig,
      dayHeaderEls: this.state.dayHeaderEls,
      onPrefill: ({ day, start, end }) => {
        els.eventDayEl.value = day;
        els.eventStartEl.value = minutesToInputString(start, this.state.gridConfig.use12h, false);
        els.eventEndEl.value = minutesToInputString(end, this.state.gridConfig.use12h, true);

        if (!this.state.editingId) setRepeatDaysSelected([day]);

        els.eventTitleEl.focus();
        setMsg(
          els.eventMsgEl,
          `Picked ${day} at ${formatTime(start, this.state.gridConfig.use12h, false)}.`
        );
      },
    });
  }

  exportJSON() {
    const els = this.els;
    const g = this.state.gridConfig;

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        use12h: g.use12h,
        weekStart: g.weekStart,
        gridStart: els.gridStartEl.value.trim(),
        gridEnd: els.gridEndEl.value.trim(),
        gridLinesMinutes: g.gridLinesMinutes,
        days: g.days,
      },
      events: this.state.events,
    };

    downloadTextFile("my-schedule.json", JSON.stringify(payload, null, 2));
    setMsg(els.eventMsgEl, "Exported my-schedule.json");
  }

  async importJSONFile(file) {
    const els = this.els;

    const payload = await readJsonFile(file);
    const normalized = normalizeImportedPayload(payload);

    this.state.events = normalized.events;
    saveEvents(this.state.events);

    if (normalized.settings) {
      const s = normalized.settings;

      if (typeof s.weekStart === "string" && ALL_DAYS.includes(s.weekStart)) {
        els.weekStartEl.value = s.weekStart;
        this.state.gridConfig.weekStart = s.weekStart;
      }

      if (typeof s.gridStart === "string") els.gridStartEl.value = s.gridStart;
      if (typeof s.gridEnd === "string") els.gridEndEl.value = s.gridEnd;

      if (Number.isFinite(s.gridLinesMinutes)) {
        els.slotMinutesEl.value = String(s.gridLinesMinutes);
        this.state.gridConfig.gridLinesMinutes = Number(s.gridLinesMinutes);
      }

      if (Array.isArray(s.days) && s.days.length) {
        this.state.gridConfig.days = s.days;
      }

      if (typeof s.use12h === "boolean") {
        this.setUse12h(s.use12h);
      }
    }

    this.rebuildFromControls();
    setMsg(els.eventMsgEl, "Imported schedule ✅");
  }

  clearAll() {
    const ok = confirm("Delete all events? This cannot be undone.");
    if (!ok) return;

    this.state.events = [];
    saveEvents(this.state.events);
    this.render();
    resetForm(this.els, this.state);
    setMsg(this.els.eventMsgEl, "All events cleared.");
  }

  async exportPNG() {
    const els = this.els;

    try {
      setMsg(els.eventMsgEl, "Generating PNG…");

      const grid = document.getElementById("grid");
      if (!grid) throw new Error("Grid not found.");

      await exportElementAsPng(grid, { filename: "my-schedule.png", scale: 2 });

      setMsg(els.eventMsgEl, "Exported my-schedule.png ✅");
    } catch (err) {
      setMsg(els.eventMsgEl, "PNG export failed: " + (err?.message ?? "Unknown error"), true);
    }
  }
}
