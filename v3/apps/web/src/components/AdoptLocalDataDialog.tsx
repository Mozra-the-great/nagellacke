import { useRef, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import styles from './FinishMigrationNotice.module.css';

interface AdoptLocalDataDialogProps {
  /** Live records in this browser's collection. */
  count: number;
  onResolve: (keep: boolean) => void;
}

/**
 * Asked right after signing in on a public instance when this browser already holds a
 * collection (#324 S16), before the first sync decides it by merging. No dismiss via
 * backdrop or Escape: until it is answered nothing syncs, so closing it would only
 * leave the account silently out of step.
 */
export default function AdoptLocalDataDialog({ count, onResolve }: AdoptLocalDataDialogProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true);
  const one = count === 1;

  return (
    <div className={styles.overlay}>
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="adopt-local-title"
        aria-describedby="adopt-local-body"
      >
        <div className={styles.header}>
          <h2 id="adopt-local-title">Lokale Sammlung ins Konto übernehmen?</h2>
        </div>
        <div className={styles.body} id="adopt-local-body">
          <p>
            {one
              ? 'In diesem Browser liegt 1 Eintrag, der noch zu keinem Konto gehört. Beim Übernehmen wird er'
              : `In diesem Browser liegen ${count} Einträge, die noch zu keinem Konto gehören. Beim Übernehmen werden sie`}
            {' '}mit dem zusammengeführt, was dein Konto schon enthält, und {one ? 'ist' : 'sind'} danach auf all
            deinen Geräten verfügbar.
          </p>
          {confirmDiscard && (
            <p className={styles.warning} role="alert">
              Beim Verwerfen {one ? 'wird der Eintrag' : `werden die ${count} Einträge`} aus diesem Browser
              gelöscht und durch den Inhalt deines Kontos ersetzt. Das lässt sich nicht rückgängig machen.
            </p>
          )}
        </div>
        <div className={styles.footer}>
          {confirmDiscard ? (
            <>
              <button type="button" className={styles.cancelBtn} onClick={() => setConfirmDiscard(false)}>
                Zurück
              </button>
              <button type="button" className={styles.dangerBtn} onClick={() => onResolve(false)}>
                Ja, verwerfen
              </button>
            </>
          ) : (
            <>
              <button type="button" className={styles.rollbackBtn} onClick={() => setConfirmDiscard(true)}>
                Verwerfen
              </button>
              <button type="button" className={styles.primaryBtn} onClick={() => onResolve(true)}>
                Übernehmen
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
