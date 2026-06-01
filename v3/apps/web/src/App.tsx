import { useState } from 'react';
import { useAppData } from './useAppData';
import CollectionPage from './pages/CollectionPage';
import StickersPage from './pages/StickersPage';
import DiaryPage from './pages/DiaryPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import styles from './App.module.css';

type Tab = 'collection' | 'stickers' | 'diary' | 'stats' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('collection');
  const appData = useAppData();

  return (
    <div className={styles.app}>
      <main className={styles.main}>
        {tab === 'collection' && <CollectionPage appData={appData} />}
        {tab === 'stickers'   && <StickersPage appData={appData} />}
        {tab === 'diary'      && <DiaryPage appData={appData} />}
        {tab === 'stats'      && <StatsPage appData={appData} />}
        {tab === 'settings'   && <SettingsPage appData={appData} />}
      </main>

      <nav className={styles.nav}>
        <NavBtn active={tab === 'collection'} onClick={() => setTab('collection')} icon="💅" label="Lacke" />
        <NavBtn active={tab === 'stickers'}   onClick={() => setTab('stickers')}   icon="✨" label="Sticker" />
        <NavBtn active={tab === 'diary'}      onClick={() => setTab('diary')}      icon="📖" label="Tagebuch" />
        <NavBtn active={tab === 'stats'}      onClick={() => setTab('stats')}      icon="📊" label="Statistik" />
        <NavBtn active={tab === 'settings'}   onClick={() => setTab('settings')}   icon="⚙️" label="Mehr" />
      </nav>
    </div>
  );
}

function NavBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button className={`${styles.navBtn} ${active ? styles.navBtnActive : ''}`} onClick={onClick}>
      <span className={styles.navIcon}>{icon}</span>
      <span className={styles.navLabel}>{label}</span>
    </button>
  );
}
