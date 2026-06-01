import type { Polish } from '@nagellacke/core';
import styles from './PolishCard.module.css';

export default function PolishCard({
  polish,
  onEdit,
  onDelete,
}: {
  polish: Polish;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={styles.card} onClick={onEdit}>
      <div className={styles.swatch} style={{ background: polish.color }}>
        {polish.photo && (
          <img src={`/photos/${polish.photo}`} alt="" className={styles.photo} />
        )}
      </div>
      <div className={styles.info}>
        <div className={styles.name}>{polish.name}</div>
        <div className={styles.brand}>{polish.brand}</div>
        <div className={styles.meta}>
          <span className={styles.finish}>{polish.finish}</span>
          {polish.rating ? <span className={styles.rating}>{'★'.repeat(polish.rating)}</span> : null}
        </div>
      </div>
      <button
        className={styles.deleteBtn}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        aria-label="Löschen"
      >×</button>
    </div>
  );
}
