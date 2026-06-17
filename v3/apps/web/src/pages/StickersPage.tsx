import { useState, useRef } from 'react';
import type { Sticker } from '@nagellacke/core';
import { filterStickers, STICKER_TYPE_OPTIONS, STATUS_OPTIONS, DEFAULT_STICKER } from '@nagellacke/core';
import type { useAppData } from '../useAppData';
import { useSnackbar } from '../components/Snackbar';
import { useFocusTrap } from '../hooks/useFocusTrap';
import styles from './StickersPage.module.css';

type AppData = ReturnType<typeof useAppData>;

export default function StickersPage({ appData }: { appData: AppData }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Sticker | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...DEFAULT_STICKER });
  const { showSnackbar } = useSnackbar();
  const stickerModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(stickerModalRef, showForm);

  const visible = filterStickers(appData.data.stickers, search);

  const openNew = () => {
    setEditing(null);
    setForm({ ...DEFAULT_STICKER });
    setShowForm(true);
  };

  const openEdit = (s: Sticker) => {
    setEditing(s);
    setForm({
      name: s.name, brand: s.brand ?? '', style: s.style ?? '',
      type: s.type, colors: s.colors ?? ['#ff6699'],
      status: s.status, notes: s.notes ?? '', rating: s.rating ?? 0,
    });
    setShowForm(true);
  };

  const save = () => {
    if (!form.name.trim()) return;
    if (editing) {
      appData.updateSticker(editing.id, form);
    } else {
      appData.addSticker(form as Omit<Sticker, 'id' | 'createdAt' | 'updatedAt'>);
    }
    setShowForm(false);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2 className={styles.title}>Sticker</h2>
        <button className={styles.addBtn} onClick={openNew}>+</button>
      </header>

      <div className={styles.searchRow}>
        <div className={styles.searchWrapper}>
          <input
            aria-label="Sticker suchen"
            className={styles.searchInput}
            placeholder="Sticker suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className={styles.clearSearch}
              aria-label="Suche leeren"
              onClick={() => setSearch('')}
            >✕</button>
          )}
        </div>
      </div>

      <div className={styles.count}>{visible.length} Sticker</div>

      <div className={styles.list}>
        {visible.length === 0 && (
          <div className={styles.empty}>
            {search
              ? 'Keine Sticker gefunden — Suche anpassen.'
              : 'Noch keine Sticker — füge deinen ersten hinzu!'}
          </div>
        )}
        {visible.map((s) => (
          <div
            key={s.id}
            className={styles.item}
            onClick={() => openEdit(s)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openEdit(s)}
            aria-label={`${s.name} bearbeiten`}
          >
            <div className={styles.itemColors}>
              {(s.colors ?? ['#ccc']).slice(0, 3).map((c, i) => (
                <div key={i} className={styles.colorDot} style={{ background: c }} />
              ))}
            </div>
            <div className={styles.itemInfo}>
              <div className={styles.itemName}>{s.name}</div>
              <div className={styles.itemMeta}>
                {s.brand && <span>{s.brand}</span>}
                <span className={styles.typeChip}>{STICKER_TYPE_OPTIONS.find((o) => o.value === s.type)?.label ?? s.type}</span>
                {s.rating ? <span>{'★'.repeat(s.rating)}</span> : null}
              </div>
            </div>
            <button
              className={styles.deleteBtn}
              onClick={(e) => {
                e.stopPropagation();
                appData.deleteSticker(s.id);
                showSnackbar(`„${s.name}" gelöscht`, () => appData.restoreSticker(s.id));
              }}
            >×</button>
          </div>
        ))}
      </div>

      {showForm && (
        <div
          className={styles.overlay}
          onClick={() => setShowForm(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowForm(false)}
        >
          <div
            ref={stickerModalRef}
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sticker-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2 id="sticker-modal-title">{editing ? 'Bearbeiten' : 'Neuer Sticker'}</h2>
              <button onClick={() => setShowForm(false)} aria-label="Schließen">✕</button>
            </div>
            <div className={styles.modalBody}>
              <label className={styles.field}>
                <span>Name *</span>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label className={styles.field}>
                <span>Marke</span>
                <input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
              </label>
              <label className={styles.field}>
                <span>Typ</span>
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as typeof form.type }))}>
                  {STICKER_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.icon} {o.label}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span>Status</span>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as typeof form.status }))}>
                  {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span>Notizen</span>
                <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
              </label>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setShowForm(false)}>Abbrechen</button>
              <button className={styles.saveBtn} onClick={save}>Speichern</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
