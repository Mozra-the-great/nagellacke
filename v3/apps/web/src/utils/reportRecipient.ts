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
  /** The recipient used the unsubscribe link in a report mail (#457); the schedule is paused. */
  unsubscribedAt?: number;
  /** That address opted out and may not be asked again: no resend, no switching back on. */
  blocked?: boolean;
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
  if (state?.blocked && savedEmail.trim() && (!editedEmail.trim() || same(savedEmail, editedEmail))) {
    return {
      tone: 'warn',
      text: `${savedEmail.trim()} hat die Berichte abbestellt und bekommt keine weiteren Mails von diesem Konto, auch keine Bestätigungsmail. Trage eine andere Adresse ein.`,
      canResend: false,
    };
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

/**
 * The notice for the account owner after a recipient used the unsubscribe link in a report mail
 * (#457): the schedule is paused, and what that means for this address. Null while nothing happened.
 */
export function unsubscribeNotice(state: RecipientState | null, savedEmail: string): { tone: 'warn'; text: string } | null {
  if (!state?.unsubscribedAt || !savedEmail.trim()) return null;
  const when = new Date(state.unsubscribedAt).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
  return {
    tone: 'warn',
    text: state.blocked
      ? `Der automatische Zeitplan ist pausiert: ${savedEmail.trim()} hat die Berichte am ${when} über den Abmeldelink abbestellt. Die Bestätigung ist entfernt, und die Adresse wird nicht noch einmal angeschrieben. Wähle eine andere Adresse, wenn du weiter Berichte senden willst.`
      : `Der automatische Zeitplan ist pausiert: Die Berichte an ${savedEmail.trim()} wurden am ${when} über den Abmeldelink in einer Berichtsmail beendet. Schalte den Zeitplan wieder ein, wenn du sie doch haben willst.`,
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

/** The recipient presses the button on the unsubscribe page (no session needed). Resolves to the address. */
export async function unsubscribeFromReports(token: string, base: string): Promise<string> {
  const res = await fetch(`${base}/api/reports/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const data = await res.json().catch(() => ({})) as { error?: string; email?: string };
  if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
  return data.email ?? '';
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

// ── Ad-hoc send (#456) ────────────────────────────────────────────────────────

/** An address "Jetzt per E-Mail senden" may mail, as the server lists it (`sendTargets`). */
export interface SendTarget {
  email: string;
  /** The account's own verified address, or the recipient confirmed by link. */
  kind: 'account' | 'recipient';
}

export function sendTargetLabel(target: SendTarget): string {
  return `${target.email} (${target.kind === 'account' ? 'deine Konto-Adresse' : 'bestätigter Empfänger'})`;
}

/** The target to preselect: the current choice if it is still allowed, else the first one, else ''. */
export function pickSendTarget(targets: SendTarget[], current: string): string {
  return targets.find((t) => same(t.email, current))?.email ?? targets[0]?.email ?? '';
}

/**
 * Why the list of send targets is what it is. The server mails reports only to addresses that
 * agreed (#456), so with nothing to choose from the user is told how to get an address onto
 * the list, instead of being offered a text field the server would refuse.
 *
 * @param targets the server's list (null: not loaded yet, or an older server: say nothing)
 * @param accountEmail the account's own address ('' when none)
 * @param emailVerified whether the own address is verified (null: unknown)
 * @param recipient the schedule recipient's state, if any
 * @param scheduleEmail the schedule's saved recipient ('' when none)
 */
export function sendTargetsNotice(
  targets: SendTarget[] | null, accountEmail: string, emailVerified: boolean | null,
  recipient: RecipientState | null, scheduleEmail: string,
): { tone: 'info' | 'warn'; text: string } | null {
  if (targets === null) return null;
  const pending = !!scheduleEmail.trim() && recipient?.status === 'pending';
  const hints: string[] = [];
  if (accountEmail.trim() && emailVerified === false && !targets.some((t) => t.kind === 'account')) {
    hints.push(`Deine Konto-Adresse ${accountEmail.trim()} ist noch nicht verifiziert (Einstellungen → Konto).`);
  } else if (!accountEmail.trim()) {
    hints.push('Für dein Konto ist keine E-Mail-Adresse hinterlegt (Einstellungen → Konto).');
  }
  if (pending) {
    hints.push(`Der Zeitplan-Empfänger ${scheduleEmail.trim()} ist noch nicht bestätigt.`);
  }
  if (targets.length === 0) {
    return {
      tone: 'warn',
      text: 'Ein Bericht kann nur an eine Adresse gesendet werden, die zugestimmt hat: deine verifizierte Konto-Adresse oder ein bestätigter Zeitplan-Empfänger. '
        + `${hints.join(' ')} Verifiziere zuerst deine Adresse oder lass unten im Zeitplan einen Empfänger bestätigen.`.trim(),
    };
  }
  return {
    tone: 'info',
    text: 'Berichte gehen nur an Adressen, die zugestimmt haben (deine verifizierte Konto-Adresse, ein bestätigter Zeitplan-Empfänger). '
      + `Andere Adressen trägst du im Zeitplan ein; ihr Besitzer bestätigt sie per Mail. ${hints.join(' ')}`.trim(),
  };
}
