import { useState } from 'react';
import { useAppData, shouldShowFinishMigrationNotice } from './useAppData';
import { SnackbarProvider } from './components/Snackbar';
import FinishMigrationNotice from './components/FinishMigrationNotice';
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
  { id: 'cart',       label: '◈ Einkaufswagen' },
  { id: 'stickers',   label: '◈ Sticker' },
  { id: 'stats',      label: '◈ Statistiken' },
  { id: 'diary',      label: '◈ Tagebuch' },
  { id: 'settings',   label: '◈ Mehr' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('collection');
  const appData = useAppData();
  // `useAppData()` above runs `loadLocal()` synchronously as part of its own
  // `useState` initializer, which is what sets the migration-backup flag
  // `shouldShowFinishMigrationNotice()` reads. Must be initialized after that
  // call so the notice can already appear on the very first render post-
  // upgrade, instead of only from the next app start (days later for an
  // installed PWA).
  const [showFinishMigrationNotice, setShowFinishMigrationNotice] = useState(shouldShowFinishMigrationNotice);

  const polishes = appData.data.polishes.filter((p) => !p.deletedAt);
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
        {tab === 'collection' && <CollectionPage appData={appData} />}
        {tab === 'cart'       && <CartPage appData={appData} />}
        {tab === 'stickers'   && <StickersPage appData={appData} />}
        {tab === 'diary'      && <DiaryPage appData={appData} />}
        {tab === 'stats'      && <StatsPage appData={appData} />}
        {tab === 'settings'   && <SettingsPage appData={appData} />}
      </main>

      {showFinishMigrationNotice && (
        <FinishMigrationNotice
          onRollback={appData.rollbackFinishMigration}
          onClose={() => setShowFinishMigrationNotice(false)}
        />
      )}
    </div>
    </SnackbarProvider>
  );
}
