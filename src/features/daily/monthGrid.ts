/** Days to show for a month grid starting on Monday (includes leading/trailing days). */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(year, month, 1 - offset);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++)
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  // Drop a trailing week that is entirely next month.
  return days[35]!.getMonth() !== month ? days.slice(0, 35) : days;
}
