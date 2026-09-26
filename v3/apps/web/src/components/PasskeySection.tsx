import { useCallback, useEffect, useState } from 'react';
import { addPasskey, listPasskeys, passkeyErrorMessage, passkeysSupported, removePasskey } from '../utils/passkeys';
import type { PasskeyInfo } from '../utils/passkeys';
import styles from '../pages/SettingsPage.module.css';

const dateFmt = (ms: number) => new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Settings → Sicherheit, next to 2FA (#228): add, list and remove passkeys. Where the
 * browser or the server cannot do passkeys, the section says why instead of offering
 * something that would fail — the pattern the AI gating uses.
 */
export default function PasskeySection() {
  const browserOk = passkeysSupported();
  const [state, setState] = useState<{ available: boolean; reason: string | null; passkeys: PasskeyInfo[] } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'idle' | 'adding' | 'error'>('idle');
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const reload = useCallback(() => {
    listPasskeys().then(setState).catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Verbindungsfehler'));
  }, []);
  useEffect(() => { if (browserOk) reload(); }, [browserOk, reload]);

  const add = async () => {
    setStatus('adding');
    setError('');
    try {
      await addPasskey(name.trim());
      setName('');
      setStatus('idle');
      reload();
    } catch (e) {
      setError(passkeyErrorMessage(e));
      setStatus('error');
    }
  };

  const remove = async (id: string) => {
    setError('');
    try {
      await removePasskey(id);
      setConfirmRemove(null);
      reload();
    } catch (e) {
      setError(passkeyErrorMessage(e));
      setStatus('error');
    }
  };

  return (
    <div style={{ marginTop: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--md-on-surface-variant)', marginBottom: 8 }}>Passkeys</h3>
      <p className={styles.fieldHelpText}>
        Anmelden per Fingerabdruck, Gesichtserkennung oder Geräte-PIN statt Passwort. Ein Passkey ersetzt dabei
        auch den 2FA-Code. Dein Passwort bleibt gültig, auch wenn du alle Passkeys entfernst.
      </p>
      {!browserOk ? (
        <p className={styles.fieldHelpText}>
          Nicht verfügbar: Passkeys brauchen eine HTTPS-Verbindung und einen Browser, der sie unterstützt.
        </p>
      ) : loadError ? (
        <div className={styles.errorBanner}>{loadError}</div>
      ) : !state ? (
        <p className={styles.infoText}>Lade…</p>
      ) : (
        <>
          {state.passkeys.length > 0 && (
            <ul className={styles.catList} aria-label="Deine Passkeys" style={{ listStyle: 'none', padding: 0 }}>
              {state.passkeys.map((p) => (
                <li key={p.id} className={styles.catItem}>
                  <span className={styles.catItemLabel}>
                    {p.name}
                    <span className={styles.fieldHint}>
                      {' '}· angelegt {dateFmt(p.createdAt)}{p.lastUsedAt ? ` · zuletzt benutzt ${dateFmt(p.lastUsedAt)}` : ''}
                      {p.stale ? ' · gehört zu einer früheren Adresse dieses Servers und funktioniert nicht mehr' : ''}
                    </span>
                  </span>
                  {confirmRemove === p.id ? (
                    <span className={styles.btnRow} style={{ marginTop: 0 }}>
                      <button type="button" className={styles.logoutBtn} onClick={() => void remove(p.id)}>Entfernen</button>
                      <button type="button" className={styles.logoutBtn} onClick={() => setConfirmRemove(null)}>Abbrechen</button>
                    </span>
                  ) : (
                    <button type="button" className={styles.catDeleteBtn} aria-label={`Passkey ${p.name} entfernen`} onClick={() => setConfirmRemove(p.id)}>×</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {state.available ? (
            <>
              <label className={styles.field}>
                <span>Name für den neuen Passkey <span className={styles.fieldHint}>(optional)</span></span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Handy, Laptop" maxLength={60} />
              </label>
              <div className={styles.btnRow}>
                <button type="button" className={styles.syncBtn} disabled={status === 'adding'} onClick={() => void add()}>
                  {status === 'adding' ? 'Warte auf das Gerät…' : 'Passkey hinzufügen'}
                </button>
              </div>
            </>
          ) : (
            <p className={styles.fieldHelpText}>Nicht verfügbar: {state.reason}</p>
          )}
          <div role="status" aria-live="polite" aria-atomic="true">
            {status === 'error' && <div className={styles.errorBanner} style={{ marginTop: 8 }}>{error}</div>}
          </div>
        </>
      )}
    </div>
  );
}
