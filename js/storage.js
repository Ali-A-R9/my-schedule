import { STORAGE_EVENTS_V3, STORAGE_EVENTS_V2, STORAGE_SETTINGS, DEFAULT_DAYS } from "./time.js";

export function loadEvents() {
  for (const key of [STORAGE_EVENTS_V3, STORAGE_EVENTS_V2]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
  }
  return [];
}

export function saveEvents(events) {
  localStorage.setItem(STORAGE_EVENTS_V3, JSON.stringify(events));
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS);
    if (!raw) {
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

export function saveSettings(payload) {
  localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(payload));
}

export function downloadTextFile(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

export async function readJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}
