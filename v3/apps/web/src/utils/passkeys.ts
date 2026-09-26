import { serverBase, serverSession } from './serverBase';

/**
 * Browser side of passkeys (#228). The server hands out the WebAuthn options as JSON
 * (base64url for every binary field) and expects the credential back in the same
 * encoding. Converting both ways is all this does; there is deliberately no client
 * library for it, the whole job is these few conversions.
 */

/** Passkeys need a secure context (https or localhost) and a browser that has WebAuthn. */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true
    && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials;
}

export function base64UrlToBuffer(value: string): ArrayBuffer {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type CredentialDescriptorJSON = { id: string; type?: string; transports?: string[] };

function descriptors(list: CredentialDescriptorJSON[] | undefined): PublicKeyCredentialDescriptor[] | undefined {
  return list?.map((c) => ({ id: base64UrlToBuffer(c.id), type: 'public-key', transports: c.transports as AuthenticatorTransport[] | undefined }));
}

/** navigator.credentials.create() options from the server's JSON. */
export function creationOptionsFromJSON(json: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const o = json as unknown as PublicKeyCredentialCreationOptions & {
    challenge: string; user: { id: string; name: string; displayName: string }; excludeCredentials?: CredentialDescriptorJSON[];
  };
  return {
    ...o,
    challenge: base64UrlToBuffer(o.challenge),
    user: { ...o.user, id: base64UrlToBuffer(o.user.id) },
    excludeCredentials: descriptors(o.excludeCredentials),
  };
}

/** navigator.credentials.get() options from the server's JSON. */
export function requestOptionsFromJSON(json: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const o = json as unknown as PublicKeyCredentialRequestOptions & { challenge: string; allowCredentials?: CredentialDescriptorJSON[] };
  return { ...o, challenge: base64UrlToBuffer(o.challenge), allowCredentials: descriptors(o.allowCredentials) };
}

export function registrationToJSON(cred: PublicKeyCredential): Record<string, unknown> {
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64Url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufferToBase64Url(r.clientDataJSON),
      attestationObject: bufferToBase64Url(r.attestationObject),
      transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
    },
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
  };
}

export function assertionToJSON(cred: PublicKeyCredential): Record<string, unknown> {
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64Url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufferToBase64Url(r.clientDataJSON),
      authenticatorData: bufferToBase64Url(r.authenticatorData),
      signature: bufferToBase64Url(r.signature),
      userHandle: r.userHandle ? bufferToBase64Url(r.userHandle) : undefined,
    },
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
  };
}

/** A cancelled or timed-out browser prompt reads as a plain sentence, not a DOMException name. */
export function passkeyErrorMessage(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError') return 'Abgebrochen oder abgelaufen.';
    if (e.name === 'InvalidStateError') return 'Auf diesem Gerät ist für dieses Konto schon ein Passkey gespeichert.';
    if (e.name === 'SecurityError') return 'Diese Seite läuft nicht unter der Domain, für die der Server Passkeys ausstellt.';
  }
  return e instanceof Error ? e.message : 'Unbekannter Fehler';
}

async function json(res: Response): Promise<Record<string, unknown>> {
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `Fehler ${res.status}`);
  return data;
}

function session(): { base: string; headers: Record<string, string> } {
  const s = serverSession();
  if (!s) throw new Error('Nicht angemeldet');
  return { base: s.base, headers: { Authorization: `Bearer ${s.token}` } };
}

export interface PasskeyInfo { id: string; name: string; createdAt: number; lastUsedAt: number | null; stale: boolean }

export async function listPasskeys(): Promise<{ available: boolean; reason: string | null; passkeys: PasskeyInfo[] }> {
  const { base, headers } = session();
  return await json(await fetch(`${base}/api/auth/passkeys`, { headers })) as unknown as { available: boolean; reason: string | null; passkeys: PasskeyInfo[] };
}

export async function addPasskey(name: string): Promise<void> {
  const { base, headers } = session();
  const options = await json(await fetch(`${base}/api/auth/passkeys/register/options`, { method: 'POST', headers }));
  const cred = await navigator.credentials.create({ publicKey: creationOptionsFromJSON(options) }) as PublicKeyCredential | null;
  if (!cred) throw new Error('Abgebrochen oder abgelaufen.');
  await json(await fetch(`${base}/api/auth/passkeys/register/verify`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: registrationToJSON(cred), name }),
  }));
}

export async function removePasskey(id: string): Promise<void> {
  const { base, headers } = session();
  await json(await fetch(`${base}/api/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE', headers }));
}

/** Signs in with a discoverable passkey; resolves to the token pair a password login would get. */
export async function loginWithPasskey(base = serverBase()): Promise<{ token: string; refreshToken?: string }> {
  const options = await json(await fetch(`${base}/api/auth/passkeys/login/options`, { method: 'POST' }));
  const cred = await navigator.credentials.get({ publicKey: requestOptionsFromJSON(options) }) as PublicKeyCredential | null;
  if (!cred) throw new Error('Abgebrochen oder abgelaufen.');
  const data = await json(await fetch(`${base}/api/auth/passkeys/login/verify`, {
    method: 'POST',
    // Same request shape as the password login, so the refresh cookie (#299) is set the
    // same way.
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: assertionToJSON(cred) }),
  }));
  if (typeof data.token !== 'string') throw new Error('Anmeldung fehlgeschlagen: kein Token erhalten.');
  return { token: data.token, refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : undefined };
}
