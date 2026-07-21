import { useState, useMemo, useRef } from 'react';
import type { Polish } from '@nagellacke/core';
import type { useAppData } from '../useAppData';
import { loadPhotoDefault } from '../useAppData';
import PolishFormModal from '../components/PolishFormModal';
import NailBottle from '../components/NailBottle';
import { useSnackbar } from '../components/Snackbar';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { plural } from '../utils/plural';
import { aiAvailable, requestAutofillForNewPolish, requestSmartCart, pollAiJob } from '../utils/ai';
import styles from './CartPage.module.css';

type AppData = ReturnType<typeof useAppData>;

export default function CartPage({ appData }: { appData: AppData }) {
  const { showSnackbar } = useSnackbar();
  const photoDefault = loadPhotoDefault();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Polish | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [prompt, setPrompt] = useState('');
  const [smartCartStatus, setSmartCartStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [smartCartError, setSmartCartError] = useState('');

  const pickerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(pickerRef, showPicker);

  const activeCategories = appData.data.customCats.filter((c) => !c.deletedAt);

  const cartItems = useMemo(
    () => appData.data.polishes.filter((p) => !p.deletedAt && p.status === 'wish'),
    [appData.data.polishes],
  );
  const collectionItems = useMemo(
    () => appData.data.polishes.filter((p) => !p.deletedAt && p.status !== 'wish'),
    [appData.data.polishes],
  );
  const pickerResults = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    const base = !q ? collectionItems : collectionItems.filter(
      (p) => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q),
    );
    return base.slice(0, 30);
  }, [collectionItems, pickerSearch]);

  const addFromCollection = (p: Polish) => {
    appData.addPolish({
      name: p.name, brand: p.brand, num: p.num, color: p.color, finish: p.finish,
      status: 'wish', count: 1, categories: p.categories, notes: p.notes, rating: 0, photo: undefined,
    });
    setShowPicker(false);
    showSnackbar(`„${p.name}" zum Einkaufswagen hinzugefügt`);
  };

  const markBought = (p: Polish) => {
    appData.updatePolish(p.id, { status: 'ok' });
    showSnackbar(`„${p.name}" gekauft ✓`, () => appData.updatePolish(p.id, { status: 'wish' }));
  };

  const runSmartCart = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setSmartCartStatus('running');
    setSmartCartError('');
    try {
      const jobId = await requestSmartCart(trimmed);
      const job = await pollAiJob(jobId);
      if (job.status === 'error') throw new Error(job.error ?? 'KI-Anfrage fehlgeschlagen');
      const added = (job.result as { added?: unknown[] } | undefined)?.added ?? [];
      await appData.sync(); // pull the newly server-added cart items into local view
      setPrompt('');
      setSmartCartStatus('idle');
      showSnackbar(
        added.length > 0
          ? `✨ ${plural(added.length, 'Lack', 'Lacke')} zum Einkaufswagen hinzugefügt`
          : 'KI hat keine passenden, real existierenden Lacke gefunden',
      );
    } catch (e) {
      setSmartCartError(e instanceof Error ? e.message : 'KI-Anfrage fehlgeschlagen');
      setSmartCartStatus('error');
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2 className={styles.title}>Einkaufswagen</h2>
        <button className={styles.addBtn} onClick={() => setShowPicker(true)} aria-label="Lack hinzufügen">+</button>
      </header>

      {aiAvailable() && (
        <section className={styles.aiSection}>
          <label className={styles.field}>
            <span>✨ KI-Vorschlag per Prompt</span>
            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='z.B. „Füge Catrice Nagellacke ohne Shimmer/Sparkle hinzu, um den ganzen Regenbogen zu besitzen“'
            />
          </label>
          {smartCartStatus === 'error' && <div className={styles.errorBanner}>{smartCartError}</div>}
          <button
            className={styles.aiBtn}
            onClick={() => void runSmartCart()}
            disabled={!prompt.trim() || smartCartStatus === 'running'}
          >
            {smartCartStatus === 'running' ? 'KI recherchiert…' : '✨ Vorschläge suchen'}
          </button>
        </section>
      )}

      <div className={styles.count}>{plural(cartItems.length, 'Lack', 'Lacke')} im Einkaufswagen</div>

      <div className={styles.grid}>
        {cartItems.length === 0 && (
          <div className={styles.empty}>Noch nichts im Einkaufswagen — füge einen Lack hinzu!</div>
        )}
        {cartItems.map((p) => (
          <div key={p.id} className={styles.card}>
            <button
              className={styles.bottleBtn}
              onClick={() => { setEditing(p); setShowForm(true); }}
              aria-label={`${p.name} bearbeiten`}
            >
              <NailBottle
                color={p.color}
                finish={p.finish}
                status={p.status}
                brand={p.brand}
                photoUrl={p.photo && photoDefault ? `/photos/${p.photo}` : undefined}
              />
            </button>
            <div className={styles.info}>
              <div className={styles.name} title={p.name}>{p.name}</div>
              {p.brand && <div className={styles.brand}>{p.brand}</div>}
              {p.notes && <div className={styles.notes} title={p.notes}>{p.notes}</div>}
            </div>
            <div className={styles.actions}>
              <button className={styles.buyBtn} onClick={() => markBought(p)}>Gekauft ✓</button>
              <button
                className={styles.removeBtn}
                onClick={() => {
                  const cleanup = appData.deletePolish(p.id);
                  showSnackbar(`„${p.name}" entfernt`, () => appData.restorePolish(p.id), cleanup);
                }}
                aria-label="Entfernen"
              >✕</button>
            </div>
          </div>
        ))}
      </div>

      {showPicker && (
        <div
          className={styles.overlay}
          onClick={() => setShowPicker(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowPicker(false)}
        >
          <div
            ref={pickerRef}
            className={styles.pickerModal}
            role="dialog"
            aria-modal="true"
            aria-label="Lack zum Einkaufswagen hinzufügen"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h3>Hinzufügen</h3>
              <button onClick={() => setShowPicker(false)} aria-label="Schließen">✕</button>
            </div>
            <div className={styles.pickerBody}>
              <button
                className={styles.newEntryBtn}
                onClick={() => { setShowPicker(false); setEditing(null); setShowForm(true); }}
              >+ Komplett neuer Lack</button>

              <input
                className={styles.pickerSearch}
                placeholder="In Sammlung suchen…"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
              />
              <div className={styles.pickerList}>
                {pickerResults.length === 0 && <div className={styles.empty}>Keine Treffer in der Sammlung</div>}
                {pickerResults.map((p) => (
                  <button key={p.id} className={styles.pickerItem} onClick={() => addFromCollection(p)}>
                    <NailBottle color={p.color} finish={p.finish} status={p.status} brand={p.brand} />
                    <span className={styles.pickerItemText}>
                      <strong>{p.name}</strong>
                      {p.brand && <em> · {p.brand}</em>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <PolishFormModal
          polish={editing}
          categories={activeCategories}
          allPolishes={appData.data.polishes}
          aiAvailable={aiAvailable()}
          defaultStatus="wish"
          onSave={(p, useAi) => {
            if (editing) {
              appData.updatePolish(editing.id, p);
            } else {
              const item = appData.addPolish({
                ...(p as Omit<Polish, 'id' | 'createdAt' | 'updatedAt'>),
                status: p.status ?? 'wish',
              });
              if (useAi) {
                requestAutofillForNewPolish(item)
                  .then(() => showSnackbar('✨ KI recherchiert Farbe & Finish im Hintergrund…'))
                  .catch((e: unknown) => showSnackbar(e instanceof Error ? e.message : 'KI-Anfrage fehlgeschlagen'));
              }
            }
            setShowForm(false);
          }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
