import { Component, type ReactNode } from "react";

export class StudioErrorBoundary extends Component<
  { children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch() {
    // Keep project content and credentials out of automatic diagnostic logs.
    console.error("Remote Studio could not render its interface.");
  }

  render() {
    if (this.state.error)
      return (
        <div className="startup" role="alert">
          <h1>Remote Studio needs to reload</h1>
          <p>
            The interface encountered an error. Your saved work is preserved.
          </p>
          <pre className="startup-error">
            {this.state.error.message.slice(0, 1000)}
          </pre>
          <button
            className="startup-reload"
            onClick={() => window.location.reload()}
          >
            Reload Remote Studio
          </button>
        </div>
      );
    return this.props.children;
  }
}
