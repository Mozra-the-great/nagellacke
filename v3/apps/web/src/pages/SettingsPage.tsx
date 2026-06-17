import { useState, useRef } from 'react';
import type { SyncConfig, SyncProviderType } from '@nagellacke/sync';
import type { AppData as CoreAppData } from '@nagellacke/core';
import { mergeData } from '@nagellacke/core';
import { loadSyncConfig, saveSyncConfig, loadPhotoDefault, savePhotoDefault } from '../useAppData';
import type { useAppData } from '../useAppData';
import styles from './SettingsPage.module.css';

type AppData = ReturnType<typeof useAppData>;

const APIKEY_STORAGE = 'nagellacke_v3_apikey';

interface UpdateInfo {
  current: string;
  latestVersion: string | null;
  updateAvailable: boolean;
}

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

  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginStatus, setLoginStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [loginError, setLoginError] = useState('');

  const login = async () => {
    setLoginStatus('loading');
    setLoginError('');
    const base = serverUrl.replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      });
      const data = await res.json() as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setLoginError(data.error ?? `Fehler ${res.status}`);
        setLoginStatus('error');
        return;
      }
      setServerToken(data.token);
      setLoginPass('');
      setLoginStatus('idle');
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : 'Verbindungsfehler');
      setLoginStatus('error');
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoDefault, setPhotoDefaultState] = useState<boolean>(loadPhotoDefault);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(APIKEY_STORAGE) ?? '');
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'updating' | 'done' | 'error'>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState('');
  const [updateConfirmVisible, setUpdateConfirmVisible] = useState(false);
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const saveApiKey = (key: string) => {
    setApiKey(key);
    if (key) localStorage.setItem(APIKEY_STORAGE, key);
    else localStorage.removeItem(APIKEY_STORAGE);
  };

  const checkUpdate = async () => {
    setUpdateStatus('checking');
    setUpdateError('');
    try {
      const res = await fetch('/api/update/check', { headers: { 'X-Api-Key': apiKey } });
      if (res.status === 401) { setUpdateError('API-Schlüssel ungültig'); setUpdateStatus('error'); return; }
      const data = await res.json() as UpdateInfo;
      setUpdateInfo(data);
      setUpdateStatus('idle');
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : 'Verbindungsfehler');
      setUpdateStatus('error');
    }
  };

  const applyUpdate = async () => {
    setUpdateStatus('updating');
    setUpdateError('');
    try {
      await fetch('/api/update/apply', { method: 'POST', headers: { 'X-Api-Key': apiKey } });
      setUpdateStatus('done');
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : 'Verbindungsfehler');
      setUpdateStatus('error');
    }
  };

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
        setImportMessage({ type: 'success', text: `Import erfolgreich: ${valid.polishes.length} Lacke, ${valid.stickers.length} Sticker, ${valid.manicures.length} Maniküren.` });
      } catch {
        setImportMessage({ type: 'error', text: 'Ungültige JSON-Datei' });
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
        <h2 className={styles.title}>Einstellungen</h2>
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
              <span>Server-URL <span className={styles.fieldHint}>(leer = diese Seite)</span></span>
              <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://mein-server.de" />
            </label>

            {serverToken ? (
              <div className={styles.tokenRow}>
                <span className={styles.tokenOk}>✓ Eingeloggt</span>
                <button className={styles.logoutBtn} onClick={() => setServerToken('')}>Abmelden</button>
              </div>
            ) : (
              <div className={styles.loginBox}>
                <label className={styles.field}>
                  <span>Benutzername</span>
                  <input value={loginUser} onChange={(e) => setLoginUser(e.target.value)} autoComplete="username" />
                </label>
                <label className={styles.field}>
                  <span>Passwort</span>
                  <input
                    type="password"
                    value={loginPass}
                    onChange={(e) => setLoginPass(e.target.value)}
                    autoComplete="current-password"
                    onKeyDown={(e) => { if (e.key === 'Enter') void login(); }}
                  />
                </label>
                <div role="status" aria-live="polite" aria-atomic="true">
                  {loginStatus === 'loading' && <span className={styles.infoText}>Anmelden…</span>}
                  {loginStatus === 'error' && <div className={styles.errorBanner}>{loginError}</div>}
                </div>
                <button
                  className={styles.saveBtn}
                  onClick={login}
                  disabled={!loginUser || !loginPass || loginStatus === 'loading'}
                >
                  {loginStatus === 'loading' ? 'Anmelden…' : 'Anmelden'}
                </button>
              </div>
            )}
          </>
        )}

        {provider === 'nextcloud' && (
          <>
            <label className={styles.field}>
              <span>Nextcloud-URL</span>
              <input aria-required="true" value={ncUrl} onChange={(e) => setNcUrl(e.target.value)} placeholder="https://meine.nextcloud.de" />
            </label>
            <label className={styles.field}>
              <span>Benutzername</span>
              <input aria-required="true" value={ncUser} onChange={(e) => setNcUser(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Passwort / App-Token</span>
              <input aria-required="true" type="password" value={ncPass} onChange={(e) => setNcPass(e.target.value)} />
              <p className={styles.fieldHelpText}>App-Token: Nextcloud → Einstellungen → Sicherheit → App-Passwörter</p>
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
              <button className={styles.catDeleteBtn} onClick={() => appData.deleteCategory(c.id)} aria-label="Löschen">✕</button>
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
        <h2 className={styles.sectionTitle}>Darstellung</h2>
        <div className={styles.field}>
          <span>Standard-Lackansicht</span>
          <div className={styles.segmented}>
            <button
              className={`${styles.segBtn} ${photoDefault ? styles.segBtnActive : ''}`}
              onClick={() => { setPhotoDefaultState(true); savePhotoDefault(true); }}
            >
              📷 Foto
            </button>
            <button
              className={`${styles.segBtn} ${!photoDefault ? styles.segBtnActive : ''}`}
              onClick={() => { setPhotoDefaultState(false); savePhotoDefault(false); }}
            >
              ◎ Flasche
            </button>
          </div>
          <p className={styles.fieldHelpText}>Gilt nur für Lacke mit Foto — du kannst jederzeit pro Karte wechseln.</p>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Daten</h2>
        {importMessage && (
          <div className={importMessage.type === 'success' ? styles.successBanner : styles.errorBanner}>
            {importMessage.text}
            <button
              style={{ marginLeft: 8, opacity: 0.7, fontSize: 12 }}
              onClick={() => setImportMessage(null)}
              aria-label="Meldung schließen"
            >✕</button>
          </div>
        )}
        <div className={styles.btnRow}>
          <button className={styles.exportBtn} onClick={exportData}>Export JSON</button>
          <button className={styles.importBtn} onClick={() => fileInputRef.current?.click()}>
            Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={importData}
            style={{ display: 'none' }}
          />
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Admin</h2>
        <label className={styles.field}>
          <span>API-Schlüssel</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => saveApiKey(e.target.value)}
            placeholder="Aus data/.api_key auf dem Server"
          />
        </label>

        {updateInfo && updateStatus !== 'error' && (
          <div className={styles.infoText}>
            Version {updateInfo.current}
            {updateInfo.latestVersion && updateInfo.latestVersion !== updateInfo.current
              ? ` → ${updateInfo.latestVersion} verfügbar`
              : ' — aktuell'}
          </div>
        )}
        {updateStatus === 'done' && (
          <div className={styles.infoText}>Update gestartet — Server startet in ~2 Min. neu.</div>
        )}
        {updateStatus === 'error' && (
          <div className={styles.errorBanner}>{updateError}</div>
        )}

        <div className={styles.btnRow}>
          <button
            className={styles.syncBtn}
            onClick={checkUpdate}
            disabled={!apiKey || updateStatus === 'checking' || updateStatus === 'updating'}
          >
            {updateStatus === 'checking' ? 'Prüfe…' : 'Update prüfen'}
          </button>
          {updateInfo?.updateAvailable && updateStatus !== 'done' && !updateConfirmVisible && (
            <button
              className={styles.saveBtn}
              onClick={() => setUpdateConfirmVisible(true)}
              disabled={updateStatus === 'updating'}
            >
              Update installieren
            </button>
          )}
          {updateConfirmVisible && (
            <div className={styles.confirmRow}>
              <span className={styles.confirmText}>Server neu starten? (~2 Min. nicht erreichbar)</span>
              <button className={styles.saveBtn} onClick={() => { setUpdateConfirmVisible(false); void applyUpdate(); }}>
                Ja, installieren
              </button>
              <button className={styles.syncBtn} onClick={() => setUpdateConfirmVisible(false)}>
                Abbrechen
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
