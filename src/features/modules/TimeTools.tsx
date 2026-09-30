import { FeatureBoundary } from "./FeatureBoundary";
import { Suspense } from "react";
import { lazyNamed } from "../../app/lazy";
import { useFeatureEnabled } from "./features";
const NoteTimer = lazyNamed(() => import("../time/TimerControls"), "TimerButton");
const TaskTimer = lazyNamed(() => import("../time/TimerControls"), "TaskTimerButton");
const StatusTimer = lazyNamed(() => import("../time/TimerControls"), "RunningTimer");
export function TimerButton(props: { path: string }) {
  return useFeatureEnabled("timeTracking") ? (
    <FeatureBoundary name="Time tracking">
      <Suspense fallback={null}>
        <NoteTimer {...props} />
      </Suspense>
    </FeatureBoundary>
  ) : null;
}
export function TaskTimerButton(props: { path: string; task: string }) {
  return useFeatureEnabled("timeTracking") ? (
    <FeatureBoundary name="Time tracking">
      <Suspense fallback={null}>
        <TaskTimer {...props} />
      </Suspense>
    </FeatureBoundary>
  ) : null;
}
export function RunningTimer() {
  return useFeatureEnabled("timeTracking") ? (
    <FeatureBoundary name="Time tracking">
      <Suspense fallback={null}>
        <StatusTimer />
      </Suspense>
    </FeatureBoundary>
  ) : null;
}
