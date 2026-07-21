import { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import type { SyncConfig, SyncProviderType } from '@nagellacke/sync';
import type { AppData as CoreAppData, ManicurePhotos } from '@nagellacke/core';
import { mergeData } from '@nagellacke/core';
import { loadSyncConfig, saveSyncConfig, loadPhotoDefault, savePhotoDefault } from '../useAppData';
import type { useAppData } from '../useAppData';
import { uploadPhoto } from '../utils/photos';
import { generateReport } from '../utils/report';
import { getAiSettings, saveAiSettings } from '../utils/ai';
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
      const c: SyncConfig = { provider: 'server', serverUrl, serverToken: data.token };
      saveSyncConfig(c);
      setConfig(c);
      setServerToken(data.token);
      setLoginPass('');
      setLoginStatus('idle');
      void appData.sync();
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

  // ── Berichte ──
  const todayStr = new Date().toISOString().slice(0, 10);
  const [reportPeriod, setReportPeriod] = useState<'week' | 'month'>('week');
  const [reportDate, setReportDate] = useState(todayStr);
  const [reportEmail, setReportEmail] = useState('');
  const [reportEmailStatus, setReportEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [reportEmailError, setReportEmailError] = useState('');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleFrequency, setScheduleFrequency] = useState<'weekly' | 'monthly'>('weekly');
  const [scheduleEmail, setScheduleEmail] = useState('');
  const [scheduleSaveStatus, setScheduleSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [scheduleSaveError, setScheduleSaveError] = useState('');
  const [smtpConfigured, setSmtpConfigured] = useState(false);

  // ── KI-Assistenz ──
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiSaveStatus, setAiSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [aiSaveError, setAiSaveError] = useState('');

  const isServerSync = config?.provider === 'server';
  const serverBase = config?.serverUrl?.replace(/\/$/, '') ?? '';
  const bearerHeaders = (): Record<string, string> =>
    serverToken ? { 'Authorization': `Bearer ${serverToken}` } : {};

  useEffect(() => {
    if (!isServerSync) return;
    const base = serverBase;
    const headers = bearerHeaders();
    if (!headers['Authorization']) return;

    const controller = new AbortController();
    const { signal } = controller;

    type MeResponse = { email?: string | null; smtpConfigured?: boolean };
    type ScheduleResponse = { config?: { enabled: boolean; frequency: 'weekly' | 'monthly'; toEmail: string } | null; smtpConfigured?: boolean };

    // Load email + smtp status
    fetch(`${base}/api/auth/me`, { headers, signal })
      .then(r => r.ok ? r.json() as Promise<MeResponse> : Promise.resolve<MeResponse>({}))
      .then(d => {
        if (signal.aborted) return;
        if (d.email) setReportEmail(d.email);
        if (d.smtpConfigured !== undefined) setSmtpConfigured(!!d.smtpConfigured);
      })
      .catch(() => { /* ignore aborted / network errors */ });

    // Load schedule config
    fetch(`${base}/api/reports/schedule`, { headers, signal })
      .then(r => r.ok ? r.json() as Promise<ScheduleResponse> : Promise.resolve<ScheduleResponse>({}))
      .then(d => {
        if (signal.aborted) return;
        if (d.config) {
          setScheduleEnabled(d.config.enabled);
          setScheduleFrequency(d.config.frequency);
          setScheduleEmail(d.config.toEmail ?? '');
        }
        if (d.smtpConfigured !== undefined) setSmtpConfigured(!!d.smtpConfigured);
      })
      .catch(() => { /* ignore aborted / network errors */ });

    return () => controller.abort();
  }, [isServerSync, serverBase, serverToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isServerSync) return;
    getAiSettings()
      .then((s) => { setAiConfigured(s.configured); setAiModel(s.model ?? ''); })
      .catch(() => { /* ignore — surfaced when the user tries to save */ });
  }, [isServerSync, serverBase, serverToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAi = async () => {
    setAiSaveStatus('saving');
    setAiSaveError('');
    try {
      await saveAiSettings(aiApiKey, aiModel);
      setAiConfigured(!!aiApiKey.trim());
      setAiApiKey('');
      setAiSaveStatus('saved');
      setTimeout(() => setAiSaveStatus('idle'), 2000);
    } catch (e) {
      setAiSaveError(e instanceof Error ? e.message : 'Verbindungsfehler');
      setAiSaveStatus('error');
    }
  };

  const openReport = () => {
    // Parse as local midnight — new Date("YYYY-MM-DD") parses as UTC midnight,
    // which shifts getPeriodBounds off by one day in UTC-offset timezones.
    const html = generateReport(appData.data, reportPeriod, new Date(reportDate + 'T00:00:00'));
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const sendReportEmail = async () => {
    setReportEmailStatus('sending');
    setReportEmailError('');
    try {
      const base = serverBase;
      const res = await fetch(`${base}/api/reports/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...bearerHeaders() },
        body: JSON.stringify({ period: reportPeriod, date: reportDate, toEmail: reportEmail }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { setReportEmailError(data.error ?? `Fehler ${res.status}`); setReportEmailStatus('error'); return; }
      setReportEmailStatus('sent');
      setTimeout(() => setReportEmailStatus('idle'), 3000);
    } catch (e) {
      setReportEmailError(e instanceof Error ? e.message : 'Verbindungsfehler');
      setReportEmailStatus('error');
    }
  };

  const saveSchedule = async () => {
    setScheduleSaveStatus('saving');
    setScheduleSaveError('');
    try {
      const base = serverBase;
      const res = await fetch(`${base}/api/reports/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...bearerHeaders() },
        body: JSON.stringify({ enabled: scheduleEnabled, frequency: scheduleFrequency, toEmail: scheduleEmail }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { setScheduleSaveError(data.error ?? `Fehler ${res.status}`); setScheduleSaveStatus('error'); return; }
      setScheduleSaveStatus('saved');
      setTimeout(() => setScheduleSaveStatus('idle'), 2000);
    } catch (e) {
      setScheduleSaveError(e instanceof Error ? e.message : 'Verbindungsfehler');
      setScheduleSaveStatus('error');
    }
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
                <button
                  className={styles.logoutBtn}
                  onClick={() => {
                    setServerToken('');
                    saveSyncConfig(null);
                    setConfig(null);
                  }}
                >Abmelden</button>
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
              <span>App-Passwort</span>
              <input aria-required="true" type="password" value={ncPass} onChange={(e) => setNcPass(e.target.value)} />
              <p className={styles.fieldHelpText}>
                Bitte kein normales Konto-Passwort eintragen — erstelle stattdessen ein App-Passwort unter
                Nextcloud → Einstellungen → Sicherheit → App-Passwörter. Es lässt sich jederzeit widerrufen,
                ohne das Konto-Passwort zu ändern.
              </p>
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
        <h2 className={styles.sectionTitle}>Berichte</h2>

        <div className={styles.segmented} style={{ marginBottom: 14 }}>
          <button
            className={`${styles.segBtn} ${reportPeriod === 'week' ? styles.segBtnActive : ''}`}
            onClick={() => setReportPeriod('week')}
          >Wochenübersicht</button>
          <button
            className={`${styles.segBtn} ${reportPeriod === 'month' ? styles.segBtnActive : ''}`}
            onClick={() => setReportPeriod('month')}
          >Monatsübersicht</button>
        </div>

        <label className={styles.field}>
          <span>Datum im Zeitraum</span>
          <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
        </label>

        <div className={styles.btnRow} style={{ marginBottom: 20 }}>
          <button className={styles.saveBtn} onClick={openReport}>
            📄 Bericht erstellen
          </button>
          <p className={styles.fieldHelpText} style={{ alignSelf: 'center', margin: 0 }}>
            Öffnet in neuem Tab → Strg+P → Als PDF speichern
          </p>
        </div>

        {isServerSync && (
          <>
            <hr style={{ border: 'none', borderTop: '1px solid var(--md-outline-variant)', margin: '12px 0 16px' }} />
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--md-on-surface-variant)', marginBottom: 12 }}>Per E-Mail senden</h3>

            {!smtpConfigured && (
              <div className={styles.warningBanner} style={{ marginBottom: 12 }}>
                SMTP nicht konfiguriert — bitte SMTP_HOST, SMTP_USER und SMTP_PASS als Umgebungsvariablen auf dem Server setzen.
              </div>
            )}

            <label className={styles.field}>
              <span>E-Mail-Adresse</span>
              <input
                type="email"
                value={reportEmail}
                onChange={(e) => setReportEmail(e.target.value)}
                placeholder="deine@email.de"
              />
            </label>

            {reportEmailStatus === 'error' && (
              <div className={styles.errorBanner} style={{ marginBottom: 8 }}>{reportEmailError}</div>
            )}
            {reportEmailStatus === 'sent' && (
              <div className={styles.successBanner} style={{ marginBottom: 8 }}>✓ Bericht gesendet!</div>
            )}

            <div className={styles.btnRow} style={{ marginBottom: 20 }}>
              <button
                className={styles.syncBtn}
                onClick={() => void sendReportEmail()}
                disabled={!reportEmail || !smtpConfigured || reportEmailStatus === 'sending'}
              >
                {reportEmailStatus === 'sending' ? 'Sende…' : '✉ Jetzt per E-Mail senden'}
              </button>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--md-outline-variant)', margin: '12px 0 16px' }} />
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--md-on-surface-variant)', marginBottom: 12 }}>Automatischer Zeitplan</h3>
            <p className={styles.fieldHelpText} style={{ marginBottom: 12 }}>
              Wöchentlich: jeden Montag 08:00 Uhr (Vorwoche). Monatlich: 1. des Monats 08:00 Uhr (Vormonat).
            </p>

            <label className={styles.field}>
              <span>Automatisch senden</span>
              <div className={styles.segmented}>
                <button
                  className={`${styles.segBtn} ${scheduleEnabled ? styles.segBtnActive : ''}`}
                  onClick={() => setScheduleEnabled(true)}
                >An</button>
                <button
                  className={`${styles.segBtn} ${!scheduleEnabled ? styles.segBtnActive : ''}`}
                  onClick={() => setScheduleEnabled(false)}
                >Aus</button>
              </div>
            </label>

            {scheduleEnabled && (
              <>
                <label className={styles.field}>
                  <span>Häufigkeit</span>
                  <select value={scheduleFrequency} onChange={(e) => setScheduleFrequency(e.target.value as 'weekly' | 'monthly')}>
                    <option value="weekly">Wöchentlich</option>
                    <option value="monthly">Monatlich</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Senden an</span>
                  <input
                    type="email"
                    value={scheduleEmail}
                    onChange={(e) => setScheduleEmail(e.target.value)}
                    placeholder="deine@email.de"
                  />
                </label>
              </>
            )}

            {scheduleSaveStatus === 'error' && (
              <div className={styles.errorBanner} style={{ marginBottom: 8 }}>{scheduleSaveError}</div>
            )}

            <div className={styles.btnRow}>
              <button
                className={styles.saveBtn}
                onClick={() => void saveSchedule()}
                disabled={scheduleSaveStatus === 'saving' || !smtpConfigured}
              >
                {scheduleSaveStatus === 'saving' ? 'Speichere…' : scheduleSaveStatus === 'saved' ? '✓ Gespeichert' : 'Zeitplan speichern'}
              </button>
            </div>
          </>
        )}

        {!isServerSync && (
          <p className={styles.fieldHelpText} style={{ marginTop: 8 }}>
            E-Mail und Zeitplan sind nur mit dem Eigenen-Server-Sync verfügbar.
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>KI-Assistenz</h2>
        {!isServerSync ? (
          <p className={styles.fieldHelpText}>
            KI-Funktionen (Auto-Fill beim Hinzufügen, Smart-Cart-Vorschläge) laufen serverseitig und sind nur mit
            dem Eigenen-Server-Sync verfügbar.
          </p>
        ) : (
          <>
            <p className={styles.fieldHelpText} style={{ marginBottom: 12 }}>
              Nutzt <a href="https://openrouter.ai" target="_blank" rel="noreferrer">OpenRouter</a> für LLM-Zugriff
              inklusive Websuche. Der Schlüssel wird auf dem Server hinterlegt, nicht im Browser.
            </p>
            <div className={styles.infoText}>
              Status: {aiConfigured ? '✓ konfiguriert' : 'nicht konfiguriert'}
            </div>
            <label className={styles.field}>
              <span>OpenRouter API-Key</span>
              <input
                type="password"
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
                placeholder="sk-or-…"
              />
              {aiConfigured && (
                <p className={styles.fieldHelpText}>Ein Schlüssel ist bereits hinterlegt — zum Ändern hier einen neuen eingeben.</p>
              )}
            </label>
            <label className={styles.field}>
              <span>Modell</span>
              <input
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder="z.B. google/gemini-2.5-flash oder openai/gpt-4o-mini"
              />
              <p className={styles.fieldHelpText}>
                Jedes auf OpenRouter verfügbare Modell mit Tool-/Websuche-Unterstützung funktioniert.
              </p>
            </label>

            {aiSaveStatus === 'error' && <div className={styles.errorBanner}>{aiSaveError}</div>}

            <div className={styles.btnRow}>
              <button
                className={styles.saveBtn}
                onClick={() => void saveAi()}
                disabled={aiSaveStatus === 'saving' || !aiModel.trim() || !aiApiKey.trim()}
              >
                {aiSaveStatus === 'saving' ? 'Speichere…' : aiSaveStatus === 'saved' ? '✓ Gespeichert' : 'Speichern'}
              </button>
              {aiConfigured && (
                <button
                  className={styles.syncBtn}
                  onClick={() => {
                    setAiApiKey('');
                    saveAiSettings('', '').then(() => setAiConfigured(false)).catch((e: unknown) => setAiSaveError(e instanceof Error ? e.message : 'Fehler'));
                  }}
                >KI deaktivieren</button>
              )}
            </div>
          </>
        )}
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
            {updateInfo.updateAvailable
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
