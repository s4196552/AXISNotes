import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { formatDate, sameDay } from "../../lib/dates";
import { dailyNotePath, openDailyNote } from "../commands/actions";
import { monthGrid } from "./monthGrid";
import "./calendar.css";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function Calendar({ today = new Date() }: { today?: Date }) {
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
              aria-label={`${formatDate(d, "dddd, MMMM D, YYYY")}${existing.has(path) ? " (has note)" : ""}`}
              onClick={() => void openDailyNote(d)}
            >
              {d.getDate()}
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
