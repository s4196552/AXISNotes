// STUB — replaced by task T-004 (Codex). Contract: see .agents/briefs/T-004.md.
import { useEffect, useState } from "react";
import { backend } from "../../ipc";

export interface EditorProps {
  /** Vault-relative path of the note to edit. The parent remounts on path change. */
  path: string;
}

export function Editor({ path }: EditorProps) {
  const [text, setText] = useState("");
  useEffect(() => {
    backend.readFile(path).then((f) => setText(f.content));
  }, [path]);
  return <pre>{text}</pre>;
}
