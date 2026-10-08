import { useMemo } from 'react';
import type { Polish } from '@nagellacke/core';
import { groupByColorFamily } from '@nagellacke/core';
import { STATUS_BADGE, swatchLabel, swatchStyle } from '../utils/swatch';
import styles from './SwatchGrid.module.css';

interface Props {
  polishes: Polish[];
  /** Same handler the card view uses: opens the existing detail dialog. */
  onOpen: (polish: Polish) => void;
}

function SwatchTile({ polish, onOpen }: { polish: Polish; onOpen: (polish: Polish) => void }) {
  const count = polish.count ?? 1;
  const isMuted = polish.status === 'empty' || polish.status === 'gone';
  const status = STATUS_BADGE[polish.status];

  return (
    <button
      type="button"
      className={isMuted ? `${styles.tile} ${styles.muted}` : styles.tile}
      aria-label={swatchLabel(polish)}
      aria-haspopup="dialog"
      onClick={() => onOpen(polish)}
    >
      <span className={styles.swatchBox}>
        <span className={styles.swatch} style={swatchStyle(polish.color, polish.finish)} aria-hidden="true" />
      </span>
      {/* Brand and rating keep their line even when empty, so tiles in a row stay level.
          The {' '} spacers are invisible (the tile is a flex column) but separate the words
          in the button's text content, which assistive tech and axe read as one string. */}
      <span className={styles.brand} aria-hidden="true">{polish.brand}</span>{' '}
      <span className={styles.name} aria-hidden="true">{polish.name || 'Unbenannt'}</span>{' '}
      <span className={styles.rating} aria-hidden="true">{polish.rating ? '★'.repeat(polish.rating) : ''}</span>
      {/* After the text in the DOM so the visible words keep the order swatchLabel() uses;
          positioned over the swatch's corner by CSS. */}
      {(status || count > 1) && (
        <span className={styles.badges} aria-hidden="true">
          {status && <span className={styles.badge}>{status}</span>}
          {count > 1 && <span className={styles.badge}>{count}×</span>}
        </span>
      )}
    </button>
  );
}

/**
 * Colour-family swatch view of the collection (#328): round swatches, grouped under
 * headings such as "Rottöne", light to dark inside each group. Receives the already
 * filtered polishes, so search and filters behave exactly as in the card view.
 */
export default function SwatchGrid({ polishes, onOpen }: Props) {
  const groups = useMemo(() => groupByColorFamily(polishes), [polishes]);

  return (
    <div className={styles.groups}>
      {groups.map((group) => (
        <section key={group.id} className={styles.group} aria-labelledby={`swatch-group-${group.id}`}>
          <h3 id={`swatch-group-${group.id}`} className={styles.heading}>
            {group.label}
            <span className={styles.headingCount}>{group.items.length}</span>
          </h3>
          <ul className={styles.grid}>
            {group.items.map((p) => (
              <li key={p.id} className={styles.cell}>
                <SwatchTile polish={p} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
