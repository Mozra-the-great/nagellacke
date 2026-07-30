import { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import styles from './Snackbar.module.css';

interface SnackbarState {
  message: string;
  undoFn?: () => void;
  commitFn?: () => void;
  id: number;
}

interface SnackbarContextValue {
  showSnackbar: (message: string, undoFn?: () => void, commitFn?: () => void) => void;
}

const SnackbarContext = createContext<SnackbarContextValue>({ showSnackbar: () => {} });

export function useSnackbar(): SnackbarContextValue {
  return useContext(SnackbarContext);
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snack, setSnack] = useState<SnackbarState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held outside React state so a pending commit can be flushed synchronously
  // without running side effects inside a state updater.
  const pendingCommitRef = useRef<(() => void) | null>(null);

  // Runs the outstanding commit (if any) and disarms its timer. Idempotent:
  // the ref is cleared first, so a later flush can't run the same commit twice.
  const flushPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const commit = pendingCommitRef.current;
    pendingCommitRef.current = null;
    commit?.();
  }, []);

  const showSnackbar = useCallback((message: string, undoFn?: () => void, commitFn?: () => void) => {
    // A second delete before the first snackbar times out replaces it, taking
    // away that item's undo affordance — so treat the outgoing snack as
    // implicitly committed rather than dropping its cleanup (which used to
    // orphan the first item's photo on the server).
    flushPending();
    const id = Date.now();
    pendingCommitRef.current = commitFn ?? null;
    setSnack({ message, undoFn, commitFn, id });
    timerRef.current = setTimeout(() => {
      flushPending();
      setSnack(null);
    }, 3000);
  }, [flushPending]);

  const handleUndo = () => {
    // Undone, not committed: drop the cleanup instead of running it.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingCommitRef.current = null;
    snack?.undoFn?.();
    setSnack(null);
  };

  const handleDismiss = () => {
    flushPending();
    setSnack(null);
  };

  return (
    <SnackbarContext.Provider value={{ showSnackbar }}>
      {children}
      {snack && (
        <div className={styles.snackbar} role="status" aria-live="polite">
          <span className={styles.message}>{snack.message}</span>
          {snack.undoFn && (
            <button className={styles.undoBtn} onClick={handleUndo}>
              Rückgängig
            </button>
          )}
          <button className={styles.dismissBtn} onClick={handleDismiss} aria-label="Schließen">
            ✕
          </button>
        </div>
      )}
    </SnackbarContext.Provider>
  );
}
