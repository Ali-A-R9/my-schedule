export const STORAGE_EVENTS_V3 = "mySchedule_events_v3";
export const STORAGE_EVENTS_V2 = "mySchedule_v2";
export const STORAGE_SETTINGS = "mySchedule_settings_v1";

export const ALL_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DEFAULT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// Fixed base step for layout & positioning (events are minute-accurate)
export const BASE_STEP_MIN = 15;

export function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function formatTime(mins, use12h, allow24Label = false) {
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

export function orderedWeekDays(weekStart) {
  const idx = ALL_DAYS.indexOf(weekStart);
  return ALL_DAYS.slice(idx).concat(ALL_DAYS.slice(0, idx));
}

/**
 * Parse time input accepting:
 * - 24h: "07:39", "7:39"
 * - 12h: "7:39 AM", "12:05 pm", also "12:00AM"
 * - end-only: "24:00" (only if allow24 = true)
 */
export function parseTimeAny(str, { allow24 }) {
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

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

export function minutesTo24h(mins) {
  const safe = ((mins % 1440) + 1440) % 1440;
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function minutesToInputString(mins, use12h, allow24) {
  // 24h mode: no AM/PM
  if (!use12h) {
    return mins === 1440 && allow24 ? "24:00" : minutesTo24h(mins);
  }
  // 12h mode: MUST include AM/PM
  return formatTime(mins, true, allow24);
}
