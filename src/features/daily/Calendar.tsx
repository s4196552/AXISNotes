import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { formatDate, sameDay } from "../../lib/dates";
import { dailyNotePath, openDailyNote } from "../commands/actions";
import { monthGrid } from "./monthGrid";
import "./calendar.css";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * The daily-note month view. `marks` (by `YYYY-MM-DD`) puts a count on days, e.g. open
 * tasks due; the dashboard passes it and the sidebar doesn't.
 */
export function Calendar({
  today = new Date(),
  marks,
}: {
  today?: Date;
  marks?: ReadonlyMap<string, number>;
}) {
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const notes = useAppStore((s) => s.notes);
  const activePath = useAppStore((s) => s.activePath);
  const dailyCfg = useConfig((s) => s.config.dailyNotes);

  const existing = useMemo(() => new Set(notes.map((n) => n.path)), [notes]);
  const days = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  const shift = (months: number) =>
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + months, 1));

  return (
    <section className="calendar" aria-label="Daily notes calendar">
      <header className="calendar-header">
        <button aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft size={14} />
        </button>
        <span className="calendar-title">{formatDate(cursor, "MMMM YYYY")}</span>
        <button aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight size={14} />
        </button>
      </header>
      <div className="calendar-grid" role="grid">
        {WEEKDAYS.map((d) => (
          <span key={d} className="calendar-weekday" role="columnheader">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const path = dailyNotePath(d, dailyCfg);
          const due = marks?.get(formatDate(d, "YYYY-MM-DD")) ?? 0;
          const classes = [
            "calendar-day",
            d.getMonth() !== cursor.getMonth() && "outside",
            sameDay(d, today) && "today",
            existing.has(path) && "has-note",
            activePath === path && "active",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={d.toISOString()}
              role="gridcell"
              className={classes}
              aria-label={`${formatDate(d, "dddd, MMMM D, YYYY")}${existing.has(path) ? " (has note)" : ""}${due ? `, ${due} task${due === 1 ? "" : "s"} due` : ""}`}
              onClick={() => void openDailyNote(d)}
            >
              {d.getDate()}
              {due > 0 && (
                <span className="calendar-due" aria-hidden>
                  {due}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button className="calendar-today" onClick={() => void openDailyNote(today)}>
        Today
      </button>
    </section>
  );
}
