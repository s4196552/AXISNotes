import { useEffect, useState } from "react";

// Side panels slide in and out. A closing panel stays mounted (hidden from assistive
// technology and inert) until its slide finishes, then unmounts.

/** How long a side panel takes to slide; matches `.shell`'s transition in app.css. */
export const SLIDE_MS = 180;

/** True while `show` is true, and for `ms` after it turns false. */
export function usePresence(show: boolean, ms = SLIDE_MS): boolean {
  const [prevShow, setPrevShow] = useState(show);
  const [closing, setClosing] = useState(false);
  if (show !== prevShow) {
    // Adjusting state while rendering, so a reopened panel never flickers out.
    setPrevShow(show);
    setClosing(!show);
  }
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => setClosing(false), ms);
    return () => window.clearTimeout(t);
  }, [closing, ms]);
  return show || closing;
}
