import { serverBase } from './serverBase';

/**
 * Client side of the registration proof of work (#324 S13/S14). The server's
 * v3/server/src/pow.ts explains the scheme; here we only fetch a challenge and find
 * an `n` for which sha256(salt + n) starts with `difficulty` zero bits.
 *
 * The search runs in a Web Worker so the page stays responsive for the second or
 * so it takes. Where a worker cannot be started, it runs on the main thread in
 * batches that yield between each other, which is slower to finish but still
 * never freezes the page for long.
 */

export interface PowChallenge {
  salt: string;
  difficulty: number;
  expires: number;
  sig: string;
}

export interface PowSolution extends PowChallenge {
  n: number;
}

/** Hashes per batch: large enough to amortise the await, small enough to yield often. */
const BATCH = 512;

export function hasLeadingZeroBits(hash: Uint8Array, bits: number): boolean {
  const fullBytes = Math.floor(bits / 8);
  for (let i = 0; i < fullBytes; i++) if (hash[i] !== 0) return false;
  const rest = bits % 8;
  if (rest === 0) return true;
  return (hash[fullBytes] >> (8 - rest)) === 0;
}

/**
 * Searches n in [start, start + count) and returns the first solution, or null.
 * Shared by the worker and the main-thread fallback.
 */
export async function searchPow(salt: string, difficulty: number, start: number, count: number): Promise<number | null> {
  const encoder = new TextEncoder();
  const digests: Promise<ArrayBuffer>[] = [];
  for (let n = start; n < start + count; n++) {
    digests.push(crypto.subtle.digest('SHA-256', encoder.encode(`${salt}${n}`)));
  }
  const hashes = await Promise.all(digests);
  for (let i = 0; i < hashes.length; i++) {
    if (hasLeadingZeroBits(new Uint8Array(hashes[i]), difficulty)) return start + i;
  }
  return null;
}

export async function solveOnMainThread(salt: string, difficulty: number): Promise<number> {
  for (let start = 0; ; start += BATCH) {
    const n = await searchPow(salt, difficulty, start, BATCH);
    if (n !== null) return n;
    // Hand the event loop back so input and rendering keep up.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function solveInWorker(salt: string, difficulty: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./powWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<number>) => { worker.terminate(); resolve(e.data); };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Worker-Fehler')); };
    worker.postMessage({ salt, difficulty });
  });
}

export async function solvePow(challenge: PowChallenge): Promise<PowSolution> {
  let n: number;
  try {
    if (typeof Worker === 'undefined') throw new Error('no worker');
    n = await solveInWorker(challenge.salt, challenge.difficulty);
  } catch {
    n = await solveOnMainThread(challenge.salt, challenge.difficulty);
  }
  return { ...challenge, n };
}

/** Fetches a fresh challenge from the server at `base` and solves it. Throws on network or server failure. */
export async function fetchPowSolution(base = serverBase()): Promise<PowSolution> {
  const res = await fetch(`${base}/api/auth/pow-challenge`);
  if (!res.ok) throw new Error(`Sicherheitsprüfung nicht verfügbar (Fehler ${res.status})`);
  const c = await res.json() as Partial<PowChallenge>;
  if (typeof c.salt !== 'string' || typeof c.difficulty !== 'number'
    || typeof c.expires !== 'number' || typeof c.sig !== 'string') {
    throw new Error('Sicherheitsprüfung: ungültige Antwort des Servers');
  }
  return solvePow({ salt: c.salt, difficulty: c.difficulty, expires: c.expires, sig: c.sig });
}
