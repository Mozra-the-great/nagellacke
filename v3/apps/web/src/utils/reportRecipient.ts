import { serverSession } from './serverBase';

/**
 * Double opt-in for the recipient of the scheduled report (#449). The server only
 * sends reports to an address that is the account's own verified one or whose owner
 * clicked the link in the confirmation mail; this is the web side of that: the state
 * the server reports, what to tell the user about it, and the two calls.
 */
export type RecipientStatus = 'none' | 'pending' | 'confirmed';

export interface RecipientState {
  status: RecipientStatus;
  /** Why it counts as confirmed: the account's own verified address, or the mailed link. */
  via?: 'account' | 'link';
  /** Set while pending, once a confirmation mail for the current address has gone out. */
  confirmationSentAt?: number;
}

/** What POST /api/reports/schedule says happened to the confirmation mail. */
export type ConfirmationOutcome = 'not-needed' | 'sent' | 'pending' | 'unavailable' | 'failed';

export interface RecipientNotice {
  tone: 'ok' | 'warn' | 'info';
  text: string;
  /** Whether "Bestätigungsmail erneut senden" makes sense. */
  canResend: boolean;
}

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The line shown under the "Senden an" field.
 *
 * @param state the server's view of the saved recipient (null: not loaded yet)
 * @param savedEmail the recipient as saved on the server
 * @param editedEmail what is currently typed in the field
 * @param mailAvailable whether the server can send the confirmation mail at all (null: unknown)
 * @param ownVerifiedEmail the account's own address if it is verified, else '' - it needs no confirmation
 */
export function recipientNotice(
  state: RecipientState | null, savedEmail: string, editedEmail: string, mailAvailable: boolean | null,
  ownVerifiedEmail = '',
): RecipientNotice | null {
  const edited = editedEmail.trim();
  if (edited && ownVerifiedEmail && same(edited, ownVerifiedEmail) && (!savedEmail.trim() || !same(savedEmail, edited))) {
    return { tone: 'ok', text: 'Das ist die verifizierte Adresse deines Kontos; sie braucht keine Bestätigung.', canResend: false };
  }
  if (!state || state.status === 'none' || !savedEmail.trim()) {
    return editedEmail.trim()
      ? { tone: 'info', text: 'Diese Adresse muss bestätigt werden: Beim Speichern geht eine Bestätigungsmail an sie.', canResend: false }
      : null;
  }
  if (!same(savedEmail, editedEmail) && editedEmail.trim()) {
    return {
      tone: 'info',
      text: 'Eine geänderte Adresse muss neu bestätigt werden. Beim Speichern geht eine Bestätigungsmail an sie; bis dahin wird nichts gesendet.',
      canResend: false,
    };
  }
  if (state.status === 'confirmed') {
    return {
      tone: 'ok',
      text: state.via === 'account'
        ? 'Bestätigt: das ist die verifizierte Adresse deines Kontos.'
        : 'Bestätigt: der Empfänger hat den Link in der Bestätigungsmail geöffnet.',
      canResend: false,
    };
  }
  if (mailAvailable === false) {
    return {
      tone: 'warn',
      text: 'Nicht bestätigt, und dieser Server kann keine Bestätigungsmail senden (E-Mail-Versand oder App-URL fehlt). Es wird kein Bericht gesendet.',
      canResend: false,
    };
  }
  return {
    tone: 'warn',
    text: state.confirmationSentAt
      ? `Noch nicht bestätigt: Die Bestätigungsmail an ${savedEmail.trim()} wurde gesendet. Es wird kein Bericht gesendet, bis der Empfänger den Link darin öffnet (gültig 48 Stunden).`
      : 'Noch nicht bestätigt: Es wird kein Bericht gesendet, bis der Empfänger die Bestätigungsmail beantwortet. Sie wurde noch nicht gesendet.',
    canResend: true,
  };
}

/** What to tell the user right after saving, from the server's `confirmation` answer. */
export function confirmationMessage(outcome: ConfirmationOutcome | undefined, email: string): { tone: 'ok' | 'warn'; text: string } | null {
  switch (outcome) {
    case 'sent':
      return { tone: 'ok', text: `Gespeichert. Eine Bestätigungsmail ging an ${email.trim()}; Berichte werden erst gesendet, wenn der Empfänger sie bestätigt.` };
    case 'unavailable':
      return { tone: 'warn', text: 'Gespeichert, aber dieser Server kann keine Bestätigungsmail senden (E-Mail-Versand oder App-URL fehlt). Es wird kein Bericht gesendet.' };
    case 'failed':
      return { tone: 'warn', text: 'Gespeichert, aber die Bestätigungsmail konnte nicht gesendet werden. Du kannst sie unten erneut anfordern.' };
    default:
      return null;
  }
}

function bearer(): { base: string; headers: Record<string, string> } {
  const session = serverSession();
  if (!session) throw new Error('Nicht angemeldet');
  return { base: session.base, headers: { Authorization: `Bearer ${session.token}` } };
}

/** The recipient opens the link in the confirmation mail (no session needed). */
export async function confirmReportRecipient(token: string, base: string): Promise<void> {
  const res = await fetch(`${base}/api/reports/schedule/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `Fehler ${res.status}`);
  }
}

/** "Bestätigungsmail erneut senden". */
export async function resendRecipientConfirmation(): Promise<void> {
  const { base, headers } = bearer();
  const res = await fetch(`${base}/api/reports/schedule/confirmation`, { method: 'POST', headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `Fehler ${res.status}`);
  }
}
