import { useState } from 'react';
import type { SyncConfig, SyncProviderType } from '@nagellacke/sync';
import type { AppData as CoreAppData } from '@nagellacke/core';
import { mergeData } from '@nagellacke/core';
import { loadSyncConfig, saveSyncConfig } from '../useAppData';
import type { useAppData } from '../useAppData';
import styles from './SettingsPage.module.css';

type AppData = ReturnType<typeof useAppData>;

export default function SettingsPage({ appData }: { appData: AppData }) {
  const [config, setConfig] = useState<SyncConfig | null>(loadSyncConfig);
  const [provider, setProvider] = useState<SyncProviderType | 'none'>(config?.provider ?? 'none');
  const [serverUrl, setServerUrl] = useState(config?.serverUrl ?? '');
  const [serverToken, setServerToken] = useState(config?.serverToken ?? '');
  const [ncUrl, setNcUrl] = useState(config?.nextcloudUrl ?? '');
  const [ncUser, setNcUser] = useState(config?.nextcloudUser ?? '');
  const [ncPass, setNcPass] = useState(config?.nextcloudPassword ?? '');
  const [saved, setSaved] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');

  const saveConfig = () => {
    if (provider === 'none') {
      saveSyncConfig(null);
      setConfig(null);
    } else if (provider === 'server') {
      const c: SyncConfig = { provider, serverUrl, serverToken };
      saveSyncConfig(c);
      setConfig(c);
    } else if (provider === 'nextcloud') {
      const c: SyncConfig = { provider, nextcloudUrl: ncUrl, nextcloudUser: ncUser, nextcloudPassword: ncPass };
      saveSyncConfig(c);
      setConfig(c);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(appData.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nagellacke-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result as string) as Partial<CoreAppData>;
        const valid: CoreAppData = {
          polishes:   Array.isArray(imported.polishes)   ? imported.polishes   : [],
          customCats: Array.isArray(imported.customCats) ? imported.customCats : [],
          manicures:  Array.isArray(imported.manicures)  ? imported.manicures  : [],
          stickers:   Array.isArray(imported.stickers)   ? imported.stickers   : [],
        };
        const merged = mergeData(appData.data, valid);
        // Push merged data through the commit path by calling importMerge
        appData.importMerge(merged);
        alert(`Import erfolgreich: ${valid.polishes.length} Lacke, ${valid.stickers.length} Sticker, ${valid.manicures.length} Maniküren.`);
      } catch {
        alert('Ungültige JSON-Datei');
      }
    };
    reader.readAsText(file);
  };

  const stats = {
    polishes: appData.data.polishes.filter((p) => !p.deletedAt).length,
    stickers: appData.data.stickers.filter((s) => !s.deletedAt).length,
    manicures: appData.data.manicures.filter((m) => !m.deletedAt).length,
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Einstellungen</h1>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Statistik</h2>
        <div className={styles.statsGrid}>
          <div className={styles.stat}><div className={styles.statNum}>{stats.polishes}</div><div className={styles.statLabel}>Lacke</div></div>
          <div className={styles.stat}><div className={styles.statNum}>{stats.stickers}</div><div className={styles.statLabel}>Sticker</div></div>
          <div className={styles.stat}><div className={styles.statNum}>{stats.manicures}</div><div className={styles.statLabel}>Maniküren</div></div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Sync</h2>

        {appData.syncError && (
          <div className={styles.errorBanner}>Sync-Fehler: {appData.syncError}</div>
        )}
        {appData.lastSyncAt && (
          <div className={styles.infoText}>
            Letzter Sync: {new Date(appData.lastSyncAt).toLocaleString('de-DE')}
          </div>
        )}

        <label className={styles.field}>
          <span>Sync-Anbieter</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value as SyncProviderType | 'none')}>
            <option value="none">Kein Sync (nur lokal)</option>
            <option value="server">Eigener Server</option>
            <option value="nextcloud">Nextcloud</option>
            <option value="googledrive">Google Drive</option>
            <option value="onedrive">OneDrive</option>
            <option value="dropbox">Dropbox</option>
          </select>
        </label>

        {provider === 'server' && (
          <>
            <label className={styles.field}>
              <span>Server-URL</span>
              <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="http://192.168.1.100:3001" />
            </label>
            <label className={styles.field}>
              <span>JWT-Token</span>
              <input type="password" value={serverToken} onChange={(e) => setServerToken(e.target.value)} placeholder="Token vom Login" />
            </label>
          </>
        )}

        {provider === 'nextcloud' && (
          <>
            <label className={styles.field}>
              <span>Nextcloud-URL</span>
              <input value={ncUrl} onChange={(e) => setNcUrl(e.target.value)} placeholder="https://meine.nextcloud.de" />
            </label>
            <label className={styles.field}>
              <span>Benutzername</span>
              <input value={ncUser} onChange={(e) => setNcUser(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Passwort / App-Token</span>
              <input type="password" value={ncPass} onChange={(e) => setNcPass(e.target.value)} />
            </label>
          </>
        )}

        {(provider === 'googledrive' || provider === 'onedrive' || provider === 'dropbox') && (
          <div className={styles.oauthHint}>
            OAuth2-Login wird in der Android-App unterstützt. Für die Web-App wird der Eigene-Server-Adapter empfohlen.
          </div>
        )}

        <div className={styles.btnRow}>
          <button className={styles.saveBtn} onClick={saveConfig}>
            {saved ? '✓ Gespeichert' : 'Speichern'}
          </button>
          {config && (
            <button
              className={styles.syncBtn}
              onClick={() => void appData.sync()}
              disabled={appData.syncing}
            >
              {appData.syncing ? 'Sync…' : '↑↓ Jetzt syncen'}
            </button>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Kategorien</h2>
        <div className={styles.catList}>
          {appData.data.customCats.filter((c) => !c.deletedAt).map((c) => (
            <div key={c.id} className={styles.catItem}>
              <span>{c.label}</span>
              <button className={styles.catDeleteBtn} onClick={() => appData.deleteCategory(c.id)} aria-label="Löschen">×</button>
            </div>
          ))}
          {appData.data.customCats.filter((c) => !c.deletedAt).length === 0 && (
            <div className={styles.catEmpty}>Noch keine Kategorien</div>
          )}
        </div>
        <div className={styles.catAddRow}>
          <input
            className={styles.catInput}
            placeholder="Neue Kategorie…"
            value={newCatLabel}
            onChange={(e) => setNewCatLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newCatLabel.trim()) {
                appData.addCategory(newCatLabel.trim());
                setNewCatLabel('');
              }
            }}
          />
          <button
            className={styles.catAddBtn}
            onClick={() => { if (newCatLabel.trim()) { appData.addCategory(newCatLabel.trim()); setNewCatLabel(''); } }}
          >+</button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Daten</h2>
        <div className={styles.btnRow}>
          <button className={styles.exportBtn} onClick={exportData}>Export JSON</button>
          <label className={styles.importBtn}>
            Import JSON
            <input type="file" accept=".json" onChange={importData} style={{ display: 'none' }} />
          </label>
        </div>
      </section>
    </div>
  );
}
