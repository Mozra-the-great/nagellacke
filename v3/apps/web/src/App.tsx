import { useState } from 'react';
import { useAppData } from './useAppData';
import CollectionPage from './pages/CollectionPage';
import StickersPage from './pages/StickersPage';
import DiaryPage from './pages/DiaryPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import styles from './App.module.css';

type Tab = 'collection' | 'stickers' | 'diary' | 'stats' | 'settings';

const NAV_ITEMS: { id: Tab; label: string }[] = [
  { id: 'collection', label: '◈ Nagellack' },
  { id: 'stickers',   label: '◈ Sticker' },
  { id: 'stats',      label: '◈ Statistiken' },
  { id: 'diary',      label: '◈ Tagebuch' },
  { id: 'settings',   label: '◈ Mehr' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('collection');
  const appData = useAppData();

  const polishes = appData.data.polishes.filter((p) => !p.deletedAt);
  const activeCount = polishes.filter((p) => p.status === 'ok').length;
  const totalCount = polishes.reduce((a, p) => a + (p.count ?? 1), 0);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.appTitle}>Nail Lacquer</h1>
          <p className={styles.appSubtitle}>
            {activeCount} vorhanden · {totalCount} Flaschen gesamt
          </p>
        </div>
        <nav className={styles.navRow}>
          {NAV_ITEMS.map(({ id, label }) => (
            <button
              key={id}
              className={`${styles.navBtn} ${tab === id ? styles.navBtnActive : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className={styles.main}>
        {tab === 'collection' && <CollectionPage appData={appData} />}
        {tab === 'stickers'   && <StickersPage appData={appData} />}
        {tab === 'diary'      && <DiaryPage appData={appData} />}
        {tab === 'stats'      && <StatsPage appData={appData} />}
        {tab === 'settings'   && <SettingsPage appData={appData} />}
      </main>
    </div>
  );
}
