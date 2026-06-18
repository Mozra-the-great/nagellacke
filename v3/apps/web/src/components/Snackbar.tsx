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

  const showSnackbar = useCallback((message: string, undoFn?: () => void, commitFn?: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const id = Date.now();
    setSnack({ message, undoFn, commitFn, id });
    timerRef.current = setTimeout(() => {
      setSnack((prev) => {
        if (prev?.id === id) { prev.commitFn?.(); return null; }
        return prev;
      });
    }, 3000);
  }, []);

  const handleUndo = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    snack?.undoFn?.();
    setSnack(null);
  };

  const handleDismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    snack?.commitFn?.();
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
