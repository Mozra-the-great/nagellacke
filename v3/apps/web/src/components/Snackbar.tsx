import { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { ReactNode, FocusEvent } from 'react';
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

// WCAG 2.2.1 (Timing Adjustable): give users enough time to notice the
// announcement and reach "Rückgängig", and pause the countdown entirely
// while they're hovering or keyboard-focused inside the snackbar.
const AUTO_DISMISS_MS = 6000;

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snack, setSnack] = useState<SnackbarState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held outside React state so a pending commit can be flushed synchronously
  // without running side effects inside a state updater.
  const pendingCommitRef = useRef<(() => void) | null>(null);
  // Timestamp the running timer is due to fire, and how much time was left
  // when it was last paused — used to resume with the remainder rather than
  // restarting the full duration.
  const deadlineRef = useRef<number>(0);
  const remainingRef = useRef<number>(AUTO_DISMISS_MS);
  const isHoveredRef = useRef(false);
  const isFocusedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Runs the outstanding commit (if any) and disarms its timer. Idempotent:
  // the ref is cleared first, so a later flush can't run the same commit twice.
  const flushPending = useCallback(() => {
    clearTimer();
    const commit = pendingCommitRef.current;
    pendingCommitRef.current = null;
    commit?.();
  }, [clearTimer]);

  const startTimer = useCallback((duration: number) => {
    clearTimer();
    deadlineRef.current = Date.now() + duration;
    timerRef.current = setTimeout(() => {
      flushPending();
      setSnack(null);
    }, duration);
  }, [clearTimer, flushPending]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      remainingRef.current = Math.max(0, deadlineRef.current - Date.now());
      clearTimer();
    }
  }, [clearTimer]);

  const resumeTimer = useCallback(() => {
    if (!isHoveredRef.current && !isFocusedRef.current && !timerRef.current) {
      startTimer(remainingRef.current);
    }
  }, [startTimer]);

  const handleMouseEnter = () => {
    isHoveredRef.current = true;
    pauseTimer();
  };
  const handleMouseLeave = () => {
    isHoveredRef.current = false;
    resumeTimer();
  };
  const handleFocus = () => {
    isFocusedRef.current = true;
    pauseTimer();
  };
  const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    isFocusedRef.current = false;
    resumeTimer();
  };

  const showSnackbar = useCallback((message: string, undoFn?: () => void, commitFn?: () => void) => {
    // A second delete before the first snackbar times out replaces it, taking
    // away that item's undo affordance — so treat the outgoing snack as
    // implicitly committed rather than dropping its cleanup (which used to
    // orphan the first item's photo on the server).
    flushPending();
    const id = Date.now();
    isHoveredRef.current = false;
    isFocusedRef.current = false;
    pendingCommitRef.current = commitFn ?? null;
    setSnack({ message, undoFn, commitFn, id });
    startTimer(AUTO_DISMISS_MS);
  }, [flushPending, startTimer]);

  const handleUndo = () => {
    // Undone, not committed: drop the cleanup instead of running it.
    clearTimer();
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
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onFocus={handleFocus}
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
