import { useState, useRef } from 'react';
import JSZip from 'jszip';
import type { SyncConfig, SyncProviderType } from '@nagellacke/sync';
import type { AppData as CoreAppData, ManicurePhotos } from '@nagellacke/core';
import { mergeData } from '@nagellacke/core';
import { loadSyncConfig, saveSyncConfig, loadPhotoDefault, savePhotoDefault } from '../useAppData';
import type { useAppData } from '../useAppData';
import { uploadPhoto } from '../utils/photos';
import styles from './SettingsPage.module.css';

type AppData = ReturnType<typeof useAppData>;

function mimeTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function collectPhotoFilenames(data: CoreAppData): string[] {
  const names = new Set<string>();
  for (const p of data.polishes) if (p.photo) names.add(p.photo);
  for (const s of data.stickers) if (s.photo) names.add(s.photo);
  for (const m of data.manicures) {
    if (m.photo) names.add(m.photo);
    if (m.photos) {
      const { fingerRight, fingerLeft, thumbRight, thumbLeft } = m.photos;
      if (fingerRight) names.add(fingerRight);
      if (fingerLeft) names.add(fingerLeft);
      if (thumbRight) names.add(thumbRight);
      if (thumbLeft) names.add(thumbLeft);
    }
  }
  return [...names];
}

function remapPhotoRefs(data: CoreAppData, map: Map<string, string>): CoreAppData {
  const remapStr = (name: string | undefined): string | undefined =>
    name ? (map.get(name) ?? name) : name;
  const remapNullable = (name: string | null | undefined): string | null | undefined =>
    name ? (map.get(name) ?? name) : name;

  return {
    ...data,
    polishes: data.polishes.map((p) => ({ ...p, photo: remapStr(p.photo) })),
    stickers: data.stickers.map((s) => ({ ...s, photo: remapStr(s.photo) })),
    manicures: data.manicures.map((m) => ({
      ...m,
      photo: remapStr(m.photo),
      photos: m.photos
        ? ({
            fingerRight: remapNullable(m.photos.fingerRight),
            fingerLeft:  remapNullable(m.photos.fingerLeft),
            thumbRight:  remapNullable(m.photos.thumbRight),
            thumbLeft:   remapNullable(m.photos.thumbLeft),
          } satisfies ManicurePhotos)
        : undefined,
    })),
  };
}

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
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);

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

  const exportData = async () => {
    setExporting(true);
    setImportMessage(null);
    try {
      const zip = new JSZip();
      zip.file('data.json', JSON.stringify(appData.data, null, 2));

      const filenames = collectPhotoFilenames(appData.data);
      let skipped = 0;
      for (const filename of filenames) {
        try {
          const res = await fetch(`/photos/${encodeURIComponent(filename)}`);
          if (!res.ok) { skipped++; continue; }
          const blob = await res.blob();
          zip.folder('photos')!.file(filename, blob);
        } catch {
          skipped++;
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nagellacke-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      if (skipped > 0) {
        setImportMessage({ type: 'warning', text: `Export abgeschlossen. ${skipped} Foto(s) konnten nicht exportiert werden.` });
      }
    } catch (err) {
      setImportMessage({ type: 'error', text: `Export fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setExporting(false);
    }
  };

  const importData = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.name.endsWith('.zip')) {
      try {
        const zip = await JSZip.loadAsync(file);
        const jsonEntry = zip.file('data.json');
        if (!jsonEntry) {
          setImportMessage({ type: 'error', text: 'Ungültige ZIP-Datei: data.json fehlt' });
          return;
        }
        const jsonText = await jsonEntry.async('string');
        const imported = JSON.parse(jsonText) as Partial<CoreAppData>;
        const valid: CoreAppData = {
          polishes:   Array.isArray(imported.polishes)   ? imported.polishes   : [],
          customCats: Array.isArray(imported.customCats) ? imported.customCats : [],
          manicures:  Array.isArray(imported.manicures)  ? imported.manicures  : [],
          stickers:   Array.isArray(imported.stickers)   ? imported.stickers   : [],
        };

        const filenameMap = new Map<string, string>();
        let photosFailed = 0;
        for (const [path, entry] of Object.entries(zip.files)) {
          if (entry.dir || !path.startsWith('photos/')) continue;
          const oldFilename = path.slice('photos/'.length);
          if (!oldFilename) continue;
          try {
            const blob = await entry.async('blob');
            const photoFile = new File([blob], oldFilename, { type: mimeTypeFromFilename(oldFilename) });
            const newFilename = await uploadPhoto(photoFile);
            filenameMap.set(oldFilename, newFilename);
          } catch {
            photosFailed++;
          }
        }

        const remapped = filenameMap.size > 0 ? remapPhotoRefs(valid, filenameMap) : valid;
        const merged = mergeData(appData.data, remapped);
        appData.importMerge(merged);

        if (photosFailed > 0) {
          setImportMessage({
            type: 'warning',
            text: `Import abgeschlossen: ${valid.polishes.length} Lacke, ${valid.stickers.length} Sticker, ${valid.manicures.length} Maniküren, ${filenameMap.size} Foto(s). ${photosFailed} Foto(s) konnten nicht hochgeladen werden (Auth-Token gesetzt?).`,
          });
        } else {
          setImportMessage({
            type: 'success',
            text: `Import erfolgreich: ${valid.polishes.length} Lacke, ${valid.stickers.length} Sticker, ${valid.manicures.length} Maniküren, ${filenameMap.size} Foto(s).`,
          });
        }
      } catch {
        setImportMessage({ type: 'error', text: 'Ungültige ZIP-Datei' });
      }
      return;
    }

    // JSON fallback (backward compat)
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
          <div className={importMessage.type === 'success' ? styles.successBanner : importMessage.type === 'warning' ? styles.warningBanner : styles.errorBanner}>
            {importMessage.text}
            <button
              style={{ marginLeft: 8, opacity: 0.7, fontSize: 12 }}
              onClick={() => setImportMessage(null)}
              aria-label="Meldung schließen"
            >✕</button>
          </div>
        )}
        <div className={styles.btnRow}>
          <button className={styles.exportBtn} onClick={() => void exportData()} disabled={exporting}>
            {exporting ? 'Exportiere…' : 'Export ZIP'}
          </button>
          <button className={styles.importBtn} onClick={() => fileInputRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.zip"
            onChange={(e) => void importData(e)}
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
