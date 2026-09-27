import { useEffect } from "react";
import { backend } from "../../ipc";
import { useAppStore } from "../../app/store";

/** Show a notice whenever the browser extension saves a clip. */
export function useClipNotices() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let gone = false;
    void backend
      .onClipped((c) => useAppStore.getState().notify(`Clipped “${c.title}” to ${c.path}`))
      .then((u) => (gone ? u() : (unlisten = u)));
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);
}
