import { useState, useMemo, useRef } from 'react';
import type { Polish, FilterState } from '@nagellacke/core';
import { filterPolishes, sortPolishes, FINISH_OPTIONS, STATUS_OPTIONS, SORT_OPTIONS } from '@nagellacke/core';
import type { useAppData } from '../useAppData';
import { loadPhotoDefault } from '../useAppData';
import PolishCard from '../components/PolishCard';
import PolishFormModal from '../components/PolishFormModal';
import NailBottle from '../components/NailBottle';
import { useSnackbar } from '../components/Snackbar';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { plural } from '../utils/plural';
import { startAutofillJob, pollAiJob } from '../utils/ai';
import styles from './CollectionPage.module.css';

type AppData = ReturnType<typeof useAppData>;

export default function CollectionPage({ appData }: { appData: AppData }) {
  const [filter, setFilter] = useState<FilterState>({
    search: '', finish: '', category: '', status: '', brand: '', sort: 'newest',
  });
  const [viewing, setViewing] = useState<Polish | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Polish | null>(null);
  const { showSnackbar } = useSnackbar();
  const polishDetailRef = useRef<HTMLDivElement>(null);
  useFocusTrap(polishDetailRef, !!viewing);
  const photoDefault = loadPhotoDefault();

  const visible = useMemo(() => {
    const filtered = filterPolishes(appData.data.polishes, filter);
    return sortPolishes(filtered, filter.sort);
  }, [appData.data.polishes, filter]);

  const activeCategories = appData.data.customCats.filter((c) => !c.deletedAt);

  const runAutofill = async (polish: Polish) => {
    try {
      const { jobId } = await startAutofillJob({ name: polish.name, brand: polish.brand, num: polish.num });
      const job = await pollAiJob(jobId);
      if (job.status === 'error') throw new Error(job.error ?? 'Unbekannter Fehler');
      const result = job.result as { color?: string; finish?: string } | undefined;
      if (result?.color && result?.finish) {
        appData.updatePolish(polish.id, { color: result.color, finish: result.finish as Polish['finish'] });
      }
      void appData.sync();
      showSnackbar(`✨ KI hat Farbe & Finish für „${polish.name}" ermittelt`);
    } catch (e) {
      showSnackbar(`KI-Recherche fehlgeschlagen: ${e instanceof Error ? e.message : 'Unbekannter Fehler'}`);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2 className={styles.title}>Nagellacke</h2>
        <button
          className={styles.addBtn}
          onClick={() => { setEditing(null); setShowForm(true); }}
          aria-label="Neuen Lack hinzufügen"
        >+</button>
      </header>

      <div className={styles.searchRow}>
        <div className={styles.searchWrapper}>
          <input
            aria-label="Lacke suchen"
            className={styles.searchInput}
            placeholder="Suchen…"
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          />
          {filter.search && (
            <button
              className={styles.clearSearch}
              aria-label="Suche leeren"
              onClick={() => setFilter((f) => ({ ...f, search: '' }))}
            >✕</button>
          )}
        </div>
      </div>

      <div className={styles.filters}>
        <select aria-label="Sortieren nach" value={filter.sort} onChange={(e) => setFilter((f) => ({ ...f, sort: e.target.value as FilterState['sort'] }))}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select aria-label="Status filtern" value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as FilterState['status'] }))}>
          <option value="">Alle Status</option>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select aria-label="Oberfläche filtern" value={filter.finish} onChange={(e) => setFilter((f) => ({ ...f, finish: e.target.value as FilterState['finish'] }))}>
          <option value="">Alle Finishes</option>
          {FINISH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {activeCategories.length > 0 && (
          <select aria-label="Kategorie filtern" value={filter.category} onChange={(e) => setFilter((f) => ({ ...f, category: e.target.value }))}>
            <option value="">Alle Kategorien</option>
            {activeCategories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}
      </div>

      <div className={styles.count}>{plural(visible.length, 'Lack', 'Lacke')}</div>

      <div className={styles.grid}>
        {visible.length === 0 && (
          <div className={styles.empty}>
            {filter.search || filter.finish || filter.status || filter.category
              ? 'Keine Lacke gefunden — Filter anpassen.'
              : 'Noch keine Lacke — füge deinen ersten Lack hinzu!'}
          </div>
        )}
        {visible.map((p) => (
          <PolishCard
            key={p.id}
            polish={p}
            defaultShowPhoto={photoDefault}
            onEdit={() => setViewing(p)}
            onDelete={() => {
              const cleanup = appData.deletePolish(p.id);
              showSnackbar(`„${p.name}" gelöscht`, () => appData.restorePolish(p.id), cleanup);
            }}
          />
        ))}
      </div>

      {viewing && (
        <div className={styles.overlay} onClick={() => setViewing(null)} onKeyDown={(e) => e.key === 'Escape' && setViewing(null)}>
          <div ref={polishDetailRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="polish-detail-title" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <button onClick={() => setViewing(null)} aria-label="Schließen">✕</button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.detailPreview}>
                {viewing.photo
                  ? <img src={`/photos/${viewing.photo}`} alt={viewing.name} className={styles.detailPhoto} />
                  : <NailBottle color={viewing.color} finish={viewing.finish} status={viewing.status} brand={viewing.brand} />
                }
              </div>
              <h2 id="polish-detail-title" className={styles.detailName}>{viewing.name}</h2>
              {viewing.brand && <div className={styles.detailBrand}>{viewing.brand}</div>}
              {viewing.rating ? <div className={styles.detailRating}>{'★'.repeat(viewing.rating)}</div> : null}
              <div className={styles.detailGrid}>
                {viewing.num && (
                  <div className={styles.detailCell}><span>Nummer</span><span>{viewing.num}</span></div>
                )}
                <div className={styles.detailCell}>
                  <span>Finish</span><span>{FINISH_OPTIONS.find((o) => o.value === viewing.finish)?.icon} {viewing.finish}</span>
                </div>
                <div className={styles.detailCell}>
                  <span>Status</span><span>{STATUS_OPTIONS.find((o) => o.value === viewing.status)?.label}</span>
                </div>
                {(viewing.count ?? 1) > 1 && (
                  <div className={styles.detailCell}><span>Anzahl</span><span>{viewing.count}×</span></div>
                )}
              </div>
              {viewing.notes && <p className={styles.detailNotes}>{viewing.notes}</p>}
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setViewing(null)}>Schließen</button>
              <button className={styles.saveBtn} onClick={() => { const p = viewing; setViewing(null); setEditing(p); setShowForm(true); }}>Bearbeiten</button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <PolishFormModal
          polish={editing}
          categories={activeCategories}
          allPolishes={appData.data.polishes}
          onSave={(p, aiAutofill) => {
            if (editing) {
              appData.updatePolish(editing.id, p);
            } else {
              const created = appData.addPolish(p as Omit<Polish, 'id' | 'createdAt' | 'updatedAt'>);
              if (aiAutofill) void runAutofill(created);
            }
            setShowForm(false);
          }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
