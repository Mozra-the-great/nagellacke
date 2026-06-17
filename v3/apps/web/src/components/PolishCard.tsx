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

  return (
    <div
      className={styles.card}
      onClick={onEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onEdit()}
      aria-label={`${polish.name} bearbeiten`}
    >
      {count > 1 && (
        <span className={styles.countBadge}>{count}×</span>
      )}

      <div className={styles.bottle}>
        <NailBottle
          color={polish.color}
          finish={polish.finish}
          status={polish.status}
          brand={polish.brand}
          photoUrl={hasPhoto && showPhoto ? `/photos/${polish.photo}` : undefined}
        />
      </div>

      {hasPhoto && (
        <button
          className={styles.viewToggle}
          onClick={(e) => { e.stopPropagation(); setShowPhoto((v) => !v); }}
          aria-label={showPhoto ? 'Flasche anzeigen' : 'Foto anzeigen'}
        >
          {showPhoto ? '◎' : '📷'}
        </button>
      )}

      <div className={styles.info}>
        <div className={styles.name} title={polish.name}>{polish.name}</div>
        {polish.brand && <div className={styles.brand}>{polish.brand}</div>}
        {polish.rating ? <div className={styles.rating}>{'★'.repeat(polish.rating)}</div> : null}
      </div>

      <button
        className={styles.deleteBtn}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        aria-label="Löschen"
      >✕</button>
    </div>
  );
}
