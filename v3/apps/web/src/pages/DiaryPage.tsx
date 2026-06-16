import { useState } from 'react';
import type { Manicure, Polish, PolishRef, ManicurePhotos } from '@nagellacke/core';
import { filterManicures } from '@nagellacke/core';
import type { useAppData } from '../useAppData';
import PhotoField from '../components/PhotoField';
import styles from './DiaryPage.module.css';

type AppData = ReturnType<typeof useAppData>;

const PHOTO_SLOTS = [
  { key: 'fingerRight' as const, label: 'Finger rechts' },
  { key: 'fingerLeft'  as const, label: 'Finger links'  },
  { key: 'thumbRight'  as const, label: 'Daumen rechts' },
  { key: 'thumbLeft'   as const, label: 'Daumen links'  },
];

function firstPhoto(m: Manicure): string | null {
  if (m.photo) return m.photo;
  if (m.photos) return Object.values(m.photos).find((v): v is string => !!v) ?? null;
  return null;
}

function resolveSwatches(m: Manicure, allPolishes: Polish[]): string[] {
  if (m.polishRefs?.length) return m.polishRefs.map((r) => r.color ?? '#888888');
  if (m.polishes?.length) {
    return m.polishes.flatMap((name) => {
      const p = allPolishes.find((ap) => ap.name === name && !ap.deletedAt);
      return p ? [p.color] : [];
    });
  }
  return [];
}

export default function DiaryPage({ appData }: { appData: AppData }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Manicure | null>(null);
  const [form, setForm] = useState<{
    date: string;
    polishRefs: PolishRef[];
    notes: string;
    photos: ManicurePhotos;
  }>({
    date: new Date().toISOString().slice(0, 10),
    polishRefs: [],
    notes: '',
    photos: {},
  });

  const entries = filterManicures(appData.data.manicures)
    .sort((a, b) => b.date.localeCompare(a.date));

  const availablePolishes = appData.data.polishes.filter(
    (p) => !p.deletedAt && p.status !== 'wish',
  );

  const openNew = () => {
    setEditing(null);
    setForm({ date: new Date().toISOString().slice(0, 10), polishRefs: [], notes: '', photos: {} });
    setShowForm(true);
  };

  const openEdit = (m: Manicure) => {
    setEditing(m);
    setForm({
      date: m.date,
      polishRefs: [...(m.polishRefs ?? [])],
      notes: m.notes ?? '',
      photos: { ...(m.photos ?? {}) },
    });
    setShowForm(true);
  };

  const togglePolish = (p: Polish) => {
    const isSelected = (r: PolishRef) => r.name === p.name && r.brand === p.brand;
    setForm((f) => ({
      ...f,
      polishRefs: f.polishRefs.some(isSelected)
        ? f.polishRefs.filter((r) => !isSelected(r))
        : [...f.polishRefs, { name: p.name, brand: p.brand, color: p.color }],
    }));
  };

  const save = () => {
    if (editing) {
      appData.updateManicure(editing.id, { ...form });
    } else {
      appData.addManicure({ ...form });
    }
    setShowForm(false);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Tagebuch</h1>
        <button className={styles.addBtn} onClick={openNew}>+</button>
      </header>

      <div className={styles.count}>{entries.length} Einträge</div>

      <div className={styles.timeline}>
        {entries.map((m) => {
          const swatches = resolveSwatches(m, appData.data.polishes);
          const thumb = firstPhoto(m);
          return (
            <div key={m.id} className={styles.entry} onClick={() => openEdit(m)}>
              <div className={styles.entryTop}>
                {thumb && (
                  <img
                    src={`/photos/${thumb}`}
                    alt={`Maniküre ${formatDate(m.date)}`}
                    className={styles.entryThumb}
                  />
                )}
                <div className={styles.entryInfo}>
                  <div className={styles.entryDate}>{formatDate(m.date)}</div>
                  {swatches.length > 0 && (
                    <div className={styles.entrySwatches}>
                      {swatches.slice(0, 6).map((color, i) => (
                        <div key={i} className={styles.swatch} style={{ background: color }} />
                      ))}
                    </div>
                  )}
                  {m.notes && <div className={styles.entryNotes}>{m.notes}</div>}
                </div>
              </div>
              <button
                className={styles.deleteBtn}
                onClick={(e) => { e.stopPropagation(); appData.deleteManicure(m.id); }}
              >×</button>
            </div>
          );
        })}
      </div>

      {showForm && (
        <div className={styles.overlay} onClick={() => setShowForm(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{editing ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</h2>
              <button onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className={styles.modalBody}>
              <label className={styles.field}>
                <span>Datum</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
              </label>

              {/* Photo upload slots */}
              <div className={styles.field}>
                <span>Fotos</span>
                <div className={styles.photoSlots}>
                  {PHOTO_SLOTS.map((slot) => (
                    <div key={slot.key} className={styles.photoSlotWrap}>
                      <span className={styles.photoLabel}>{slot.label}</span>
                      <PhotoField
                        value={form.photos[slot.key] ?? undefined}
                        onChange={(filename) =>
                          setForm((f) => ({ ...f, photos: { ...f.photos, [slot.key]: filename ?? null } }))
                        }
                        label={slot.label}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.field}>
                <span>Verwendete Lacke</span>
                <div className={styles.polishPicker}>
                  {availablePolishes.map((p) => {
                    const on = form.polishRefs.some((r) => r.name === p.name && r.brand === p.brand);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`${styles.polishChip} ${on ? styles.polishChipOn : ''}`}
                        onClick={() => togglePolish(p)}
                      >
                        <span className={styles.polishDot} style={{ background: p.color }} />
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className={styles.field}>
                <span>Notizen</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                />
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}
