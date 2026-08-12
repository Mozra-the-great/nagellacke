import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { STORAGE_KEY } from '../useAppData';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unbehandelter Fehler beim Rendern:', error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  // Drops the locally cached collection (which a corrupted sync can have
  // written) so the next load starts clean instead of crashing again with
  // the same bad record - see #218.
  private handleResetLocal = () => {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className={styles.boundary} role="alert">
          <p className={styles.title}>Etwas ist schiefgelaufen</p>
          <p className={styles.message}>
            Ein Eintrag konnte nicht angezeigt werden{error.message ? `: ${error.message}` : '.'}
          </p>
          <div className={styles.actions}>
            <button className={styles.btn} onClick={this.handleReload}>Neu laden</button>
            <button className={styles.btn} onClick={this.handleResetLocal}>Lokale Daten zurücksetzen</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
