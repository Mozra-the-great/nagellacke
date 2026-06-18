import { useState, useRef } from 'react';
import type { Sticker } from '@nagellacke/core';
import { filterStickers, STICKER_TYPE_OPTIONS, STATUS_OPTIONS, DEFAULT_STICKER } from '@nagellacke/core';
import type { useAppData } from '../useAppData';
import PhotoField from '../components/PhotoField';
import { useSnackbar } from '../components/Snackbar';
import { useFocusTrap } from '../hooks/useFocusTrap';
import styles from './StickersPage.module.css';

type AppData = ReturnType<typeof useAppData>;

type FormState = {
  name: string; brand: string; style: string;
  type: Sticker['type']; colors: string[];
  status: Sticker['status']; notes: string; rating: number;
  photo?: string;
};

export default function StickersPage({ appData }: { appData: AppData }) {
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState<Sticker | null>(null);
  const [editing, setEditing] = useState<Sticker | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...DEFAULT_STICKER, photo: undefined });
  const { showSnackbar } = useSnackbar();
  const stickerDetailRef = useRef<HTMLDivElement>(null);
  const stickerModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(stickerDetailRef, !!viewing);
  useFocusTrap(stickerModalRef, showForm);

  const visible = filterStickers(appData.data.stickers, search);

  const openNew = () => {
    setEditing(null);
    setForm({ ...DEFAULT_STICKER, photo: undefined });
    setShowForm(true);
  };

  const openEdit = (s: Sticker) => {
    setEditing(s);
    setForm({
      name: s.name, brand: s.brand ?? '', style: s.style ?? '',
      type: s.type, colors: s.colors ?? ['#ff6699'],
      status: s.status, notes: s.notes ?? '', rating: s.rating ?? 0,
      photo: s.photo,
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
        <button className={styles.addBtn} onClick={openNew} aria-label="Neuen Sticker hinzufügen">+</button>
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
            onClick={() => setViewing(s)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setViewing(s)}
            aria-label={`${s.name} ansehen`}
          >
            {s.photo
              ? <img src={`/photos/${s.photo}`} alt={s.name} className={styles.itemThumb} />
              : (
                <div className={styles.itemColors}>
                  {(s.colors ?? ['#ccc']).slice(0, 3).map((c, i) => (
                    <div key={i} className={styles.colorDot} style={{ background: c }} />
                  ))}
                </div>
              )
            }
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
                const cleanup = appData.deleteSticker(s.id);
                showSnackbar(`„${s.name}" gelöscht`, () => appData.restoreSticker(s.id), cleanup);
              }}
            >✕</button>
          </div>
        ))}
      </div>

      {viewing && (
        <div className={styles.overlay} onClick={() => setViewing(null)} onKeyDown={(e) => e.key === 'Escape' && setViewing(null)}>
          <div ref={stickerDetailRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="sticker-detail-title" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 id="sticker-detail-title">{viewing.name}</h2>
              <button onClick={() => setViewing(null)} aria-label="Schließen">✕</button>
            </div>
            <div className={styles.modalBody}>
              {viewing.photo && (
                <img src={`/photos/${viewing.photo}`} alt={viewing.name} className={styles.detailPhoto} />
              )}
              {!viewing.photo && (viewing.colors ?? []).length > 0 && (
                <div className={styles.detailColors}>
                  {(viewing.colors ?? []).map((c, i) => (
                    <div key={i} className={styles.detailColorDot} style={{ background: c }} />
                  ))}
                </div>
              )}
              <div className={styles.detailMeta}>
                {viewing.brand && <div className={styles.detailMetaRow}><span>Marke</span><span>{viewing.brand}</span></div>}
                <div className={styles.detailMetaRow}>
                  <span>Typ</span>
                  <span className={styles.typeChip}>{STICKER_TYPE_OPTIONS.find((o) => o.value === viewing.type)?.label ?? viewing.type}</span>
                </div>
                {viewing.style && <div className={styles.detailMetaRow}><span>Stil</span><span>{viewing.style}</span></div>}
                {viewing.rating ? <div className={styles.detailMetaRow}><span>Bewertung</span><span className={styles.detailRating}>{'★'.repeat(viewing.rating)}</span></div> : null}
              </div>
              {viewing.notes && <p className={styles.detailNotes}>{viewing.notes}</p>}
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setViewing(null)}>Schließen</button>
              <button className={styles.saveBtn} onClick={() => { const s = viewing; setViewing(null); openEdit(s); }}>Bearbeiten</button>
            </div>
          </div>
        </div>
      )}

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
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as FormState['type'] }))}>
                  {STICKER_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.icon} {o.label}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span>Status</span>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as FormState['status'] }))}>
                  {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <div className={styles.field}>
                <span>Foto</span>
                <PhotoField
                  value={form.photo}
                  onChange={(filename) => setForm((f) => ({ ...f, photo: filename }))}
                />
              </div>
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
