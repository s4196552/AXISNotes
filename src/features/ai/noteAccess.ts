import type { AiRule } from "../../ipc";
import { stricter } from "../../lib/aiAccess";
import { ruleForPath } from "./folderScope";

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** The rules that apply to a note: its own, its folder's, its file's mark and the result. */
export function noteAccess(
  folders: Record<string, AiRule>,
  path: string,
  mark: AiRule | undefined,
): { own: AiRule | null; inherited: AiRule; mark: AiRule | null; effective: AiRule } {
  const own = folders[path] ?? null;
  const inherited = ruleForPath(folders, parentOf(path));
  const effective = stricter(own ?? inherited, mark ?? "any");
  return { own, inherited, mark: mark ?? null, effective };
}
