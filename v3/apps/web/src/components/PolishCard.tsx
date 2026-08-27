import { useState } from 'react';
import type { Polish } from '@nagellacke/core';
import NailBottle from './NailBottle';
import styles from './PolishCard.module.css';

export default function PolishCard({
  polish,
  defaultShowPhoto = true,
  onEdit,
  onDelete,
}: {
  polish: Polish;
  defaultShowPhoto?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasPhoto = !!polish.photo;
  const [showPhoto, setShowPhoto] = useState(hasPhoto && defaultShowPhoto);
  const count = polish.count ?? 1;
  // `name` is typed as required, but a corrupted sync/import record can still
  // land here without one at runtime (#218).
  const name = polish.name || 'Unbenannt';
  const isGone = polish.status === 'gone';
  const isEmpty = polish.status === 'empty';

  return (
    // Plain, non-interactive container - a `role="button"` here containing
    // the real <button>s below (open/toggle/delete) would be invalid ARIA
    // (WCAG 4.1.2, #255). The "open details" affordance is its own <button>
    // below instead; viewToggle/deleteBtn stay siblings, not descendants of it.
    <div className={`${styles.card} ${(isGone || isEmpty) ? styles.cardMuted : ''}`}>
      {(count > 1 || polish.status === 'wish' || isGone || isEmpty) && (
        <div className={styles.topBadges}>
          {polish.status === 'wish' && (
            <span className={styles.wishBadge} title="Wunschliste">🛒</span>
          )}
          {isGone && <span className={styles.statusBadge} title="Nicht mehr da">🗑️</span>}
          {isEmpty && <span className={styles.statusBadge} title="Leer">🫙</span>}
          {count > 1 && <span className={styles.countBadge}>{count}×</span>}
        </div>
      )}

      <button type="button" className={styles.openBtn} onClick={onEdit} aria-label={`${name} bearbeiten`}>
        <div className={styles.bottle}>
          <NailBottle
            color={polish.color}
            finish={polish.finish}
            status={polish.status}
            brand={polish.brand}
            photoUrl={hasPhoto && showPhoto ? `/photos/${polish.photo}` : undefined}
          />
        </div>

        <div className={styles.info}>
          <div className={styles.name} title={name}>{name}</div>
          {polish.brand && <div className={styles.brand}>{polish.brand}</div>}
          {polish.rating ? <div className={styles.rating}>{'★'.repeat(polish.rating)}</div> : null}
        </div>
      </button>

      {hasPhoto && (
        <button
          className={styles.viewToggle}
          onClick={() => setShowPhoto((v) => !v)}
          aria-label={showPhoto ? 'Flasche anzeigen' : 'Foto anzeigen'}
        >
          {showPhoto ? '◎' : '📷'}
        </button>
      )}

      <button
        className={styles.deleteBtn}
        onClick={onDelete}
        aria-label="Löschen"
      >✕</button>
    </div>
  );
}
