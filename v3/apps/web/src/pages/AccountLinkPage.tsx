import { useEffect, useRef, useState } from 'react';
import { LINK_STYLE } from '../components/LegalText';
import { resetPassword, verifyEmail } from '../utils/account';
import type { AccountRoute } from '../utils/account';
import styles from './SettingsPage.module.css';

/**
 * Where the links in reset and verification mails land (#324 S18, S19):
 * #/passwort-neu asks for the new password, #/email-bestaetigen confirms on its own.
 */
export default function AccountLinkPage({ route, onDone }: { route: AccountRoute; onDone: () => void }) {
  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <p><a href="#" style={LINK_STYLE} onClick={(e) => { e.preventDefault(); onDone(); }}>← Zur App</a></p>
        {route.kind === 'reset'
          ? <ResetForm token={route.token} onDone={onDone} />
          : <VerifyResult token={route.token} />}
      </section>
    </div>
  );
}

function ResetForm({ token, onDone }: { token: string; onDone: () => void }) {
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  const submit = async () => {
    if (pass !== pass2) { setError('Die beiden Passwörter stimmen nicht überein.'); setStatus('error'); return; }
    setStatus('loading');
    setError('');
    try {
      await resetPassword(token, pass);
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verbindungsfehler');
      setStatus('error');
    }
  };

  if (status === 'done') {
    return (
      <>
        <h2 className={styles.sectionTitle}>Passwort geändert</h2>
        <p className={styles.fieldHelpText}>
          Du kannst dich jetzt mit dem neuen Passwort anmelden. Alle bisherigen Sitzungen dieses Kontos sind beendet,
          auch auf anderen Geräten.
        </p>
        <button type="button" className={styles.saveBtn} onClick={onDone}>Zur Anmeldung</button>
      </>
    );
  }

  return (
    <>
      <h2 className={styles.sectionTitle}>Neues Passwort festlegen</h2>
      <label className={styles.field}>
        <span>Neues Passwort</span>
        <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
        <p className={styles.fieldHelpText}>Mindestens 8 Zeichen.</p>
      </label>
      <label className={styles.field}>
        <span>Passwort wiederholen</span>
        <input
          type="password"
          autoComplete="new-password"
          value={pass2}
          onChange={(e) => setPass2(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
      </label>
      <div role="status" aria-live="polite" aria-atomic="true">
        {status === 'error' && <div className={styles.errorBanner}>{error}</div>}
      </div>
      <button
        type="button"
        className={styles.saveBtn}
        disabled={pass.length < 8 || !pass2 || status === 'loading'}
        onClick={() => void submit()}
      >
        {status === 'loading' ? 'Speichere…' : 'Passwort speichern'}
      </button>
    </>
  );
}

function VerifyResult({ token }: { token: string }) {
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [error, setError] = useState('');
  // The token is single-use, so the request must go out exactly once — StrictMode
  // runs effects twice in development, and the second call would report the link
  // as spent right after it worked.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    verifyEmail(token)
      .then(() => setStatus('done'))
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Verbindungsfehler'); setStatus('error'); });
  }, [token]);

  return (
    <>
      <h2 className={styles.sectionTitle}>E-Mail-Adresse bestätigen</h2>
      <div role="status" aria-live="polite" aria-atomic="true">
        {status === 'loading' && <p className={styles.infoText}>Prüfe den Link…</p>}
        {status === 'done' && (
          <div className={styles.successBanner}>
            ✓ Adresse bestätigt. Über sie lässt sich jetzt ein vergessenes Passwort zurücksetzen.
          </div>
        )}
        {status === 'error' && <div className={styles.errorBanner}>{error}</div>}
      </div>
    </>
  );
}
