import * as crypto from 'node:crypto';

/**
 * A software WebAuthn authenticator for tests (#228): ES256, "none" attestation, a
 * signature counter, and switches for the flags a test wants to get wrong. Only what
 * the passkey routes need, not a general implementation.
 */

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor> | { [k: string]: Cbor };

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}

export function cbor(value: Cbor): Buffer {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') { const b = Buffer.from(value, 'utf-8'); return Buffer.concat([head(3, b.length), b]); }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');

export interface SoftAuthenticatorOptions {
  rpId: string;
  origin: string;
}

export class SoftAuthenticator {
  readonly credentialId = crypto.randomBytes(16);
  private readonly keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  private counter = 0;
  userHandle: string | null = null;

  constructor(private readonly opts: SoftAuthenticatorOptions) {}

  get id(): string { return b64url(this.credentialId); }

  private authData(flags: number, attested?: Buffer): Buffer {
    const rpIdHash = crypto.createHash('sha256').update(this.opts.rpId).digest();
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    return Buffer.concat([rpIdHash, Buffer.from([flags]), count, ...(attested ? [attested] : [])]);
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf-8');
  }

  /** Answers navigator.credentials.create() options as the browser would serialize them. */
  register(options: { challenge: string; user: { id: string } }, over: { origin?: string; uv?: boolean } = {}) {
    this.userHandle = options.user.id;
    const jwk = this.keys.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const coseKey = new Map<Cbor, Cbor>([
      [1, 2], [3, -7], [-1, 1],
      [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')],
    ]);
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const attested = Buffer.concat([Buffer.alloc(16), idLen, this.credentialId, cbor(coseKey)]);
    const flags = 0x01 | (over.uv === false ? 0 : 0x04) | 0x40;
    const attestationObject = cbor({ fmt: 'none', attStmt: new Map(), authData: this.authData(flags, attested) });
    return {
      id: this.id, rawId: this.id, type: 'public-key',
      response: {
        clientDataJSON: b64url(this.clientData('webauthn.create', options.challenge, over.origin ?? this.opts.origin)),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    };
  }

  /** Answers navigator.credentials.get() options. */
  authenticate(options: { challenge: string }, over: { origin?: string; uv?: boolean } = {}) {
    this.counter += 1;
    const flags = 0x01 | (over.uv === false ? 0 : 0x04);
    const authData = this.authData(flags);
    const clientData = this.clientData('webauthn.get', options.challenge, over.origin ?? this.opts.origin);
    const signed = Buffer.concat([authData, crypto.createHash('sha256').update(clientData).digest()]);
    const signature = crypto.sign('sha256', signed, this.keys.privateKey);
    return {
      id: this.id, rawId: this.id, type: 'public-key',
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: this.userHandle ?? undefined,
      },
      clientExtensionResults: {},
    };
  }
}
