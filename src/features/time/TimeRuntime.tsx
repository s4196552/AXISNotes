import { useEffect } from "react";
import { useTimer } from "./timer";
// Mounted only after the current vault config loads, and only while enabled.
export function TimeRuntime() {
  useEffect(() => {
    void useTimer.getState().restore();
    return () => useTimer.getState().suspend();
  }, []);
  return null;
}
