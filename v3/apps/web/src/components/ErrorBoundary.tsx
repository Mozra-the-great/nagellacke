import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { STORAGE_KEY } from '../useAppData';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  confirmingReset: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, confirmingReset: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Still logged, and loudly: a boundary that silently swallows a render error
    // turns a real bug into a tidy-looking fallback nobody investigates.
    console.error('Unbehandelter Fehler beim Rendern:', error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  // Drops the locally cached collection (which a corrupted sync can have written) so
  // the next load starts clean instead of crashing again on the same bad record - see
  // #218. Behind a confirmation because it is only harmless *with* server sync, where
  // the next sync pulls everything back. Used purely locally, this is the collection.
  private handleResetLocal = () => {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  };

  render() {
    const { error, confirmingReset } = this.state;
    if (error) {
      return (
        <div className={styles.boundary} role="alert">
          <p className={styles.title}>Etwas ist schiefgelaufen</p>
          <p className={styles.message}>
            Ein Eintrag konnte nicht angezeigt werden{error.message ? `: ${error.message}` : '.'}
          </p>
          {confirmingReset ? (
            <>
              <p className={styles.warning}>
                Achtung: Das löscht die lokal gespeicherte Sammlung auf diesem Gerät. Mit
                eingerichtetem Server-Sync holt der nächste Sync alles zurück — ohne Sync
                sind die Daten weg.
              </p>
              <div className={styles.actions}>
                <button className={styles.btn} onClick={this.handleResetLocal}>
                  Ja, lokale Daten löschen
                </button>
                <button className={styles.btn} onClick={() => this.setState({ confirmingReset: false })}>
                  Abbrechen
                </button>
              </div>
            </>
          ) : (
            <div className={styles.actions}>
              <button className={styles.btn} onClick={this.handleReload}>Neu laden</button>
              <button className={styles.btn} onClick={() => this.setState({ confirmingReset: true })}>
                Lokale Daten zurücksetzen
              </button>
            </div>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
