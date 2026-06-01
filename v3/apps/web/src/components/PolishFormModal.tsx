import { useState } from 'react';
import type { Polish, Category } from '@nagellacke/core';
import { FINISH_OPTIONS, STATUS_OPTIONS, DEFAULT_POLISH } from '@nagellacke/core';
import styles from './PolishFormModal.module.css';

type FormData = Omit<Polish, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

export default function PolishFormModal({
  polish,
  categories,
  onSave,
  onClose,
}: {
  polish: Polish | null;
  categories: Category[];
  onSave: (data: Partial<FormData>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormData>(() =>
    polish
      ? { name: polish.name, brand: polish.brand, num: polish.num, color: polish.color,
          finish: polish.finish, status: polish.status, count: polish.count ?? 1,
          categories: polish.categories ?? [], notes: polish.notes ?? '',
          rating: polish.rating ?? 0, photo: polish.photo }
      : { ...DEFAULT_POLISH, photo: undefined },
  );

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>{polish ? 'Bearbeiten' : 'Neuer Lack'}</h2>
          <button onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          <label className={styles.field}>
            <span>Name *</span>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="z.B. Blue You A Kiss" />
          </label>
          <label className={styles.field}>
            <span>Marke</span>
            <input value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="z.B. OPI" />
          </label>
          <label className={styles.field}>
            <span>Nummer</span>
            <input value={form.num} onChange={(e) => set('num', e.target.value)} placeholder="z.B. NL B24" />
          </label>

          <div className={styles.row}>
            <label className={styles.field}>
              <span>Farbe</span>
              <div className={styles.colorRow}>
                <input type="color" value={form.color} onChange={(e) => set('color', e.target.value)} className={styles.colorPicker} />
                <span className={styles.colorHex}>{form.color}</span>
              </div>
            </label>
            <label className={styles.field}>
              <span>Finish</span>
              <select value={form.finish} onChange={(e) => set('finish', e.target.value as FormData['finish'])}>
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

          <label className={styles.field}>
            <span>Bewertung</span>
            <div className={styles.stars}>
              {[1,2,3,4,5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={n <= (form.rating ?? 0) ? styles.starOn : styles.starOff}
                  onClick={() => set('rating', n === form.rating ? 0 : n)}
                >★</button>
              ))}
            </div>
          </label>

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

          <label className={styles.field}>
            <span>Notizen</span>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
          </label>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Abbrechen</button>
          <button
            className={styles.saveBtn}
            onClick={() => { if (form.name.trim()) onSave(form); }}
          >Speichern</button>
        </div>
      </div>
    </div>
  );
}
