import { useEffect, useRef, useState } from "react";
import { backend, isBackendError, type AiProviderStatus } from "../../ipc";

export function SubscriptionConnection({
  provider,
  reload,
}: {
  provider: AiProviderStatus;
  reload(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef(true);
  const signingIn = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (signingIn.current) void backend.aiSubscriptionCancel(provider.id).catch(() => {});
    };
  }, [provider.id]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      if (active.current)
        setMessage(
          isBackendError(e)
            ? e.message
            : "Could not update the ChatGPT connection. Please try again.",
        );
    } finally {
      if (active.current) {
        setBusy(false);
        reload();
      }
    }
  };
  return (
    <div>
      <p className="settings-hint muted">
        Use your eligible ChatGPT Plus or Pro allowance. Limits are shared with other apps using
        your plan. This connection never switches to a paid API key automatically. OpenAI
        eligibility and usage limits apply. Manage usage controls your ChatGPT plan and credit
        limits.
      </p>
      <p role="status">
        {provider.hasKey
          ? `Using ChatGPT plan${provider.account ? ` · ${provider.account}` : ""}`
          : "ChatGPT plan not connected"}
      </p>
      <div className="ai-provider-row">
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              signingIn.current = true;
              try {
                await backend.aiSubscriptionSignIn(provider.id);
              } finally {
                signingIn.current = false;
              }
            })
          }
        >
          {busy ? "Waiting for ChatGPT…" : "Continue with ChatGPT"}
        </button>
        {busy && (
          <button
            onClick={() =>
              void backend
                .aiSubscriptionCancel(provider.id)
                .catch(() =>
                  setMessage("Could not cancel sign-in. Please close the browser sign-in page."),
                )
            }
          >
            Cancel sign-in
          </button>
        )}
        {provider.hasKey && (
          <button
            disabled={busy}
            onClick={() => void run(() => backend.aiSubscriptionDisconnect(provider.id))}
          >
            Disconnect
          </button>
        )}
        <button
          onClick={() =>
            void backend
              .aiSubscriptionUsage()
              .catch((e: unknown) =>
                setMessage(isBackendError(e) ? e.message : "Open ChatGPT Settings → Usage."),
              )
          }
        >
          Manage usage
        </button>
      </div>
      {message && (
        <p role="alert" className="ai-error">
          {message}
        </p>
      )}
    </div>
  );
}
