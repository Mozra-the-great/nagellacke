import { useState, useMemo } from 'react';
import type { Polish, FilterState } from '@nagellacke/core';
import { filterPolishes, sortPolishes, FINISH_OPTIONS, STATUS_OPTIONS, SORT_OPTIONS } from '@nagellacke/core';
import type { useAppData } from '../useAppData';
import PolishCard from '../components/PolishCard';
import PolishFormModal from '../components/PolishFormModal';
import { useSnackbar } from '../components/Snackbar';
import styles from './CollectionPage.module.css';

type AppData = ReturnType<typeof useAppData>;

export default function CollectionPage({ appData }: { appData: AppData }) {
  const [filter, setFilter] = useState<FilterState>({
    search: '', finish: '', category: '', status: '', brand: '', sort: 'newest',
  });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Polish | null>(null);
  const { showSnackbar } = useSnackbar();

  const visible = useMemo(() => {
    const filtered = filterPolishes(appData.data.polishes, filter);
    return sortPolishes(filtered, filter.sort);
  }, [appData.data.polishes, filter]);

  const activeCategories = appData.data.customCats.filter((c) => !c.deletedAt);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          placeholder="Suchen…"
          value={filter.search}
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
        />
        <button className={styles.addBtn} onClick={() => { setEditing(null); setShowForm(true); }}>
          + Hinzufügen
        </button>
      </div>

      <div className={styles.filters}>
        <select value={filter.sort} onChange={(e) => setFilter((f) => ({ ...f, sort: e.target.value as FilterState['sort'] }))}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as FilterState['status'] }))}>
          <option value="">Alle Status</option>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filter.finish} onChange={(e) => setFilter((f) => ({ ...f, finish: e.target.value as FilterState['finish'] }))}>
          <option value="">Alle Finishes</option>
          {FINISH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {activeCategories.length > 0 && (
          <select value={filter.category} onChange={(e) => setFilter((f) => ({ ...f, category: e.target.value }))}>
            <option value="">Alle Kategorien</option>
            {activeCategories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}
      </div>

      <div className={styles.count}>{visible.length} Lacke</div>

      <div className={styles.grid}>
        {visible.map((p) => (
          <PolishCard
            key={p.id}
            polish={p}
            onEdit={() => { setEditing(p); setShowForm(true); }}
            onDelete={() => {
              appData.deletePolish(p.id);
              showSnackbar(`„${p.name}" gelöscht`, () => appData.restorePolish(p.id));
            }}
          />
        ))}
      </div>

      {showForm && (
        <PolishFormModal
          polish={editing}
          categories={activeCategories}
          onSave={(p) => {
            if (editing) appData.updatePolish(editing.id, p);
            else appData.addPolish(p as Omit<Polish, 'id' | 'createdAt' | 'updatedAt'>);
            setShowForm(false);
          }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
