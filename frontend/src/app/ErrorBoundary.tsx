import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Errore inatteso della dashboard React',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('mysoc React panel crash', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="app-section">
          <div className="panel-card min-w-0 h-full">
            <div className="panel-header">
              <div>
                <h2>Errore nel pannello React</h2>
                <p>Il resto della dashboard resta operativo. Ricarica la pagina per ripristinare il modulo.</p>
              </div>
            </div>
            <div className="empty-state">{this.state.message}</div>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
