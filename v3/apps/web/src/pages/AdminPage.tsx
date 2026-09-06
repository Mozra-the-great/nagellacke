import { useEffect, useState } from 'react';
import {
  listUsers, createUser, setUserRole, deleteUser,
  getSettings, saveSettings, testSmtp, testAi,
  getAuditLog, checkUpdate, applyUpdate, rotateApiKey,
} from '../utils/admin';
import type { AdminUser, AdminSettings, AuditEntry, Role, UpdateInfo } from '../utils/admin';
import { saveAiSettings } from '../utils/ai';
import type { AiProvider, SearchBackend } from '../utils/ai';
import styles from './SettingsPage.module.css';

type Status = 'idle' | 'loading' | 'saved' | 'error';

function sourceBadge(source: 'panel' | 'env' | 'default'): string {
  if (source === 'panel') return 'aus Admin-Panel';
  if (source === 'env') return 'aus Umgebungsvariable';
  return 'nicht gesetzt';
}

export default function AdminPage() {
  // ── Benutzer ──
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersStatus, setUsersStatus] = useState<Status>('idle');
  const [usersError, setUsersError] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<Role>('user');
  const [createStatus, setCreateStatus] = useState<Status>('idle');
  const [createError, setCreateError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const loadUsers = () => {
    setUsersStatus('loading');
    listUsers()
      .then((d) => { setUsers(d.users); setUsersStatus('idle'); })
      .catch((e: unknown) => { setUsersError(e instanceof Error ? e.message : 'Fehler'); setUsersStatus('error'); });
  };

  useEffect(loadUsers, []);

  const doCreateUser = async () => {
    setCreateStatus('loading');
    setCreateError('');
    try {
      await createUser({ username: newUsername, password: newPassword, role: newRole });
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      setCreateStatus('saved');
      setTimeout(() => setCreateStatus('idle'), 2000);
      loadUsers();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Fehler');
      setCreateStatus('error');
    }
  };

  const doSetRole = async (username: string, role: Role) => {
    try {
      await setUserRole(username, role);
      loadUsers();
    } catch (e) {
      setUsersError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  const doDeleteUser = async (username: string) => {
    try {
      await deleteUser(username);
      setPendingDelete(null);
      loadUsers();
    } catch (e) {
      setUsersError(e instanceof Error ? e.message : 'Fehler');
      setUsersStatus('error');
    }
  };

  const adminCount = users.filter((u) => u.role === 'admin').length;

  // ── Server-Einstellungen ──
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<Status>('idle');
  const [settingsSaveError, setSettingsSaveError] = useState('');
  const [smtpTestEmail, setSmtpTestEmail] = useState('');
  const [smtpTestStatus, setSmtpTestStatus] = useState<Status>('idle');
  const [smtpTestError, setSmtpTestError] = useState('');

  // ── KI-Assistenz (moved here from SettingsPage.tsx, admin-only since #173) ──
  const [aiProvider, setAiProvider] = useState<AiProvider>('openrouter');
  const [aiOpenrouterModel, setAiOpenrouterModel] = useState('openrouter/auto');
  const [aiOpenrouterHasKey, setAiOpenrouterHasKey] = useState(false);
  const [aiOpenrouterFreeOnly, setAiOpenrouterFreeOnly] = useState(false);
  const [aiGeminiModel, setAiGeminiModel] = useState('gemini-flash-latest');
  const [aiGeminiHasKey, setAiGeminiHasKey] = useState(false);
  const [aiSearchBackend, setAiSearchBackend] = useState<SearchBackend>('duckduckgo');
  const [aiSearxngUrl, setAiSearxngUrl] = useState('');
  const [aiHasBraveKey, setAiHasBraveKey] = useState(false);
  const [aiTestStatus, setAiTestStatus] = useState<Status>('idle');
  const [aiTestError, setAiTestError] = useState('');
  const [aiTestModel, setAiTestModel] = useState('');

  const loadSettings = () => {
    getSettings().then((s) => {
      setSettings(s);
      setAllowRegistration(s.allowRegistration);
      setSmtpHost(s.smtp.host);
      setSmtpPort(s.smtp.port);
      setSmtpUser(s.smtp.user);
      setSmtpFrom(s.smtp.from);
      setSmtpSecure(!!s.smtp.secure);
      setAiProvider(s.ai.provider);
      setAiOpenrouterModel(s.ai.openrouter.model);
      setAiOpenrouterHasKey(s.ai.openrouter.hasApiKey);
      setAiOpenrouterFreeOnly(s.ai.openrouter.freeOnly);
      setAiGeminiModel(s.ai.gemini.model);
      setAiGeminiHasKey(s.ai.gemini.hasApiKey);
      setAiSearchBackend(s.ai.webSearch.backend as SearchBackend);
      setAiSearxngUrl(s.ai.webSearch.searxngUrl);
      setAiHasBraveKey(s.ai.webSearch.hasBraveApiKey);
    }).catch(() => { /* offline — form stays empty, save still attempts */ });
  };

  useEffect(loadSettings, []);

  const saveServerSettings = async () => {
    setSettingsSaveStatus('loading');
    setSettingsSaveError('');
    try {
      await saveSettings({
        allowRegistration,
        smtp: { host: smtpHost, port: smtpPort, user: smtpUser, pass: smtpPass || undefined, from: smtpFrom, secure: smtpSecure },
      });
      setSmtpPass('');
      setSettingsSaveStatus('saved');
      setTimeout(() => setSettingsSaveStatus('idle'), 2000);
      loadSettings();
    } catch (e) {
      setSettingsSaveError(e instanceof Error ? e.message : 'Fehler');
      setSettingsSaveStatus('error');
    }
  };

  const doTestSmtp = async () => {
    setSmtpTestStatus('loading');
    setSmtpTestError('');
    try {
      await testSmtp({
        toEmail: smtpTestEmail,
        host: smtpHost || undefined, port: smtpPort || undefined, user: smtpUser || undefined,
        pass: smtpPass || undefined, from: smtpFrom || undefined, secure: smtpSecure,
      });
      setSmtpTestStatus('saved');
      setTimeout(() => setSmtpTestStatus('idle'), 3000);
    } catch (e) {
      setSmtpTestError(e instanceof Error ? e.message : 'Fehler');
      setSmtpTestStatus('error');
    }
  };

  const [aiSaveStatus, setAiSaveStatus] = useState<Status>('idle');
  const [aiSaveError, setAiSaveError] = useState('');
  const [aiOpenrouterKey, setAiOpenrouterKey] = useState('');
  const [aiGeminiKey, setAiGeminiKey] = useState('');
  const [aiBraveKey, setAiBraveKey] = useState('');

  const saveAiConfig = async () => {
    setAiSaveStatus('loading');
    setAiSaveError('');
    try {
      await saveAiSettings({
        provider: aiProvider,
        openrouter: { apiKey: aiOpenrouterKey || undefined, model: aiOpenrouterModel || 'openrouter/auto', freeOnly: aiOpenrouterFreeOnly },
        gemini: { apiKey: aiGeminiKey || undefined, model: aiGeminiModel || 'gemini-flash-latest' },
        webSearch: { backend: aiSearchBackend, searxngUrl: aiSearxngUrl.trim(), braveApiKey: aiBraveKey || undefined },
      });
      if (aiOpenrouterKey) setAiOpenrouterHasKey(true);
      if (aiGeminiKey) setAiGeminiHasKey(true);
      if (aiBraveKey) setAiHasBraveKey(true);
      setAiOpenrouterKey('');
      setAiGeminiKey('');
      setAiBraveKey('');
      setAiSaveStatus('saved');
      setTimeout(() => setAiSaveStatus('idle'), 2000);
    } catch (e) {
      setAiSaveError(e instanceof Error ? e.message : 'Fehler');
      setAiSaveStatus('error');
    }
  };

  const doTestAi = async () => {
    setAiTestStatus('loading');
    setAiTestError('');
    setAiTestModel('');
    try {
      const result = await testAi(aiProvider);
      setAiTestModel(result.model);
      setAiTestStatus('saved');
    } catch (e) {
      setAiTestError(e instanceof Error ? e.message : 'Fehler');
      setAiTestStatus('error');
    }
  };

  // ── Update / API-Schlüssel ──
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'confirming' | 'updating' | 'done' | 'error'>('idle');
  const [updateError, setUpdateError] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [rotateStatus, setRotateStatus] = useState<Status>('idle');
  const [rotateError, setRotateError] = useState('');

  const doCheckUpdate = async () => {
    setUpdateStatus('checking');
    setUpdateError('');
    try {
      setUpdateInfo(await checkUpdate());
      setUpdateStatus('idle');
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : 'Fehler');
      setUpdateStatus('error');
    }
  };

  const doApplyUpdate = async () => {
    setUpdateStatus('updating');
    setUpdateError('');
    try {
      await applyUpdate(confirmPassword);
      setConfirmPassword('');
      setUpdateStatus('done');
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : 'Fehler');
      setUpdateStatus('error');
    }
  };

  const doRotateApiKey = async () => {
    setRotateStatus('loading');
    setRotateError('');
    try {
      const result = await rotateApiKey();
      setRotatedKey(result.apiKey);
      setRotateStatus('saved');
    } catch (e) {
      setRotateError(e instanceof Error ? e.message : 'Fehler');
      setRotateStatus('error');
    }
  };

  // ── Audit-Log ──
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  useEffect(() => { getAuditLog().then((d) => setAudit(d.entries)).catch(() => { /* ignore */ }); }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2 className={styles.title}>Admin</h2>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Benutzer</h2>
        {usersStatus === 'error' && <div className={styles.errorBanner}>{usersError}</div>}
        <div className={styles.catList}>
          {users.map((u) => (
            <div key={u.username} className={styles.catItem}>
              <span className={styles.catItemLabel}>
                {u.username} {u.role === 'admin' && <span className={styles.fieldHint}>(Admin)</span>}
                {u.email && <span className={styles.fieldHint}> · {u.email}</span>}
              </span>
              <div className={styles.btnRow} style={{ marginTop: 0 }}>
                {u.role === 'user' ? (
                  <button className={styles.syncBtn} onClick={() => void doSetRole(u.username, 'admin')}>Zu Admin machen</button>
                ) : (
                  <button
                    className={styles.syncBtn}
                    onClick={() => void doSetRole(u.username, 'user')}
                    disabled={adminCount <= 1}
                    title={adminCount <= 1 ? 'Der letzte Admin kann nicht entfernt werden' : undefined}
                  >Admin entfernen</button>
                )}
                {pendingDelete === u.username ? (
                  <>
                    <button className={styles.saveBtn} onClick={() => void doDeleteUser(u.username)}>Wirklich löschen</button>
                    <button className={styles.syncBtn} onClick={() => setPendingDelete(null)}>Abbrechen</button>
                  </>
                ) : (
                  <button
                    className={styles.catDeleteBtn}
                    onClick={() => setPendingDelete(u.username)}
                    disabled={u.role === 'admin' && adminCount <= 1}
                    aria-label={`${u.username} löschen`}
                  >✕</button>
                )}
              </div>
            </div>
          ))}
        </div>

        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '16px 0 12px', color: 'var(--md-on-surface-variant)' }}>Neuen Benutzer anlegen</h3>
        <label className={styles.field}>
          <span>Benutzername</span>
          <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} autoComplete="off" />
        </label>
        <label className={styles.field}>
          <span>Passwort (min. 8 Zeichen)</span>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
        </label>
        <label className={styles.field}>
          <span>Rolle</span>
          <div className={styles.segmented}>
            <button type="button" className={`${styles.segBtn} ${newRole === 'user' ? styles.segBtnActive : ''}`} onClick={() => setNewRole('user')}>Benutzer</button>
            <button type="button" className={`${styles.segBtn} ${newRole === 'admin' ? styles.segBtnActive : ''}`} onClick={() => setNewRole('admin')}>Admin</button>
          </div>
        </label>
        {createStatus === 'error' && <div className={styles.errorBanner}>{createError}</div>}
        <div className={styles.btnRow}>
          <button
            className={styles.saveBtn}
            onClick={() => void doCreateUser()}
            disabled={!newUsername || newPassword.length < 8 || createStatus === 'loading'}
          >
            {createStatus === 'loading' ? 'Anlegen…' : createStatus === 'saved' ? '✓ Angelegt' : 'Benutzer anlegen'}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Server-Einstellungen</h2>

        <label className={styles.field}>
          <span>Registrierung erlauben <span className={styles.fieldHint}>({settings ? sourceBadge(settings.allowRegistrationSource) : '…'})</span></span>
          <div className={styles.segmented}>
            <button type="button" className={`${styles.segBtn} ${allowRegistration ? styles.segBtnActive : ''}`} onClick={() => setAllowRegistration(true)}>An</button>
            <button type="button" className={`${styles.segBtn} ${!allowRegistration ? styles.segBtnActive : ''}`} onClick={() => setAllowRegistration(false)}>Aus</button>
          </div>
        </label>

        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '16px 0 12px', color: 'var(--md-on-surface-variant)' }}>
          SMTP {settings && <span className={styles.fieldHint}>({sourceBadge(settings.smtp.source)})</span>}
        </h3>
        <label className={styles.field}>
          <span>Host</span>
          <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
        </label>
        <label className={styles.field}>
          <span>Port</span>
          <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} />
        </label>
        <label className={styles.field}>
          <span>Benutzer</span>
          <input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Passwort {settings?.smtp.hasPassword && <span className={styles.fieldHint}>(bereits gesetzt)</span>}</span>
          <input type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder={settings?.smtp.hasPassword ? '••••••••••••' : ''} />
        </label>
        <label className={styles.field}>
          <span>Absender (From)</span>
          <input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} placeholder="nagellacke@example.com" />
        </label>
        <label className={styles.field}>
          <span>TLS (Port 465)</span>
          <div className={styles.segmented}>
            <button type="button" className={`${styles.segBtn} ${smtpSecure ? styles.segBtnActive : ''}`} onClick={() => setSmtpSecure(true)}>An</button>
            <button type="button" className={`${styles.segBtn} ${!smtpSecure ? styles.segBtnActive : ''}`} onClick={() => setSmtpSecure(false)}>Aus</button>
          </div>
        </label>

        {settingsSaveStatus === 'error' && <div className={styles.errorBanner}>{settingsSaveError}</div>}
        <div className={styles.btnRow} style={{ marginBottom: 16 }}>
          <button className={styles.saveBtn} onClick={() => void saveServerSettings()} disabled={settingsSaveStatus === 'loading'}>
            {settingsSaveStatus === 'loading' ? 'Speichere…' : settingsSaveStatus === 'saved' ? '✓ Gespeichert' : 'Speichern'}
          </button>
        </div>

        <label className={styles.field}>
          <span>Test-E-Mail an</span>
          <input type="email" value={smtpTestEmail} onChange={(e) => setSmtpTestEmail(e.target.value)} placeholder="test@example.com" />
        </label>
        {smtpTestStatus === 'error' && <div className={styles.errorBanner}>{smtpTestError}</div>}
        {smtpTestStatus === 'saved' && <div className={styles.successBanner}>✓ Test-E-Mail gesendet</div>}
        <div className={styles.btnRow}>
          <button className={styles.syncBtn} onClick={() => void doTestSmtp()} disabled={!smtpTestEmail || smtpTestStatus === 'loading'}>
            {smtpTestStatus === 'loading' ? 'Sende…' : 'Testmail senden'}
          </button>
        </div>

        <p className={styles.fieldHelpText} style={{ marginTop: 16 }}>
          App-URL {settings && <span className={styles.fieldHint}>({sourceBadge(settings.appUrlSource)}, aktuell: {settings.appUrl || '—'})</span>}<br />
          Wird für Links in versendeten Berichten verwendet. Über die Umgebungsvariable <code>APP_URL</code> setzen — ein
          Neustart des Servers ist dafür nötig, das Panel zeigt den Wert nur an.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>KI-Assistenz</h2>
        <label className={styles.field}>
          <span>Anbieter</span>
          <div className={styles.segmented}>
            <button type="button" className={`${styles.segBtn} ${aiProvider === 'openrouter' ? styles.segBtnActive : ''}`} onClick={() => setAiProvider('openrouter')}>OpenRouter</button>
            <button type="button" className={`${styles.segBtn} ${aiProvider === 'gemini' ? styles.segBtnActive : ''}`} onClick={() => setAiProvider('gemini')}>Gemini</button>
          </div>
        </label>

        {aiProvider === 'openrouter' && (
          <>
            <label className={styles.field}>
              <span>OpenRouter API-Schlüssel {aiOpenrouterHasKey && <span className={styles.fieldHint}>(bereits gesetzt)</span>}</span>
              <input type="password" value={aiOpenrouterKey} onChange={(e) => setAiOpenrouterKey(e.target.value)} placeholder={aiOpenrouterHasKey ? '••••••••••••' : 'sk-or-…'} />
            </label>
            <label className={styles.field}>
              <span>Modell</span>
              <input value={aiOpenrouterModel} onChange={(e) => setAiOpenrouterModel(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Nur kostenlose Modelle</span>
              <div className={styles.segmented}>
                <button type="button" className={`${styles.segBtn} ${aiOpenrouterFreeOnly ? styles.segBtnActive : ''}`} onClick={() => setAiOpenrouterFreeOnly(true)}>An</button>
                <button type="button" className={`${styles.segBtn} ${!aiOpenrouterFreeOnly ? styles.segBtnActive : ''}`} onClick={() => setAiOpenrouterFreeOnly(false)}>Aus</button>
              </div>
            </label>
          </>
        )}

        {aiProvider === 'gemini' && (
          <>
            <label className={styles.field}>
              <span>Gemini API-Schlüssel {aiGeminiHasKey && <span className={styles.fieldHint}>(bereits gesetzt)</span>}</span>
              <input type="password" value={aiGeminiKey} onChange={(e) => setAiGeminiKey(e.target.value)} placeholder={aiGeminiHasKey ? '••••••••••••' : 'AIza…'} />
            </label>
            <label className={styles.field}>
              <span>Modell</span>
              <input value={aiGeminiModel} onChange={(e) => setAiGeminiModel(e.target.value)} />
            </label>
          </>
        )}

        <label className={styles.field}>
          <span>Web-Recherche</span>
          <div className={styles.segmented}>
            <button type="button" className={`${styles.segBtn} ${aiSearchBackend === 'duckduckgo' ? styles.segBtnActive : ''}`} onClick={() => setAiSearchBackend('duckduckgo')}>DuckDuckGo</button>
            <button type="button" className={`${styles.segBtn} ${aiSearchBackend === 'searxng' ? styles.segBtnActive : ''}`} onClick={() => setAiSearchBackend('searxng')}>SearXNG</button>
            <button type="button" className={`${styles.segBtn} ${aiSearchBackend === 'brave' ? styles.segBtnActive : ''}`} onClick={() => setAiSearchBackend('brave')}>Brave</button>
            <button type="button" className={`${styles.segBtn} ${aiSearchBackend === 'off' ? styles.segBtnActive : ''}`} onClick={() => setAiSearchBackend('off')}>Aus</button>
          </div>
        </label>

        {aiSearchBackend === 'searxng' && (
          <label className={styles.field}>
            <span>SearXNG-Adresse</span>
            <input value={aiSearxngUrl} onChange={(e) => setAiSearxngUrl(e.target.value)} placeholder="https://searx.example.org" />
          </label>
        )}

        {aiSearchBackend === 'brave' && (
          <label className={styles.field}>
            <span>Brave Search API-Schlüssel {aiHasBraveKey && <span className={styles.fieldHint}>(bereits gesetzt)</span>}</span>
            <input type="password" value={aiBraveKey} onChange={(e) => setAiBraveKey(e.target.value)} placeholder={aiHasBraveKey ? '••••••••••••' : 'BSA…'} />
          </label>
        )}

        {aiSaveStatus === 'error' && <div className={styles.errorBanner}>{aiSaveError}</div>}
        <div className={styles.btnRow} style={{ marginBottom: 16 }}>
          <button className={styles.saveBtn} onClick={() => void saveAiConfig()} disabled={aiSaveStatus === 'loading'}>
            {aiSaveStatus === 'loading' ? 'Speichere…' : aiSaveStatus === 'saved' ? '✓ Gespeichert' : 'Speichern'}
          </button>
        </div>

        {aiTestStatus === 'error' && <div className={styles.errorBanner}>{aiTestError}</div>}
        {aiTestStatus === 'saved' && <div className={styles.successBanner}>✓ Verbindung erfolgreich ({aiTestModel})</div>}
        <div className={styles.btnRow}>
          <button className={styles.syncBtn} onClick={() => void doTestAi()} disabled={aiTestStatus === 'loading'}>
            {aiTestStatus === 'loading' ? 'Teste…' : 'Verbindung testen'}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>API-Schlüssel &amp; Update</h2>

        {updateInfo && updateStatus !== 'error' && (
          <div className={styles.infoText}>
            Version {updateInfo.current}{updateInfo.updateAvailable ? ` → ${updateInfo.latestVersion} verfügbar` : ' — aktuell'}
          </div>
        )}
        {updateStatus === 'done' && <div className={styles.infoText}>Update gestartet — Server startet in ~2 Min. neu.</div>}
        {updateStatus === 'error' && <div className={styles.errorBanner}>{updateError}</div>}

        <div className={styles.btnRow} style={{ marginBottom: 12 }}>
          <button className={styles.syncBtn} onClick={() => void doCheckUpdate()} disabled={updateStatus === 'checking' || updateStatus === 'updating'}>
            {updateStatus === 'checking' ? 'Prüfe…' : 'Update prüfen'}
          </button>
          {updateInfo?.updateAvailable && updateStatus !== 'done' && updateStatus !== 'confirming' && (
            <button className={styles.saveBtn} onClick={() => setUpdateStatus('confirming')}>Update installieren</button>
          )}
        </div>
        {updateStatus === 'confirming' && (
          <div className={styles.confirmRow}>
            <span className={styles.confirmText}>Server neu starten? (~2 Min. nicht erreichbar) — Passwort zur Bestätigung:</span>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="current-password" />
            <button className={styles.saveBtn} onClick={() => void doApplyUpdate()} disabled={confirmPassword.length < 8}>Ja, installieren</button>
            <button className={styles.syncBtn} onClick={() => { setUpdateStatus('idle'); setConfirmPassword(''); }}>Abbrechen</button>
          </div>
        )}

        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '16px 0 12px', color: 'var(--md-on-surface-variant)' }}>API-Schlüssel rotieren</h3>
        <p className={styles.fieldHelpText}>
          Erzeugt einen neuen root-API-Schlüssel und macht den alten sofort ungültig — z.B. nach einem Verdacht auf Kompromittierung.
        </p>
        {rotatedKey && (
          <div className={styles.warningBanner}>
            Neuer Schlüssel (nur jetzt sichtbar): <code>{rotatedKey}</code>
          </div>
        )}
        {rotateStatus === 'error' && <div className={styles.errorBanner}>{rotateError}</div>}
        <div className={styles.btnRow}>
          <button className={styles.syncBtn} onClick={() => void doRotateApiKey()} disabled={rotateStatus === 'loading'}>
            {rotateStatus === 'loading' ? 'Rotiere…' : 'Schlüssel rotieren'}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Audit-Log</h2>
        <div className={styles.catList}>
          {audit.length === 0 && <div className={styles.catEmpty}>Noch keine Einträge</div>}
          {audit.map((e) => (
            <div key={`${e.ts}-${e.action}-${e.target ?? ''}`} className={styles.catItem}>
              <span>
                {new Date(e.ts).toLocaleString('de-DE')} — <strong>{e.actor}</strong>: {e.action}
                {e.target && ` (${e.target})`}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
