import { useState } from 'react';
import type { Sticker } from '@nagellacke/core';
import { filterStickers, STICKER_TYPE_OPTIONS, STATUS_OPTIONS, DEFAULT_STICKER } from '@nagellacke/core';
import type { useAppData } from '../useAppData';
import styles from './StickersPage.module.css';

type AppData = ReturnType<typeof useAppData>;

export default function StickersPage({ appData }: { appData: AppData }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Sticker | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...DEFAULT_STICKER });

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
        <h1 className={styles.title}>Sticker</h1>
        <button className={styles.addBtn} onClick={openNew}>+</button>
      </header>

      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          placeholder="Sticker suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.count}>{visible.length} Sticker</div>

      <div className={styles.list}>
        {visible.map((s) => (
          <div key={s.id} className={styles.item} onClick={() => openEdit(s)}>
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
              onClick={(e) => { e.stopPropagation(); appData.deleteSticker(s.id); }}
            >×</button>
          </div>
        ))}
      </div>

      {showForm && (
        <div className={styles.overlay} onClick={() => setShowForm(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{editing ? 'Bearbeiten' : 'Neuer Sticker'}</h2>
              <button onClick={() => setShowForm(false)}>✕</button>
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
