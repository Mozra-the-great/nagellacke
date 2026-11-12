import { useEffect, useRef, useState } from 'react';
import { LINK_STYLE } from '../components/LegalText';
import { resetPassword, verifyEmail } from '../utils/account';
import type { AccountRoute } from '../utils/account';
import { confirmReportRecipient, unsubscribeFromReports } from '../utils/reportRecipient';
import { serverBase } from '../utils/serverBase';
import styles from './SettingsPage.module.css';

/**
 * Where the links in reset and verification mails land (#324 S18, S19):
 * #/passwort-neu asks for the new password, #/email-bestaetigen confirms on its own, and
 * #/bericht-bestaetigen is where the recipient of a scheduled report agrees to receive it (#449),
 * #/bericht-abbestellen is where the link in a report mail's footer ends up (#457).
 */
export default function AccountLinkPage({ route, onDone }: { route: AccountRoute; onDone: () => void }) {
  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <p><a href="#" style={LINK_STYLE} onClick={(e) => { e.preventDefault(); onDone(); }}>← Zur App</a></p>
        {route.kind === 'reset'
          ? <ResetForm token={route.token} onDone={onDone} />
          : route.kind === 'recipient'
            ? <RecipientResult token={route.token} />
            : route.kind === 'unsubscribe'
              ? <UnsubscribeResult token={route.token} />
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

/**
 * Opening the link is the confirmation, like the address check above: the request goes out exactly once
 * (StrictMode would otherwise run the effect twice). The recipient has no account, so there is no
 * "back to the app" framing beyond the link at the top.
 */
function RecipientResult({ token }: { token: string }) {
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    confirmReportRecipient(token, serverBase())
      .then(() => setStatus('done'))
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Verbindungsfehler'); setStatus('error'); });
  }, [token]);

  return (
    <>
      <h2 className={styles.sectionTitle}>Berichte an diese Adresse</h2>
      <div role="status" aria-live="polite" aria-atomic="true">
        {status === 'loading' && <p className={styles.infoText}>Prüfe den Link…</p>}
        {status === 'done' && (
          <div className={styles.successBanner}>
            ✓ Bestätigt. Diese Adresse bekommt jetzt die Berichte, die das Konto eingerichtet hat. Wer sie nicht mehr
            erhalten möchte, nutzt den Abmeldelink am Ende jeder Berichtsmail.
          </div>
        )}
        {status === 'error' && <div className={styles.errorBanner}>{error}</div>}
      </div>
    </>
  );
}

/**
 * The page behind the unsubscribe link in a report mail (#457). Unlike the confirmation above it asks
 * for one press of a button instead of acting on load: a mail scanner that renders the link would
 * otherwise cancel the reports (and, for a third-party address, the owner could never ask it again).
 * Mail clients that support RFC 8058 skip this page and POST to the server directly. The recipient
 * has no account; the answer names the address so they can see which one was stopped.
 */
function UnsubscribeResult({ token }: { token: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');

  const submit = () => {
    setStatus('loading');
    setError('');
    unsubscribeFromReports(token, serverBase())
      .then((address) => { setEmail(address); setStatus('done'); })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Verbindungsfehler'); setStatus('error'); });
  };

  return (
    <>
      <h2 className={styles.sectionTitle}>Berichte abbestellen</h2>
      {(status === 'idle' || status === 'loading' || status === 'error') && (
        <>
          <p className={styles.fieldHelpText}>
            Mit dem Knopf unten bekommt die Adresse, an die diese Berichtsmail ging, keine Berichte mehr von diesem Konto.
            Der Kontoinhaber sieht das in seinen Einstellungen; ohne neue Bestätigung von dir wird nichts mehr gesendet.
          </p>
          <button type="button" className={styles.saveBtn} disabled={status === 'loading' || !token} onClick={submit}>
            {status === 'loading' ? 'Bestelle ab…' : 'Berichte abbestellen'}
          </button>
        </>
      )}
      <div role="status" aria-live="polite" aria-atomic="true">
        {status === 'done' && (
          <div className={styles.successBanner}>
            ✓ Abbestellt{email ? `: ${email} bekommt` : ': Diese Adresse bekommt'} keine Berichte mehr von diesem Konto.
          </div>
        )}
        {status === 'error' && <div className={styles.errorBanner}>{error}</div>}
        {status !== 'done' && !token && <div className={styles.errorBanner}>Der Link ist unvollständig. Bitte öffne ihn direkt aus der Mail.</div>}
      </div>
    </>
  );
}
