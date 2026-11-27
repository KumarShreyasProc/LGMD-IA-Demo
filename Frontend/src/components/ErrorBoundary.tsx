import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  what: string;                 // "this page", "this visual", ...
  children: ReactNode;
  resetKey?: string;            // a new value clears the error (e.g. another page or visual setting)
  actions?: { label: string; run: () => void }[];
}

/**
 * Without this, any error while rendering unmounts the whole app and leaves a white screen.
 * Shows what failed instead, logs the details to the browser console, and offers a way out.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null; key?: string }> {
  state: { error: Error | null; key?: string } = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: { error: Error | null; key?: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Error showing ${this.props.what}:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-box" role="alert">
        <p><strong>Something went wrong showing {this.props.what}.</strong></p>
        <p className="muted">Error: {error.message || String(error)}</p>
        <div className="error-actions">
          {(this.props.actions ?? []).map((a) => (
            <button key={a.label} type="button" className="filter-btn" onClick={() => { a.run(); this.setState({ error: null }); }}>{a.label}</button>
          ))}
          <button type="button" className="filter-btn" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      </div>
    );
  }
}
