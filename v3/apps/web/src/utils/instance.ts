import { useSyncExternalStore } from 'react';
import { serverBase } from './serverBase';

/**
 * What the server says it offers, from the public GET /api/instance-config (#324).
 * The web app used to decide on its own whether to show AI and photo uploads; once
 * an admin can switch them off server-side, a UI that still offers them would only
 * produce 403s.
 */
export interface InstanceConfig {
  publicInstance: boolean;
  photoUploads: boolean;
  ai: boolean;
  branding: {
    name: string;
    tagline: string | null;
    accentColor: string | null;
    logoUrl: string | null;
    introText: string | null;
  };
}

/**
 * Asks the configured sync server, or this page's own origin when none is set. Any
 * failure (a server older than #324 answering 404, offline, a static host with no API)
 * yields null, and null means "behave exactly as before": everything shown, no gate.
 */
export async function fetchInstanceConfig(signal?: AbortSignal): Promise<InstanceConfig | null> {
  try {
    const res = await fetch(`${serverBase()}/api/instance-config`, { signal });
    if (!res.ok) return null;
    const d = await res.json() as Partial<InstanceConfig> | null;
    if (!d || typeof d !== 'object') return null;
    const b = (d.branding ?? {}) as Partial<InstanceConfig['branding']>;
    return {
      // Strict for the flag that restricts, lenient for the ones that allow: a
      // malformed answer must never hide a feature the server did not switch off.
      publicInstance: d.publicInstance === true,
      photoUploads: d.photoUploads !== false,
      ai: d.ai !== false,
      branding: {
        name: typeof b.name === 'string' && b.name ? b.name : 'Nail Lacquer',
        tagline: typeof b.tagline === 'string' ? b.tagline : null,
        accentColor: typeof b.accentColor === 'string' ? b.accentColor : null,
        logoUrl: typeof b.logoUrl === 'string' ? b.logoUrl : null,
        introText: typeof b.introText === 'string' ? b.introText : null,
      },
    };
  } catch {
    return null;
  }
}

// Module state rather than a context: the config is global to the page, and the
// components that need it (photo field, cart, polish form, settings) sit at very
// different depths.
let current: InstanceConfig | null = null;
const listeners = new Set<() => void>();

/** Re-reads the config, e.g. on startup and whenever the configured server may have changed. */
export async function refreshInstanceConfig(signal?: AbortSignal): Promise<void> {
  const next = await fetchInstanceConfig(signal);
  if (signal?.aborted) return;
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useInstanceConfig(): InstanceConfig | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

/** False only when the server has explicitly switched AI off. */
export function aiOffered(cfg: InstanceConfig | null): boolean {
  return cfg?.ai !== false;
}

/** False only when the server has explicitly switched photo uploads off. */
export function photoUploadsOffered(cfg: InstanceConfig | null): boolean {
  return cfg?.photoUploads !== false;
}
