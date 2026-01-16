import { ALL_DAYS, overlaps } from "./time.js";

export function uid() {
  return (crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random()}`).toString();
}

export function hasConflict(events, candidate, ignoreId = null) {
  return events.some((ev) => {
    if (ignoreId && ev.id === ignoreId) return false;
    if (ev.day !== candidate.day) return false;
    return overlaps(candidate.start, candidate.end, ev.start, ev.end);
  });
}

/**
 * Validates imported payload and returns:
 * { events: [...], settings?: {...} }
 */
export function normalizeImportedPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid file.");
  if (!Array.isArray(payload.events)) throw new Error("Missing events.");

  const normalizedEvents = payload.events
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

  const out = { events: normalizedEvents };

  if (payload.settings && typeof payload.settings === "object") {
    const s = payload.settings;
    out.settings = {
      use12h: typeof s.use12h === "boolean" ? s.use12h : undefined,
      weekStart: typeof s.weekStart === "string" ? s.weekStart : undefined,
      gridStart: typeof s.gridStart === "string" ? s.gridStart : undefined,
      gridEnd: typeof s.gridEnd === "string" ? s.gridEnd : undefined,
      gridLinesMinutes: Number.isFinite(Number(s.gridLinesMinutes)) ? Number(s.gridLinesMinutes) : undefined,
      days: Array.isArray(s.days) ? s.days.filter((d) => ALL_DAYS.includes(d)) : undefined,
    };
  }

  return out;
}
