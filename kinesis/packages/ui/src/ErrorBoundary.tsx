'use client';

import { Component, type ReactNode } from 'react';
import { ErrorState } from './ErrorState';

type Props = {
  children: ReactNode;
  onError?: (err: unknown) => void;
};
type State = { err: unknown | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: unknown): State {
    return { err };
  }

  componentDidCatch(err: unknown) {
    // eslint-disable-next-line no-console
    console.error('[kinesis:error-boundary]', err);
    this.props.onError?.(err);
  }

  render() {
    if (this.state.err) {
      return (
        <ErrorState
          title="The app hit a snag"
          message="Something unexpected happened. Reload to get back on your feet."
          onRetry={() => {
            this.setState({ err: null });
            if (typeof window !== 'undefined') window.location.reload();
          }}
        />
      );
    }
    return this.props.children;
  }
}
