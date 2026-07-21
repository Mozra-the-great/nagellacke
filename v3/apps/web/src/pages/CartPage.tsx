import { useState, useMemo, useRef } from 'react';
import type { Polish } from '@nagellacke/core';
import { FINISH_OPTIONS } from '@nagellacke/core';
import type { useAppData } from '../useAppData';
import { loadPhotoDefault } from '../useAppData';
import PolishCard from '../components/PolishCard';
import PolishFormModal from '../components/PolishFormModal';
import NailBottle from '../components/NailBottle';
import { useSnackbar } from '../components/Snackbar';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { plural } from '../utils/plural';
import { hasServerSync, startAutofillJob, startSmartCartJob, pollAiJob } from '../utils/ai';
import styles from './CartPage.module.css';

type AppData = ReturnType<typeof useAppData>;

export default function CartPage({ appData }: { appData: AppData }) {
  const [viewing, setViewing] = useState<Polish | null>(null);
  const [showChooser, setShowChooser] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Polish | null>(null);
  const { showSnackbar } = useSnackbar();
  const detailRef = useRef<HTMLDivElement>(null);
  const chooserRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(detailRef, !!viewing);
  useFocusTrap(chooserRef, showChooser);
  useFocusTrap(pickerRef, showPicker);
  const photoDefault = loadPhotoDefault();
  const serverSyncAvailable = hasServerSync();

  const cartItems = useMemo(
    () => appData.data.polishes.filter((p) => !p.deletedAt && p.status === 'wish'),
    [appData.data.polishes],
  );
  const activeCategories = appData.data.customCats.filter((c) => !c.deletedAt);

  const pickableCandidates = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return appData.data.polishes
      .filter((p) => !p.deletedAt && p.status !== 'wish')
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))
      .slice(0, 50);
  }, [appData.data.polishes, pickerSearch]);

  const addExisting = (p: Polish) => {
    appData.addPolish({
      name: p.name, brand: p.brand, num: p.num, color: p.color, finish: p.finish,
      status: 'wish', count: 1, categories: [], notes: '', rating: 0,
    });
    setShowPicker(false);
    setShowChooser(false);
    setPickerSearch('');
    showSnackbar(`„${p.name}" zum Einkaufswagen hinzugefügt`);
  };

  const runAutofill = async (polish: Polish) => {
    try {
      const { jobId } = await startAutofillJob({ name: polish.name, brand: polish.brand, num: polish.num });
      const job = await pollAiJob(jobId);
      if (job.status === 'error') throw new Error(job.error ?? 'Unbekannter Fehler');
      const result = job.result as { color?: string; finish?: string } | undefined;
      if (result?.color && result?.finish) {
        appData.updatePolish(polish.id, { color: result.color, finish: result.finish as Polish['finish'] });
      }
      void appData.sync();
      showSnackbar(`✨ KI hat Farbe & Finish für „${polish.name}" ermittelt`);
    } catch (e) {
      showSnackbar(`KI-Recherche fehlgeschlagen: ${e instanceof Error ? e.message : 'Unbekannter Fehler'}`);
    }
  };

  // ── Smart-Cart prompt ──
  const [prompt, setPrompt] = useState('');
  const [smartCartStatus, setSmartCartStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [smartCartError, setSmartCartError] = useState('');

  const runSmartCart = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setSmartCartStatus('running');
    setSmartCartError('');
    try {
      const { jobId } = await startSmartCartJob(trimmed);
      const job = await pollAiJob(jobId, { timeoutMs: 180_000 });
      if (job.status === 'error') throw new Error(job.error ?? 'Unbekannter Fehler');
      await appData.sync();
      const added = (job.result as { added?: number } | undefined)?.added ?? 0;
      showSnackbar(added > 0
        ? `✨ ${plural(added, 'Lack', 'Lacke')} zum Einkaufswagen hinzugefügt`
        : 'Keine passenden, real existierenden Produkte gefunden');
      setPrompt('');
      setSmartCartStatus('idle');
    } catch (e) {
      setSmartCartError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      setSmartCartStatus('error');
    }
  };

  const markBought = (p: Polish) => {
    appData.updatePolish(p.id, { status: 'ok' });
    setViewing(null);
    showSnackbar(`„${p.name}" gekauft — jetzt in der Sammlung`);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2 className={styles.title}>Einkaufswagen</h2>
        <button className={styles.addBtn} onClick={() => setShowChooser(true)} aria-label="Zum Einkaufswagen hinzufügen">+</button>
      </header>

      <section className={styles.smartCart}>
        <h3 className={styles.smartCartTitle}>✨ Smart-Cart</h3>
        {!serverSyncAvailable ? (
          <p className={styles.fieldHint}>Smart-Cart und KI Auto-Fill benötigen Server-Sync (Einstellungen → Sync) und einen konfigurierten KI-Anbieter (Einstellungen → KI-Assistenz).</p>
        ) : (
          <>
            <p className={styles.fieldHint}>
              Beschreibe, was dir fehlt — z.B. „Füge Catrice Nagellacke ohne Shimmer/Sparkle hinzu, um den gesamten Regenbogen zu besitzen".
            </p>
            <textarea
              className={styles.promptInput}
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Was möchtest du deiner Sammlung hinzufügen?"
              disabled={smartCartStatus === 'running'}
            />
            {smartCartStatus === 'error' && <div className={styles.errorBanner}>{smartCartError}</div>}
            <button
              className={styles.smartCartBtn}
              onClick={() => void runSmartCart()}
              disabled={!prompt.trim() || smartCartStatus === 'running'}
            >
              {smartCartStatus === 'running' ? 'KI recherchiert…' : '✨ Vorschläge finden'}
            </button>
          </>
        )}
      </section>

      <div className={styles.count}>{plural(cartItems.length, 'Lack', 'Lacke')} im Einkaufswagen</div>

      <div className={styles.grid}>
        {cartItems.length === 0 && (
          <div className={styles.empty}>Noch nichts im Einkaufswagen — füge einen Lack hinzu!</div>
        )}
        {cartItems.map((p) => (
          <PolishCard
            key={p.id}
            polish={p}
            defaultShowPhoto={photoDefault}
            onEdit={() => setViewing(p)}
            onDelete={() => {
              const cleanup = appData.deletePolish(p.id);
              showSnackbar(`„${p.name}" entfernt`, () => appData.restorePolish(p.id), cleanup);
            }}
          />
        ))}
      </div>

      {showChooser && (
        <div className={styles.overlay} onClick={() => setShowChooser(false)} onKeyDown={(e) => e.key === 'Escape' && setShowChooser(false)}>
          <div ref={chooserRef} className={styles.chooserModal} role="dialog" aria-modal="true" aria-labelledby="chooser-title" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 id="chooser-title">Hinzufügen</h2>
              <button onClick={() => setShowChooser(false)} aria-label="Schließen">✕</button>
            </div>
            <div className={styles.chooserBody}>
              <button className={styles.chooserOption} onClick={() => { setShowChooser(false); setShowPicker(true); }}>
                <span className={styles.chooserIcon}>◈</span>
                <span>Aus meiner Sammlung</span>
              </button>
              <button className={styles.chooserOption} onClick={() => { setShowChooser(false); setEditing(null); setShowForm(true); }}>
                <span className={styles.chooserIcon}>+</span>
                <span>Komplett neuer Lack</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showPicker && (
        <div className={styles.overlay} onClick={() => setShowPicker(false)} onKeyDown={(e) => e.key === 'Escape' && setShowPicker(false)}>
          <div ref={pickerRef} className={styles.pickerModal} role="dialog" aria-modal="true" aria-labelledby="picker-title" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 id="picker-title">Aus Sammlung wählen</h2>
              <button onClick={() => setShowPicker(false)} aria-label="Schließen">✕</button>
            </div>
            <div className={styles.pickerSearchRow}>
              <input
                autoFocus
                className={styles.pickerSearchInput}
                placeholder="Suchen…"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
              />
            </div>
            <div className={styles.pickerList}>
              {pickableCandidates.length === 0 && (
                <div className={styles.empty}>Keine Lacke gefunden.</div>
              )}
              {pickableCandidates.map((p) => (
                <button key={p.id} className={styles.pickerItem} onClick={() => addExisting(p)}>
                  <span className={styles.pickerColorDot} style={{ background: p.color }} />
                  <span className={styles.pickerItemInfo}>
                    <span className={styles.pickerItemName}>{p.name}</span>
                    {p.brand && <span className={styles.pickerItemBrand}>{p.brand}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <div className={styles.overlay} onClick={() => setViewing(null)} onKeyDown={(e) => e.key === 'Escape' && setViewing(null)}>
          <div ref={detailRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="cart-detail-title" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeaderRight}>
              <button onClick={() => setViewing(null)} aria-label="Schließen">✕</button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.detailPreview}>
                {viewing.photo
                  ? <img src={`/photos/${viewing.photo}`} alt={viewing.name} className={styles.detailPhoto} />
                  : <NailBottle color={viewing.color} finish={viewing.finish} status={viewing.status} brand={viewing.brand} />
                }
              </div>
              <h2 id="cart-detail-title" className={styles.detailName}>{viewing.name}</h2>
              {viewing.brand && <div className={styles.detailBrand}>{viewing.brand}</div>}
              <div className={styles.detailGrid}>
                {viewing.num && (
                  <div className={styles.detailCell}><span>Nummer</span><span>{viewing.num}</span></div>
                )}
                <div className={styles.detailCell}>
                  <span>Finish</span><span>{FINISH_OPTIONS.find((o) => o.value === viewing.finish)?.icon} {viewing.finish}</span>
                </div>
              </div>
              {viewing.notes && <p className={styles.detailNotes}>{viewing.notes}</p>}
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => { const p = viewing; setViewing(null); setEditing(p); setShowForm(true); }}>Bearbeiten</button>
              <button className={styles.boughtBtn} onClick={() => markBought(viewing)}>Gekauft ✓</button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <PolishFormModal
          polish={editing}
          categories={activeCategories}
          allPolishes={appData.data.polishes}
          initialStatus="wish"
          onSave={(p, aiAutofill) => {
            if (editing) {
              appData.updatePolish(editing.id, p);
            } else {
              const created = appData.addPolish(p as Omit<Polish, 'id' | 'createdAt' | 'updatedAt'>);
              if (aiAutofill) void runAutofill(created);
            }
            setShowForm(false);
          }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
