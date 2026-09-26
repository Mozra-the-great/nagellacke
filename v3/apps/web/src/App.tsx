import { useState, useEffect, useCallback } from 'react';
import { useAppData, shouldShowFinishMigrationNotice } from './useAppData';
import { SnackbarProvider } from './components/Snackbar';
import LocalLoadErrorNotice from './components/LocalLoadErrorNotice';
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
import { fetchLegalPages, legalPageForHash, LEGAL_ROUTES } from './utils/legal';
import type { LegalPages } from './utils/legal';
import LegalPage from './pages/LegalPage';
import { refreshInstanceConfig, useInstanceConfig, brandingLogoSrc, DEFAULT_NAME, DEFAULT_TITLE } from './utils/instance';
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
  // Legal pages (#324 S12), fetched with the role below; see the hash routing further down.
  const [legal, setLegal] = useState<LegalPages | null>(null);
  const [legalLoaded, setLegalLoaded] = useState(false);
  const [authVersion, setAuthVersion] = useState(0);
  const refreshAuth = useCallback(() => setAuthVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetchRole(controller.signal).then((r) => { if (!cancelled) setRole(r); });
    // Same triggers as the role: a login can point the app at a different server,
    // and that server may offer a different set of features (#324).
    void refreshInstanceConfig(controller.signal);
    fetchLegalPages(controller.signal).then((p) => { if (!cancelled) { setLegal(p); setLegalLoaded(true); } });
    return () => { cancelled = true; controller.abort(); };
    // sessionRestored: after a reload the token only exists once useAppData has traded
    // the refresh cookie for it, which is after this effect first ran.
  }, [authVersion, appData.sessionRestored]);

  // Branding (#324 S8). Without an answer from the server everything stays as it
  // always was: the defaults below, index.html's title and the stylesheet's accent.
  const instanceConfig = useInstanceConfig();
  const branding = instanceConfig?.branding ?? null;
  const brandName = branding?.name ?? DEFAULT_NAME;
  const logoSrc = brandingLogoSrc(instanceConfig);
  const brandTitle = branding?.title ?? DEFAULT_TITLE;
  const accent = branding?.accentColor ?? null;
  useEffect(() => { document.title = brandTitle; }, [brandTitle]);
  useEffect(() => {
    // Only --md-primary: every other colour token stays as designed.
    const root = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const originalMeta = meta?.getAttribute('content') ?? null;
    if (accent) {
      root.style.setProperty('--md-primary', accent);
      meta?.setAttribute('content', accent);
    }
    return () => {
      root.style.removeProperty('--md-primary');
      if (meta && originalMeta !== null) meta.setAttribute('content', originalMeta);
    };
  }, [accent]);

  // Legal pages (#324 S12) live at #/impressum and #/datenschutz: shareable links, as an
  // Impressum needs, without a router dependency. They replace the tab content and are
  // reachable whatever the login state.
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const legalKey = legalPageForHash(hash);
  const leaveLegal = () => {
    history.pushState(null, '', window.location.pathname + window.location.search);
    setHash('');
  };

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
    <LocalLoadErrorNotice show={appData.localLoadError} />
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.appTitle}>
            {logoSrc ? <img className={styles.appLogo} src={logoSrc} alt={brandName} /> : brandName}
          </h1>
          {branding?.tagline && <p className={styles.appTagline}>{branding.tagline}</p>}
          <p className={styles.appSubtitle}>
            {plural(activeCount, 'Lack', 'Lacke')} im Besitz · {plural(totalCount, 'Flasche', 'Flaschen')} gesamt
          </p>
        </div>
        <nav className={styles.navRow}>
          {navItems.map(({ id, label }) => (
            <button
              key={id}
              className={`${styles.navBtn} ${tab === id ? styles.navBtnActive : ''} ${id === 'settings' ? styles.navBtnSettings : ''}`}
              onClick={() => { setTab(id); if (legalKey) leaveLegal(); }}
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
        {legalKey ? (
          legalLoaded
            ? <LegalPage page={legal?.[legalKey] ?? null} onBack={leaveLegal} />
            : null
        ) : (
        <ErrorBoundary key={tab}>
          {tab === 'collection' && <CollectionPage appData={appData} />}
          {tab === 'cart'       && <CartPage appData={appData} />}
          {tab === 'stickers'   && <StickersPage appData={appData} />}
          {tab === 'diary'      && <DiaryPage appData={appData} />}
          {tab === 'stats'      && <StatsPage appData={appData} />}
          {tab === 'settings'   && <SettingsPage appData={appData} role={role} onAuthChange={refreshAuth} />}
          {tab === 'admin' && role === 'admin' && <AdminPage />}
        </ErrorBoundary>
        )}
      </main>

      {/* Only pages that were actually maintained get a link, so an instance without
          legal texts looks exactly as before. */}
      {(legal?.impressum || legal?.datenschutz) && (
        <footer className={styles.footer}>
          {legal.impressum && <a href={LEGAL_ROUTES.impressum}>{legal.impressum.title}</a>}
          {legal.datenschutz && <a href={LEGAL_ROUTES.datenschutz}>{legal.datenschutz.title}</a>}
        </footer>
      )}

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
