import type { Polish } from '@nagellacke/core';
import NailBottle from './NailBottle';
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
      <div className={styles.bottle}>
        <NailBottle
          color={polish.color}
          finish={polish.finish}
          status={polish.status}
          brand={polish.brand}
          photoUrl={polish.photo ? `/photos/${polish.photo}` : undefined}
        />
      </div>
      <div className={styles.info}>
        <div className={styles.name}>{polish.name}</div>
        {polish.brand && <div className={styles.brand}>{polish.brand}</div>}
        {polish.rating ? <div className={styles.rating}>{'★'.repeat(polish.rating)}</div> : null}
      </div>
      <button
        className={styles.deleteBtn}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        aria-label="Löschen"
      >×</button>
    </div>
  );
}
