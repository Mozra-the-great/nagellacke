import { useState, useRef } from 'react';
import type { Manicure, Polish, PolishRef, ManicurePhotos } from '@nagellacke/core';
import { filterManicures } from '@nagellacke/core';
import type { useAppData } from '../useAppData';
import PhotoField from '../components/PhotoField';
import { useSnackbar } from '../components/Snackbar';
import { useFocusTrap } from '../hooks/useFocusTrap';
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
  const [viewing, setViewing] = useState<Manicure | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Manicure | null>(null);
  const { showSnackbar } = useSnackbar();
  const diaryDetailRef = useRef<HTMLDivElement>(null);
  const diaryModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(diaryDetailRef, !!viewing);
  useFocusTrap(diaryModalRef, showForm);
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
    const resolvedRefs: PolishRef[] = m.polishRefs?.length
      ? m.polishRefs
      : (m.polishes ?? []).flatMap((name) => {
          const p = appData.data.polishes.find((ap) => ap.name === name && !ap.deletedAt);
          return p ? [{ name: p.name, brand: p.brand, color: p.color }] : [];
        });
    setForm({
      date: m.date,
      polishRefs: resolvedRefs,
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
        <h2 className={styles.title}>Tagebuch</h2>
        <button className={styles.addBtn} onClick={openNew} aria-label="Neuen Eintrag hinzufügen">+</button>
      </header>

      <div className={styles.count}>{entries.length} Einträge</div>

      <div className={styles.timeline}>
        {entries.length === 0 && (
          <div className={styles.empty}>Noch keine Einträge — starte dein Maniküre-Tagebuch!</div>
        )}
        {entries.map((m) => {
          const swatches = resolveSwatches(m, appData.data.polishes);
          const thumb = firstPhoto(m);
          return (
            <div
              key={m.id}
              className={styles.entry}
              onClick={() => setViewing(m)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setViewing(m)}
              aria-label={`Eintrag vom ${formatDate(m.date)} ansehen`}
            >
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
                        <div
                          key={i}
                          className={styles.swatch}
                          style={{ background: color }}
                          title={m.polishRefs?.[i]?.name ?? color}
                        />
                      ))}
                    </div>
                  )}
                  {m.notes && <div className={styles.entryNotes}>{m.notes}</div>}
                </div>
              </div>
              <button
                className={styles.deleteBtn}
                aria-label="Eintrag löschen"
                onClick={(e) => {
                  e.stopPropagation();
                  appData.deleteManicure(m.id);
                  showSnackbar(`Eintrag vom ${formatDate(m.date)} gelöscht`, () => appData.restoreManicure(m.id));
                }}
              >✕</button>
            </div>
          );
        })}
      </div>

      {viewing && (() => {
        const vPhotos = [
          ...(viewing.photo ? [{ src: `/photos/${viewing.photo}`, label: 'Foto' }] : []),
          ...PHOTO_SLOTS.filter((s) => viewing.photos?.[s.key]).map((s) => ({
            src: `/photos/${viewing.photos![s.key]}`,
            label: s.label,
          })),
        ];
        const vRefs: PolishRef[] = viewing.polishRefs?.length
          ? viewing.polishRefs
          : (viewing.polishes ?? []).flatMap((name) => {
              const p = appData.data.polishes.find((ap) => ap.name === name && !ap.deletedAt);
              return p ? [{ name: p.name, brand: p.brand, color: p.color }] : [];
            });
        return (
          <div className={styles.overlay} onClick={() => setViewing(null)} onKeyDown={(e) => e.key === 'Escape' && setViewing(null)}>
            <div ref={diaryDetailRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="diary-detail-title" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h2 id="diary-detail-title">{formatDate(viewing.date)}</h2>
                <button onClick={() => setViewing(null)} aria-label="Schließen">✕</button>
              </div>
              <div className={styles.modalBody}>
                {vPhotos.length > 0 && (
                  <div className={styles.detailPhotoGrid}>
                    {vPhotos.map((ph, i) => (
                      <div key={i} className={styles.detailPhotoSlot}>
                        <img src={ph.src} alt={ph.label} className={styles.detailPhoto} />
                        <span className={styles.photoLabel}>{ph.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                {vRefs.length > 0 && (
                  <div className={styles.field}>
                    <span>Lacke</span>
                    <div className={styles.polishPicker}>
                      {vRefs.map((ref, i) => (
                        <div key={i} className={styles.polishChip}>
                          <span className={styles.polishDot} style={{ background: ref.color ?? '#888' }} />
                          {ref.name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {viewing.notes && (
                  <div className={styles.field}>
                    <span>Notizen</span>
                    <p className={styles.detailNotes}>{viewing.notes}</p>
                  </div>
                )}
              </div>
              <div className={styles.modalFooter}>
                <button className={styles.cancelBtn} onClick={() => setViewing(null)}>Schließen</button>
                <button className={styles.saveBtn} onClick={() => { const m = viewing; setViewing(null); openEdit(m); }}>Bearbeiten</button>
              </div>
            </div>
          </div>
        );
      })()}

      {showForm && (
        <div
          className={styles.overlay}
          onClick={() => setShowForm(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowForm(false)}
        >
          <div
            ref={diaryModalRef}
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="diary-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2 id="diary-modal-title">{editing ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</h2>
              <button onClick={() => setShowForm(false)} aria-label="Schließen">✕</button>
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
