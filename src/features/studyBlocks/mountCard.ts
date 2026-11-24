import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KIND_LABEL, parseStudyBlock, type StudyBlock } from "./model";
import type { StudyCardHost } from "./studyBlocks";

/** Mount a card for a block: its parsed data, or the parse error with "Edit source". */
export function mountCard<B extends StudyBlock>(
  Card: (p: { block: B; host: StudyCardHost }) => ReactNode,
) {
  return (el: HTMLElement, host: StudyCardHost): Root => {
    const root = createRoot(el);
    const parsed = parseStudyBlock(host.kind, host.body);
    root.render(
      parsed.ok
        ? createElement(Card, { block: parsed.block as B, host })
        : createElement(
            "div",
            { className: "study-error", role: "note" },
            createElement("strong", null, `${KIND_LABEL[host.kind]}:`),
            ` line ${parsed.line}: ${parsed.error} `,
            createElement("button", { type: "button", onClick: host.onEditSource }, "Edit source"),
          ),
    );
    return root;
  };
}
