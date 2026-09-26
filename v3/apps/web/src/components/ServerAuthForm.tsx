import { useEffect, useState } from 'react';
import { fetchPowSolution } from '../utils/pow';
import type { PowSolution } from '../utils/pow';
import { fetchLegalPages, LEGAL_ROUTES } from '../utils/legal';
import type { LegalPages } from '../utils/legal';
import styles from '../pages/SettingsPage.module.css';

interface ServerAuthFormProps {
  /** Server to talk to, as typed; '' means this page's own origin. */
  serverUrl: string;
  /** Called with the new token pair after a login, a 2FA verification or a registration. */
  onAuthenticated: (token: string, refreshToken: string | undefined) => void;
}

/**
 * Login, two-step 2FA login and self-registration against a nagellacke server. Lifted
 * out of Settings → Sync unchanged (#324 S15) so the public-instance intro gate can
 * offer the same form; what happens with the tokens stays the caller's business.
 */
export default function ServerAuthForm({ serverUrl, onAuthenticated }: ServerAuthFormProps) {
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginStatus, setLoginStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [loginError, setLoginError] = useState('');

  // ── Self-registration (#278) ──
  // The server has always accepted POST /api/auth/register and the Android app
  // has always offered it; the web app had no form at all, which made the Admin
  // panel's "Registrierung erlauben" toggle a no-op for this surface.
  // `registrationAllowed === null` means "not asked yet, or the server didn't
  // answer" - the register option stays hidden then, so a server predating the
  // status route keeps showing exactly the login form it always did.
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [registrationAllowed, setRegistrationAllowed] = useState<boolean | null>(null);
  // Whether the server wants a proof of work with the registration (#324 S13). Only a
  // hint for showing progress early: register() also reacts to the server asking for
  // one, so a stale or missing answer here costs one extra round trip, not a failure.
  const [registrationRequiresPow, setRegistrationRequiresPow] = useState(false);
  const [registerLegal, setRegisterLegal] = useState<LegalPages | null>(null);
  const [registerPass2, setRegisterPass2] = useState('');
  const [registerStatus, setRegisterStatus] = useState<'idle' | 'pow' | 'loading' | 'error'>('idle');
  const [registerError, setRegisterError] = useState('');

  // ── Two-step login (TOTP 2FA, #174) ──
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaUseRecovery, setMfaUseRecovery] = useState(false);
  const [mfaStatus, setMfaStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [mfaError, setMfaError] = useState('');

  const succeed = (token: string, refreshToken: string | undefined) => {
    setLoginPass('');
    setLoginStatus('idle');
    setMfaChallengeToken(null);
    setMfaCode('');
    setMfaUseRecovery(false);
    setMfaStatus('idle');
    setMfaError('');
    onAuthenticated(token, refreshToken);
  };

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
      const data = await res.json() as { token?: string; refreshToken?: string; mfaRequired?: boolean; challengeToken?: string; error?: string };
      // Check the 2FA challenge shape *before* the "no token" error branch —
      // an account with 2FA enabled deliberately gets { mfaRequired: true,
      // challengeToken } instead of real tokens at this step.
      if (res.ok && data.mfaRequired && data.challengeToken) {
        setMfaChallengeToken(data.challengeToken);
        setLoginStatus('idle');
        return;
      }
      if (!res.ok || !data.token) {
        setLoginError(data.error ?? `Fehler ${res.status}`);
        setLoginStatus('error');
        return;
      }
      succeed(data.token, data.refreshToken);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : 'Verbindungsfehler');
      setLoginStatus('error');
    }
  };

  const register = async () => {
    if (loginPass !== registerPass2) {
      setRegisterError('Die beiden Passwörter stimmen nicht überein.');
      setRegisterStatus('error');
      return;
    }
    setRegisterError('');
    const base = serverUrl.replace(/\/$/, '');
    const solve = async (): Promise<PowSolution> => {
      setRegisterStatus('pow');
      const solution = await fetchPowSolution(base);
      setRegisterStatus('loading');
      return solution;
    };
    const post = (pow?: PowSolution) => fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: loginUser, password: loginPass, ...(pow ? { pow } : {}) }),
    });
    try {
      setRegisterStatus('loading');
      let pow = registrationRequiresPow ? await solve() : undefined;
      let res = await post(pow);
      let data = await res.json() as { token?: string; refreshToken?: string; error?: string; powRequired?: boolean };
      // The admin may have switched the check on since the status was read, or the
      // challenge ran out while solving on a slow device: one retry with a fresh one.
      if (res.status === 400 && data.powRequired) {
        setRegistrationRequiresPow(true);
        pow = await solve();
        res = await post(pow);
        data = await res.json() as typeof data;
      }
      if (!res.ok || !data.token) {
        setRegisterError(data.error ?? `Fehler ${res.status}`);
        setRegisterStatus('error');
        return;
      }
      // Registration returns a usable token pair, so the new account is logged
      // in straight away rather than being bounced back to the login form.
      setRegisterStatus('idle');
      setRegisterPass2('');
      setAuthMode('login');
      succeed(data.token, data.refreshToken);
    } catch (e) {
      setRegisterError(e instanceof Error ? e.message : 'Verbindungsfehler');
      setRegisterStatus('error');
    }
  };

  const verifyMfaCode = async () => {
    if (!mfaChallengeToken) return;
    setMfaStatus('loading');
    setMfaError('');
    const base = serverUrl.replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/api/auth/login/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: mfaChallengeToken, code: mfaCode.trim() }),
      });
      const data = await res.json() as { token?: string; refreshToken?: string; error?: string };
      if (!res.ok || !data.token) {
        setMfaError(data.error ?? `Fehler ${res.status}`);
        setMfaStatus('error');
        return;
      }
      succeed(data.token, data.refreshToken);
    } catch (e) {
      setMfaError(e instanceof Error ? e.message : 'Verbindungsfehler');
      setMfaStatus('error');
    }
  };

  const cancelMfaLogin = () => {
    setMfaChallengeToken(null);
    setMfaCode('');
    setMfaUseRecovery(false);
    setMfaStatus('idle');
    setMfaError('');
  };

  // Asks the server whether self-registration is open, so the register option
  // is only offered when it would actually succeed (#278). Runs on the typed
  // serverUrl rather than the saved config, because the whole point is the
  // not-yet-configured visitor. A failure (offline, or a server predating this
  // route) leaves the flag null, which hides the option entirely.
  //
  // An empty serverUrl is a legitimate case, not a "not configured yet" one —
  // the field's own hint says "leer = diese Seite", and login()/register()
  // both already work with an empty base (fetch resolves the relative URL
  // against the current origin). Requiring serverUrl.trim() here meant a
  // visitor who followed that hint literally never saw a register option at
  // all, no matter what the server answered.
  useEffect(() => {
    const controller = new AbortController();
    const base = serverUrl.replace(/\/$/, '');
    fetch(`${base}/api/auth/registration-status`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() as Promise<{ allowed?: boolean; requiresPow?: boolean }> : null))
      .then((data) => {
        setRegistrationAllowed(data?.allowed ?? null);
        setRegistrationRequiresPow(data?.requiresPow === true);
      })
      .catch(() => { /* offline or older server - stay on login-only */ });
    return () => controller.abort();
  }, [serverUrl]);

  useEffect(() => {
    if (authMode !== 'register') return;
    const controller = new AbortController();
    void fetchLegalPages(controller.signal).then((pages) => {
      if (!controller.signal.aborted) setRegisterLegal(pages);
    });
    return () => controller.abort();
  }, [authMode]);

  if (mfaChallengeToken) {
    return (
      <div className={styles.loginBox}>
        <label className={styles.field}>
          <span>{mfaUseRecovery ? 'Wiederherstellungscode' : 'Code aus der Authenticator-App'}</span>
          <input
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            inputMode={mfaUseRecovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            placeholder={mfaUseRecovery ? 'XXXXX-XXXXX' : '123456'}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') void verifyMfaCode(); }}
          />
        </label>
        <button
          type="button"
          className={styles.logoutBtn}
          onClick={() => { setMfaUseRecovery((v) => !v); setMfaCode(''); setMfaError(''); }}
        >
          {mfaUseRecovery ? 'Stattdessen Code aus der App verwenden' : 'Stattdessen Wiederherstellungscode verwenden'}
        </button>
        <div role="status" aria-live="polite" aria-atomic="true">
          {mfaStatus === 'loading' && <span className={styles.infoText}>Prüfe…</span>}
          {mfaStatus === 'error' && <div className={styles.errorBanner}>{mfaError}</div>}
        </div>
        <div className={styles.btnRow}>
          <button
            className={styles.saveBtn}
            onClick={() => void verifyMfaCode()}
            disabled={!mfaCode.trim() || mfaStatus === 'loading'}
          >
            {mfaStatus === 'loading' ? 'Prüfe…' : 'Bestätigen'}
          </button>
          <button className={styles.syncBtn} onClick={cancelMfaLogin}>Abbrechen</button>
        </div>
      </div>
    );
  }

  return (
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
          autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
          onKeyDown={(e) => { if (e.key === 'Enter' && authMode === 'login') void login(); }}
        />
        {authMode === 'register' && (
          <p className={styles.fieldHelpText}>Mindestens 8 Zeichen.</p>
        )}
      </label>
      {authMode === 'register' && (
        <label className={styles.field}>
          <span>Passwort wiederholen</span>
          <input
            type="password"
            value={registerPass2}
            onChange={(e) => setRegisterPass2(e.target.value)}
            autoComplete="new-password"
            onKeyDown={(e) => { if (e.key === 'Enter') void register(); }}
          />
        </label>
      )}
      <div role="status" aria-live="polite" aria-atomic="true">
        {authMode === 'login' && loginStatus === 'loading' && <span className={styles.infoText}>Anmelden…</span>}
        {authMode === 'login' && loginStatus === 'error' && <div className={styles.errorBanner}>{loginError}</div>}
        {authMode === 'register' && registerStatus === 'pow' && <span className={styles.infoText}>Sicherheitsprüfung läuft…</span>}
        {authMode === 'register' && registerStatus === 'loading' && <span className={styles.infoText}>Konto wird erstellt…</span>}
        {authMode === 'register' && registerStatus === 'error' && <div className={styles.errorBanner}>{registerError}</div>}
      </div>
      {authMode === 'login' ? (
        <button
          className={styles.saveBtn}
          onClick={login}
          disabled={!loginUser || !loginPass || loginStatus === 'loading'}
        >
          {loginStatus === 'loading' ? 'Anmelden…' : 'Anmelden'}
        </button>
      ) : (
        <button
          className={styles.saveBtn}
          onClick={register}
          disabled={!loginUser || loginPass.length < 8 || !registerPass2 || registerStatus === 'loading' || registerStatus === 'pow'}
        >
          {registerStatus === 'pow' ? 'Sicherheitsprüfung läuft…'
            : registerStatus === 'loading' ? 'Konto wird erstellt…' : 'Konto erstellen'}
        </button>
      )}
      {/* The instance's legal texts, where it has any (#324 S14): whoever
          creates an account should be able to read them first. A new tab,
          because navigating this one would unmount the half-filled form. */}
      {authMode === 'register' && (registerLegal?.impressum || registerLegal?.datenschutz) && (
        <p className={styles.fieldHelpText}>
          {registerLegal.datenschutz && <a href={LEGAL_ROUTES.datenschutz} target="_blank" rel="noopener">{registerLegal.datenschutz.title}</a>}
          {registerLegal.datenschutz && registerLegal.impressum && ' · '}
          {registerLegal.impressum && <a href={LEGAL_ROUTES.impressum} target="_blank" rel="noopener">{registerLegal.impressum.title}</a>}
        </p>
      )}
      {/* Only offered when the server said registration is actually
          open (#278) - null means "didn't ask / older server", and
          then this stays a login-only box, exactly as before. */}
      {registrationAllowed === true && (
        <button
          type="button"
          className={styles.syncBtn}
          onClick={() => {
            setAuthMode(authMode === 'login' ? 'register' : 'login');
            setRegisterPass2('');
            setRegisterError('');
            setRegisterStatus('idle');
            setLoginError('');
            setLoginStatus('idle');
          }}
        >
          {authMode === 'login' ? 'Noch kein Konto? Registrieren' : 'Zurück zum Anmelden'}
        </button>
      )}
    </div>
  );
}
