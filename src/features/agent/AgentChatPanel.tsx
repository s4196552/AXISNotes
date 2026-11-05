import { useState } from "react";
import { Copy, CornerDownLeft, FileText, MessageSquarePlus, Square, X } from "lucide-react";
import type { AgentChatView } from "../../ipc";

// The icon under the Agent and, once clicked, its Quick Chat panel. Used by the Agent's
// own window and by the in-page Agent in a browser; actions go through `on`.

export interface ChatActions {
  open(): void;
  close(): void;
  send(text: string): void;
  stop(): void;
  useNote(on: boolean): void;
  draft(): void;
}

export function AgentChatButton({ on, open }: { on: ChatActions; open: boolean }) {
  return (
    <button
      type="button"
      className="agent-chat-button"
      aria-label={open ? "Close Quick Chat" : "Ask the Agent"}
      title={open ? "Close Quick Chat" : "Ask the Agent"}
      aria-expanded={open}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={() => (open ? on.close() : on.open())}
    >
      {open ? <X size={16} /> : <MessageSquarePlus size={16} />}
    </button>
  );
}

export function AgentChatPanel({ chat, on }: { chat: AgentChatView; on: ChatActions }) {
  const [text, setText] = useState("");
  const send = () => {
    if (!text.trim() || chat.running) return;
    on.send(text);
    setText("");
  };
  return (
    <div
      className="agent-chat"
      role="dialog"
      aria-label="Quick Chat"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") on.close();
      }}
    >
      <div className="agent-chat-input">
        <textarea
          aria-label="Ask the Agent"
          placeholder="Ask the Agent…"
          autoFocus
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {chat.running ? (
          <button type="button" aria-label="Stop" onClick={on.stop}>
            <Square size={13} />
          </button>
        ) : (
          <button type="button" aria-label="Send" disabled={!text.trim()} onClick={send}>
            <CornerDownLeft size={14} />
          </button>
        )}
      </div>
      {chat.noteName && (
        <button
          type="button"
          className="agent-chat-scope"
          aria-pressed={chat.useNote}
          onClick={() => on.useNote(!chat.useNote)}
          title={
            chat.useNote
              ? "The Agent reads this note. Click to leave it out."
              : "Click to let the Agent read this note."
          }
        >
          {chat.useNote ? "Reads: " : "Not reading: "}
          {chat.noteName}
        </button>
      )}
      {(chat.question || chat.error) && (
        <div className="agent-chat-answer" aria-label="Answer" aria-busy={chat.running}>
          {chat.question && <p className="agent-chat-q">{chat.question}</p>}
          {chat.running && !chat.answer && <p className="agent-chat-muted">Thinking…</p>}
          {chat.answer && <p className="agent-chat-a">{chat.answer}</p>}
          {chat.error && (
            <p className="agent-chat-error" role="alert">
              {chat.error}
            </p>
          )}
        </div>
      )}
      {chat.answer && !chat.running && (
        <div className="agent-chat-actions">
          <button type="button" onClick={on.draft}>
            <FileText size={13} /> Open as draft
          </button>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(chat.answer)}>
            <Copy size={13} /> Copy
          </button>
        </div>
      )}
    </div>
  );
}
