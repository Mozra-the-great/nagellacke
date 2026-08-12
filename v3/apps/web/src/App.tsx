import { useState, useEffect, useCallback } from 'react';
import { useAppData, shouldShowFinishMigrationNotice } from './useAppData';
import { SnackbarProvider } from './components/Snackbar';
import FinishMigrationNotice from './components/FinishMigrationNotice';
import ErrorBoundary from './components/ErrorBoundary';
import CollectionPage from './pages/CollectionPage';
import CartPage from './pages/CartPage';
import StickersPage from './pages/StickersPage';
import DiaryPage from './pages/DiaryPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';
import { plural } from './utils/plural';
import { fetchRole } from './utils/auth';
import type { Role } from './utils/auth';
import styles from './App.module.css';

type Tab = 'collection' | 'cart' | 'stickers' | 'diary' | 'stats' | 'settings' | 'admin';

const BASE_NAV_ITEMS: { id: Tab; label: string }[] = [
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
  // `useAppData()` above runs `loadLocal()` synchronously as part of its own
  // `useState` initializer, which is what sets the migration-backup flag
  // `shouldShowFinishMigrationNotice()` reads. Must be initialized after that
  // call so the notice can already appear on the very first render post-
  // upgrade, instead of only from the next app start (days later for an
  // installed PWA).
  const [showFinishMigrationNotice, setShowFinishMigrationNotice] = useState(shouldShowFinishMigrationNotice);

  // Role isn't part of useAppData (that hook owns the collection, not
  // identity) — App.tsx has no auth state at all otherwise, since login
  // lives inside SettingsPage and only ever wrote to localStorage. Probed on
  // mount and re-probed whenever authVersion changes (login/logout/bootstrap
  // inside SettingsPage/AdminPage call refreshAuth()). A missing/failed probe
  // resolves to null, so non-admins — and anyone on an older server that
  // doesn't send `role` yet — never see the tab at all, not merely disabled.
  const [role, setRole] = useState<Role | null>(null);
  const [authVersion, setAuthVersion] = useState(0);
  const refreshAuth = useCallback(() => setAuthVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetchRole(controller.signal).then((r) => { if (!cancelled) setRole(r); });
    return () => { cancelled = true; controller.abort(); };
  }, [authVersion]);

  const navItems = role === 'admin'
    ? [...BASE_NAV_ITEMS, { id: 'admin' as const, label: '◈ Admin' }]
    : BASE_NAV_ITEMS;

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
          {navItems.map(({ id, label }) => (
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
          {tab === 'settings'   && <SettingsPage appData={appData} role={role} onAuthChange={refreshAuth} />}
          {tab === 'admin' && role === 'admin' && <AdminPage />}
        </ErrorBoundary>
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
