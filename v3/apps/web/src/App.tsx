import { useState } from 'react';
import { useAppData } from './useAppData';
import { SnackbarProvider } from './components/Snackbar';
import ErrorBoundary from './components/ErrorBoundary';
import CollectionPage from './pages/CollectionPage';
import CartPage from './pages/CartPage';
import StickersPage from './pages/StickersPage';
import DiaryPage from './pages/DiaryPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import { plural } from './utils/plural';
import styles from './App.module.css';

type Tab = 'collection' | 'cart' | 'stickers' | 'diary' | 'stats' | 'settings';

const NAV_ITEMS: { id: Tab; label: string }[] = [
  { id: 'collection', label: '◈ Nagellack' },
  { id: 'stickers',   label: '◈ Sticker' },
  { id: 'diary',      label: '◈ Tagebuch' },
  { id: 'cart',       label: '◈ Einkaufswagen' },
  { id: 'stats',      label: '◈ Statistiken' },
  { id: 'settings',   label: '◈ Mehr' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('collection');
  const appData = useAppData();

  // Guard against corrupted sync/import data replacing `polishes` with a
  // non-array entirely (e.g. a malformed push) - see #218. A missing field on
  // an otherwise-valid entry is handled by the per-tab ErrorBoundary below.
  const polishesList = Array.isArray(appData.data.polishes) ? appData.data.polishes : [];
  const polishes = polishesList.filter((p) => !p.deletedAt);
  const ownedPolishes = polishes.filter((p) => p.status === 'ok');
  const activeCount = ownedPolishes.length;
  const totalCount = ownedPolishes.reduce((a, p) => a + (p.count ?? 1), 0);

  return (
    <SnackbarProvider>
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.appTitle}>Nail Lacquer</h1>
          <p className={styles.appSubtitle}>
            {activeCount} vorhanden · {plural(totalCount, 'Flasche', 'Flaschen')} gesamt
          </p>
        </div>
        <nav className={styles.navRow}>
          {NAV_ITEMS.map(({ id, label }) => (
            <button
              key={id}
              className={`${styles.navBtn} ${tab === id ? styles.navBtnActive : ''} ${id === 'settings' ? styles.navBtnSettings : ''}`}
              onClick={() => setTab(id)}
            >
              {id === 'settings' && appData.syncError && (
                <span
                  className={styles.syncErrorDot}
                  title={`Sync-Fehler: ${appData.syncError}`}
                  aria-label="Sync-Fehler"
                />
              )}
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className={styles.main}>
        {/* Keyed by tab so switching away from a crashed page (nav above stays
            usable, since it lives outside this boundary) remounts a clean
            boundary instead of staying stuck on the failed render - see #218. */}
        <ErrorBoundary key={tab}>
          {tab === 'collection' && <CollectionPage appData={appData} />}
          {tab === 'cart'       && <CartPage appData={appData} />}
          {tab === 'stickers'   && <StickersPage appData={appData} />}
          {tab === 'diary'      && <DiaryPage appData={appData} />}
          {tab === 'stats'      && <StatsPage appData={appData} />}
          {tab === 'settings'   && <SettingsPage appData={appData} />}
        </ErrorBoundary>
      </main>
    </div>
    </SnackbarProvider>
  );
}
