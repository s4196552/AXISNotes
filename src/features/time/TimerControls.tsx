import { useEffect, useState } from "react";
import { Play, Square, Timer } from "lucide-react";
import { useAppStore } from "../../app/store";
import { useTimer } from "./timer";
import { durationMs, formatClock } from "./timeLog";
import { noteLabel } from "./report";
import "./time.css";

/** Re-render every second while `on`. */
function useTick(on: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setN((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [on]);
}

/** Start/stop timing a note (editor header). */
export function TimerButton({ path }: { path: string }) {
  const running = useTimer((s) => s.running);
  const here = running?.path === path && !running.task;
  useTick(here);
  if (here) {
    return (
      <button
        className="editor-tool active timer-button"
        aria-label="Stop timer"
        title="Stop timer"
        onClick={() => void useTimer.getState().stop()}
      >
        <Square size={13} /> {formatClock(durationMs(running))}
      </button>
    );
  }
  return (
    <button
      className="editor-tool timer-button"
      aria-label="Start timer"
      title="Track time on this note (saved in its time_log)"
      onClick={() => void useTimer.getState().start(path)}
    >
      <Timer size={15} />
    </button>
  );
}

/** Start/stop timing a task (tasks view). */
export function TaskTimerButton({ path, task }: { path: string; task: string }) {
  const running = useTimer((s) => s.running);
  const here = running?.path === path && running.task === task;
  return (
    <button
      className={`tasks-timer${here ? " active" : ""}`}
      aria-label={here ? `Stop timer: ${task}` : `Start timer: ${task}`}
      title={here ? "Stop timer" : "Track time on this task"}
      onClick={() =>
        void (here ? useTimer.getState().stop() : useTimer.getState().start(path, task))
      }
    >
      {here ? <Square size={11} /> : <Play size={11} />}
    </button>
  );
}

/** The running timer, in the status bar. */
export function RunningTimer() {
  const running = useTimer((s) => s.running);
  useTick(!!running);
  if (!running) return null;
  const label = noteLabel(running.path) + (running.task ? ` · ${running.task}` : "");
  return (
    <span className="running-timer" role="timer" aria-label={`Timer: ${label}`}>
      <button
        className="running-timer-label"
        title="Open the note"
        onClick={() => useAppStore.getState().openFile(running.path)}
      >
        <Timer size={12} /> {label}
      </button>
      <span className="running-timer-clock">{formatClock(durationMs(running))}</span>
      <button
        className="running-timer-stop"
        aria-label="Stop timer"
        onClick={() => void useTimer.getState().stop()}
      >
        <Square size={11} />
      </button>
    </span>
  );
}
