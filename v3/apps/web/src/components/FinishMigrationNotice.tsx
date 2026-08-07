import { useRef, useState } from 'react';
import { dismissFinishMigrationNotice } from '../useAppData';
import { useFocusTrap } from '../hooks/useFocusTrap';
import styles from './FinishMigrationNotice.module.css';

interface FinishMigrationNoticeProps {
  onRollback: () => Promise<void>;
  onClose: () => void;
}

export default function FinishMigrationNotice({ onRollback, onClose }: FinishMigrationNoticeProps) {
  const [confirming, setConfirming] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true);

  const handleUnderstood = () => {
    dismissFinishMigrationNotice();
    onClose();
  };

  const handleConfirmRollback = async () => {
    setRollingBack(true);
    try {
      await onRollback();
    } finally {
      setRollingBack(false);
    }
    dismissFinishMigrationNotice();
    onClose();
  };

  return (
    <div
      className={styles.overlay}
      onClick={handleUnderstood}
      onKeyDown={(e) => e.key === 'Escape' && handleUnderstood()}
    >
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="finish-migration-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 id="finish-migration-title">Nagellack-Finish aktualisiert</h2>
        </div>
        <div className={styles.body}>
          <p>
            Ein Nagellack kann jetzt mehrere Finish-Werte gleichzeitig haben
            (z.B. Top Coat + Glitter). Deine bestehenden Daten wurden dafür
            automatisch und sicher umgestellt — es wurde nichts gelöscht.
          </p>
          {!confirming && (
            <p className={styles.hint}>
              Sieht etwas falsch aus? Du kannst die Umstellung rückgängig machen.
            </p>
          )}
          {confirming && (
            <p className={styles.warning}>
              Achtung: Ein Rückgängigmachen setzt deine Sammlung exakt auf den
              Stand direkt vor der Umstellung zurück. Alle Änderungen, die du
              seitdem gemacht hast, gehen dabei verloren.
            </p>
          )}
        </div>
        <div className={styles.footer}>
          {!confirming && (
            <>
              <button
                type="button"
                className={styles.rollbackBtn}
                onClick={() => setConfirming(true)}
              >
                Rückgängig machen
              </button>
              <button type="button" className={styles.primaryBtn} onClick={handleUnderstood}>
                Verstanden
              </button>
            </>
          )}
          {confirming && (
            <>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => setConfirming(false)}
                disabled={rollingBack}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => void handleConfirmRollback()}
                disabled={rollingBack}
              >
                {rollingBack ? 'Wird zurückgesetzt…' : 'Ja, zurücksetzen'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
