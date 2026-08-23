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

  // (Re)arms the 3s auto-dismiss timer without touching pendingCommitRef —
  // used both by showSnackbar() and to resume the countdown after a pause
  // (WCAG 2.2.1: hover/focus on the snackbar pauses it, see armTimer's
  // callers below).
  const armTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      flushPending();
      setSnack(null);
    }, 3000);
  }, [flushPending]);

  const showSnackbar = useCallback((message: string, undoFn?: () => void, commitFn?: () => void) => {
    // A second delete before the first snackbar times out replaces it, taking
    // away that item's undo affordance — so treat the outgoing snack as
    // implicitly committed rather than dropping its cleanup (which used to
    // orphan the first item's photo on the server).
    flushPending();
    const id = Date.now();
    pendingCommitRef.current = commitFn ?? null;
    setSnack({ message, undoFn, commitFn, id });
    armTimer();
  }, [flushPending, armTimer]);

  // Pauses the auto-dismiss timer while the snackbar has mouse or keyboard
  // focus, resuming a fresh 3s countdown once it's left entirely (WCAG
  // 2.2.1 Timing Adjustable) — a screen-reader or motor-impaired user
  // otherwise has ~3s to hear the live-region announcement, orient, and
  // reach "Rückgängig" before it auto-dismisses and the deletion commits.
  const pauseTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const resumeTimer = () => {
    if (snack) armTimer();
  };

  // onBlur/onMouseLeave fire when focus/pointer moves between two elements
  // inside the snackbar too (e.g. "Rückgängig" -> dismiss button) — only
  // resume once it's actually left the whole snackbar, not mid-transfer.
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resumeTimer();
  };

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
        <div
          className={styles.snackbar}
          role="status"
          aria-live="polite"
          onMouseEnter={pauseTimer}
          onMouseLeave={resumeTimer}
          onFocus={pauseTimer}
          onBlur={handleBlur}
        >
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
