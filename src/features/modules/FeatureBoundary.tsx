import { Component, type ReactNode } from "react";
import { useUi } from "../commands/ui";
export class FeatureBoundary extends Component<
  { name: string; children: ReactNode; onDismiss?(): void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="empty muted" role="alert">
          <p>{this.props.name} could not load. Your files and history are preserved.</p>
          <p>Save your work, then reload AXISNotes to retry this feature.</p>
          {this.props.onDismiss && <button onClick={this.props.onDismiss}>Dismiss</button>}
          <button onClick={() => useUi.getState().open({ kind: "settings", section: "features" })}>
            Feature settings
          </button>
        </div>
      );
    return this.props.children;
  }
}
