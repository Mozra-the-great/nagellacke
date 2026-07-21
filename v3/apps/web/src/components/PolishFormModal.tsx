import { useState, useRef, useMemo } from 'react';
import type { Polish, Category } from '@nagellacke/core';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { FINISH_OPTIONS, STATUS_OPTIONS, DEFAULT_POLISH, hexToHue } from '@nagellacke/core';
import { hasServerSync } from '../utils/ai';
import PhotoField from './PhotoField';
import ColorFromPhoto from './ColorFromPhoto';
import styles from './PolishFormModal.module.css';

type FormData = Omit<Polish, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

function isSaturated(hex: string): boolean {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return false;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return Math.max(r, g, b) - Math.min(r, g, b) > 0.15;
}

export default function PolishFormModal({
  polish,
  categories,
  allPolishes,
  initialStatus,
  onSave,
  onClose,
}: {
  polish: Polish | null;
  categories: Category[];
  allPolishes: Polish[];
  initialStatus?: Polish['status'];
  onSave: (data: Partial<FormData>, aiAutofill: boolean) => void;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true);

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [aiAutofill, setAiAutofill] = useState(false);
  const aiAvailable = !polish && hasServerSync();

  const [form, setForm] = useState<FormData>(() =>
    polish
      ? { name: polish.name, brand: polish.brand, num: polish.num, color: polish.color,
          finish: polish.finish, status: polish.status, count: polish.count ?? 1,
          categories: polish.categories ?? [], notes: polish.notes ?? '',
          rating: polish.rating ?? 0, photo: polish.photo }
      : { ...DEFAULT_POLISH, status: initialStatus ?? DEFAULT_POLISH.status, photo: undefined },
  );

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const nameValid = form.name.trim().length > 0;

  const duplicates = useMemo(() => {
    if (polish) return []; // editing → no check
    if (!isSaturated(form.color)) return [];
    const hue = hexToHue(form.color);
    return allPolishes.filter((p) => {
      if (p.deletedAt) return false;
      if (!isSaturated(p.color)) return false;
      const diff = Math.abs(hexToHue(p.color) - hue);
      return Math.min(diff, 360 - diff) <= 15 && p.finish === form.finish;
    });
  }, [form.color, form.finish, polish, allPolishes]);

  return (
    <>
      <div
        className={styles.overlay}
        onClick={onClose}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div
          ref={modalRef}
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="polish-modal-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.header}>
            <h2 id="polish-modal-title">{polish ? 'Bearbeiten' : 'Neuer Lack'}</h2>
            <button onClick={onClose} aria-label="Schließen">✕</button>
          </div>

          <div className={styles.body}>
            <label className={styles.field}>
              <span>Name *</span>
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                onBlur={() => setNameTouched(true)}
                placeholder="z.B. Blue You A Kiss"
                aria-invalid={nameTouched && !nameValid}
                className={nameTouched && !nameValid ? styles.invalid : undefined}
              />
              {nameTouched && !nameValid && (
                <span className={styles.errorText}>Name ist ein Pflichtfeld</span>
              )}
            </label>
            <label className={styles.field}>
              <span>Marke</span>
              <input value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="z.B. OPI" />
            </label>
            <label className={styles.field}>
              <span>Nummer</span>
              <input value={form.num} onChange={(e) => set('num', e.target.value)} placeholder="z.B. NL B24" />
            </label>

            {aiAvailable && (
              <label className={styles.aiToggle}>
                <input
                  type="checkbox"
                  checked={aiAutofill}
                  onChange={(e) => setAiAutofill(e.target.checked)}
                />
                <span>✨ KI recherchiert Farbe &amp; Finish automatisch</span>
              </label>
            )}

            <div className={styles.row}>
              <div className={styles.field}>
                <span>Farbe {aiAutofill && <span className={styles.fieldHint}>(wird von der KI ermittelt)</span>}</span>
                <div className={styles.colorRow}>
                  <input type="color" value={form.color} onChange={(e) => set('color', e.target.value)} className={styles.colorPicker} disabled={aiAutofill} />
                  <span className={styles.colorHex}>{form.color}</span>
                  <button
                    type="button"
                    className={styles.colorFromPhotoBtn}
                    onClick={() => setShowColorPicker(true)}
                    aria-label="Farbe aus Foto"
                    title="Farbe aus Foto"
                    disabled={aiAutofill}
                  >📷</button>
                </div>
                {duplicates.length > 0 && (
                  <div className={styles.duplicateWarning}>
                    ⚠ Ähnlich wie: {duplicates.map((p) => `„${p.name}"`).join(', ')}
                  </div>
                )}
              </div>
              <label className={styles.field}>
                <span>Finish {aiAutofill && <span className={styles.fieldHint}>(wird von der KI ermittelt)</span>}</span>
                <select value={form.finish} onChange={(e) => set('finish', e.target.value as FormData['finish'])} disabled={aiAutofill}>
                  {FINISH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.icon} {o.label}</option>)}
                </select>
              </label>
            </div>

            <div className={styles.row}>
              <label className={styles.field}>
                <span>Status</span>
                <select value={form.status} onChange={(e) => set('status', e.target.value as FormData['status'])}>
                  {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span>Anzahl</span>
                <input type="number" min={1} value={form.count} onChange={(e) => set('count', Number(e.target.value))} />
              </label>
            </div>

            <div className={styles.field}>
              <span>Bewertung</span>
              <div className={styles.stars} role="group" aria-label="Bewertung">
                {[1,2,3,4,5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} Stern${n > 1 ? 'e' : ''}`}
                    aria-pressed={n <= (form.rating ?? 0)}
                    className={n <= (form.rating ?? 0) ? styles.starOn : styles.starOff}
                    onClick={() => set('rating', n === form.rating ? 0 : n)}
                  >★</button>
                ))}
              </div>
            </div>

            {categories.length > 0 && (
              <label className={styles.field}>
                <span>Kategorien</span>
                <div className={styles.chips}>
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={(form.categories ?? []).includes(c.id) ? styles.chipOn : styles.chipOff}
                      onClick={() => {
                        const curr = form.categories ?? [];
                        set('categories', curr.includes(c.id) ? curr.filter((x) => x !== c.id) : [...curr, c.id]);
                      }}
                    >{c.label}</button>
                  ))}
                </div>
              </label>
            )}

            <div className={styles.field}>
              <span>Foto</span>
              <PhotoField value={form.photo} onChange={(f) => set('photo', f)} />
            </div>

            <label className={styles.field}>
              <span>Notizen</span>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
            </label>
          </div>

          <div className={styles.footer}>
            <button className={styles.cancelBtn} onClick={onClose}>Abbrechen</button>
            <button
              className={styles.saveBtn}
              disabled={!nameValid}
              onClick={() => onSave(form, aiAutofill)}
            >Speichern</button>
          </div>
        </div>
      </div>

      {showColorPicker && (
        <ColorFromPhoto
          onColorPicked={(hex) => { set('color', hex); setShowColorPicker(false); }}
          onClose={() => setShowColorPicker(false)}
        />
      )}
    </>
  );
}
