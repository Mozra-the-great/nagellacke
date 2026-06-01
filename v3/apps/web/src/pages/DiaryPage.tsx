import { useState } from 'react';
import type { Manicure } from '@nagellacke/core';
import { filterManicures } from '@nagellacke/core';
import type { useAppData } from '../useAppData';
import styles from './DiaryPage.module.css';

type AppData = ReturnType<typeof useAppData>;

export default function DiaryPage({ appData }: { appData: AppData }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Manicure | null>(null);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), polishes: [] as string[], notes: '' });

  const entries = filterManicures(appData.data.manicures)
    .sort((a, b) => b.date.localeCompare(a.date));

  const availablePolishes = appData.data.polishes.filter((p) => !p.deletedAt && p.status !== 'wish');

  const openNew = () => {
    setEditing(null);
    setForm({ date: new Date().toISOString().slice(0, 10), polishes: [], notes: '' });
    setShowForm(true);
  };

  const openEdit = (m: Manicure) => {
    setEditing(m);
    setForm({ date: m.date, polishes: [...m.polishes], notes: m.notes ?? '' });
    setShowForm(true);
  };

  const save = () => {
    if (editing) {
      appData.updateManicure(editing.id, form);
    } else {
      appData.addManicure(form);
    }
    setShowForm(false);
  };

  const togglePolish = (name: string) => {
    setForm((f) => ({
      ...f,
      polishes: f.polishes.includes(name) ? f.polishes.filter((x) => x !== name) : [...f.polishes, name],
    }));
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
          const usedPolishes = appData.data.polishes.filter((p) => m.polishes.includes(p.name));
          return (
            <div key={m.id} className={styles.entry} onClick={() => openEdit(m)}>
              <div className={styles.entryDate}>{formatDate(m.date)}</div>
              <div className={styles.entrySwatches}>
                {usedPolishes.slice(0, 5).map((p) => (
                  <div key={p.id} className={styles.swatch} style={{ background: p.color }} title={p.name} />
                ))}
              </div>
              {m.notes && <div className={styles.entryNotes}>{m.notes}</div>}
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
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              </label>
              <div className={styles.field}>
                <span>Verwendete Lacke</span>
                <div className={styles.polishPicker}>
                  {availablePolishes.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`${styles.polishChip} ${form.polishes.includes(p.name) ? styles.polishChipOn : ''}`}
                      onClick={() => togglePolish(p.name)}
                    >
                      <span className={styles.polishDot} style={{ background: p.color }} />
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
              <label className={styles.field}>
                <span>Notizen</span>
                <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} />
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
