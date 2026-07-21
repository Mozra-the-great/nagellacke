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
import styles from './CartPage.module.css';

type AppData = ReturnType<typeof useAppData>;

export default function CartPage({ appData }: { appData: AppData }) {
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState<Polish | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Polish | null>(null);
  const [showAddChoice, setShowAddChoice] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const { showSnackbar } = useSnackbar();
  const detailRef = useRef<HTMLDivElement>(null);
  const addChoiceRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(detailRef, !!viewing);
  useFocusTrap(addChoiceRef, showAddChoice);
  useFocusTrap(pickerRef, showPicker);
  const photoDefault = loadPhotoDefault();

  const cartItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return appData.data.polishes.filter((p) => {
      if (p.deletedAt || p.status !== 'wish') return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q);
    });
  }, [appData.data.polishes, search]);

  const pickable = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return appData.data.polishes
      .filter((p) => !p.deletedAt && p.status !== 'wish')
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q));
  }, [appData.data.polishes, pickerSearch]);

  const activeCategories = appData.data.customCats.filter((c) => !c.deletedAt);

  const addFromCollection = (source: Polish) => {
    appData.addPolish({
      name: source.name, brand: source.brand, num: source.num,
      color: source.color, finish: source.finish, status: 'wish',
      count: 1, categories: [], notes: '', rating: 0, photo: source.photo,
    });
    setShowPicker(false);
    setPickerSearch('');
    showSnackbar(`„${source.name}" in den Einkaufswagen gelegt`);
  };

  const markBought = (p: Polish) => {
    appData.updatePolish(p.id, { status: 'ok' });
    setViewing(null);
    showSnackbar(`„${p.name}" als gekauft markiert`);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2 className={styles.title}>Einkaufswagen</h2>
        <button
          className={styles.addBtn}
          onClick={() => setShowAddChoice(true)}
          aria-label="Zum Einkaufswagen hinzufügen"
        >+</button>
      </header>

      <div className={styles.searchRow}>
        <div className={styles.searchWrapper}>
          <input
            aria-label="Einkaufswagen durchsuchen"
            className={styles.searchInput}
            placeholder="Suchen…"
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

      <div className={styles.count}>{plural(cartItems.length, 'Lack', 'Lacke')} im Einkaufswagen</div>

      <div className={styles.grid}>
        {cartItems.length === 0 && (
          <div className={styles.empty}>
            {search
              ? 'Keine Treffer — Suche anpassen.'
              : 'Dein Einkaufswagen ist leer.'}
          </div>
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

      {viewing && (
        <div className={styles.overlay} onClick={() => setViewing(null)} onKeyDown={(e) => e.key === 'Escape' && setViewing(null)}>
          <div ref={detailRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="cart-detail-title" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
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
              <button className={styles.saveBtn} onClick={() => markBought(viewing)}>Gekauft ✓</button>
            </div>
          </div>
        </div>
      )}

      {showAddChoice && (
        <div className={styles.overlay} onClick={() => setShowAddChoice(false)} onKeyDown={(e) => e.key === 'Escape' && setShowAddChoice(false)}>
          <div ref={addChoiceRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="cart-add-title" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <button onClick={() => setShowAddChoice(false)} aria-label="Schließen">✕</button>
            </div>
            <div className={styles.modalBody}>
              <h2 id="cart-add-title" className={styles.choiceTitle}>Wie möchtest du hinzufügen?</h2>
              <button className={styles.choiceBtn} onClick={() => { setShowAddChoice(false); setShowPicker(true); }}>
                🔍 Aus vorhandener Sammlung wählen
              </button>
              <button className={styles.choiceBtn} onClick={() => { setShowAddChoice(false); setEditing(null); setShowForm(true); }}>
                ✎ Komplett neuen Lack anlegen
              </button>
            </div>
          </div>
        </div>
      )}

      {showPicker && (
        <div className={styles.overlay} onClick={() => setShowPicker(false)} onKeyDown={(e) => e.key === 'Escape' && setShowPicker(false)}>
          <div ref={pickerRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="cart-picker-title" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 id="cart-picker-title" className={styles.choiceTitle}>Aus Sammlung wählen</h2>
              <button onClick={() => setShowPicker(false)} aria-label="Schließen">✕</button>
            </div>
            <div className={styles.searchRow}>
              <input
                aria-label="Sammlung durchsuchen"
                className={styles.searchInput}
                placeholder="Suchen…"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
              />
            </div>
            <div className={styles.pickerList}>
              {pickable.length === 0 && <div className={styles.empty}>Keine Lacke gefunden.</div>}
              {pickable.map((p) => (
                <button key={p.id} className={styles.pickerItem} onClick={() => addFromCollection(p)}>
                  <span className={styles.pickerDot} style={{ background: p.color }} />
                  <span className={styles.pickerName}>{p.name}</span>
                  {p.brand && <span className={styles.pickerBrand}>{p.brand}</span>}
                </button>
              ))}
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
          onSave={(p) => {
            if (editing) appData.updatePolish(editing.id, p);
            else appData.addPolish(p as Omit<Polish, 'id' | 'createdAt' | 'updatedAt'>);
            setShowForm(false);
          }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
