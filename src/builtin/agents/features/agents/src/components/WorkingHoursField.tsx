import { Checkbox } from "../../../../../../design-system/bungalow-79d923";
import { useI18n, type MessageKey } from "../../../../../../i18n/i18n";
import { WEEKDAYS, type WorkingWindow } from "../../../../models/agents";

type T = ReturnType<typeof useI18n>["t"];

const dayShort = (t: T, day: number) => t(`agents.day.${day}` as MessageKey);

/** "Mon–Fri 09:00–17:00" style: days with the same hours are grouped, runs of days joined. */
export function workingHoursSummary(windows: WorkingWindow[], t: T): string {
  if (!windows.length) return t("agents.alwaysWorking");
  const byHours = new Map<string, number[]>();
  for (const w of windows) {
    const key = `${w.start}–${w.end}`;
    byHours.set(key, [...(byHours.get(key) ?? []), w.day]);
  }
  return [...byHours.entries()]
    .map(([hours, days]) => {
      const sorted = [...new Set(days)].sort((a, b) => a - b);
      const runs: string[] = [];
      for (let i = 0; i < sorted.length; ) {
        let j = i;
        while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
        runs.push(j - i >= 2 ? `${dayShort(t, sorted[i])}–${dayShort(t, sorted[j])}` : sorted.slice(i, j + 1).map((d) => dayShort(t, d)).join(", "));
        i = j + 1;
      }
      return `${runs.join(", ")} ${hours}`;
    })
    .join("; ");
}

/**
 * An agent's working hours, a row per weekday: whether it works that day, and from when to when
 * (one window a day; extra windows saved elsewhere are kept as they are).
 */
export function WorkingHoursField({ value, onChange }: { value: WorkingWindow[]; onChange: (value: WorkingWindow[]) => void }) {
  const { t } = useI18n();
  const first = (day: number) => value.find((w) => w.day === day);
  const setDay = (day: number, window: WorkingWindow | null) => {
    const index = value.findIndex((w) => w.day === day);
    const next = value.filter((_, i) => i !== index);
    if (window) next.push(window);
    onChange(next.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)));
  };
  return (
    <div className="agent-hours" role="group" aria-label={t("agents.workingHours")}>
      {WEEKDAYS.map((day) => {
        const window = first(day);
        return (
          <div key={day} className="agent-hours__row">
            <Checkbox
              label={t(`agents.dayLong.${day}` as MessageKey)}
              checked={!!window}
              onChange={(e) => setDay(day, e.target.checked ? { day, start: "09:00", end: "17:00" } : null)}
            />
            {window ? (
              <span className="agent-hours__times">
                <input
                  className="bungalow-input"
                  type="time"
                  aria-label={t("agents.startsAt")}
                  value={window.start}
                  onChange={(e) => setDay(day, { ...window, start: e.target.value })}
                />
                <span aria-hidden="true">–</span>
                <input
                  className="bungalow-input"
                  type="time"
                  aria-label={t("agents.endsAt")}
                  value={window.end === "24:00" ? "23:59" : window.end}
                  onChange={(e) => setDay(day, { ...window, end: e.target.value === "23:59" ? "24:00" : e.target.value })}
                />
              </span>
            ) : (
              <span className="muted">{t("agents.offDuty")}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
