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
    /** Header wordmark text. */
    name: string;
    /** Browser tab and report title. */
    title: string;
    tagline: string | null;
    accentColor: string | null;
    logoUrl: string | null;
    introText: string | null;
  };
}

/** The app's own names, used whenever the server says nothing (#324 S8). */
export const DEFAULT_NAME = 'Nail Lacquer';
export const DEFAULT_TITLE = 'Nagellacke';

/**
 * The logo's URL, resolved against the server that reported it: logoUrl is a server
 * path, and the web app may be served from a different origin than the API.
 */
export function brandingLogoSrc(cfg: InstanceConfig | null): string | null {
  const url = cfg?.branding.logoUrl;
  if (!url) return null;
  return url.startsWith('/') ? `${serverBase()}${url}` : null;
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
        name: typeof b.name === 'string' && b.name ? b.name : DEFAULT_NAME,
        title: typeof b.title === 'string' && b.title ? b.title : DEFAULT_TITLE,
        tagline: typeof b.tagline === 'string' ? b.tagline : null,
        // Re-checked here although the server validates it: it goes into a CSS
        // custom property, and this client may be talking to any server.
        accentColor: typeof b.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.accentColor) ? b.accentColor : null,
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
// Whether any answer (including "none") has arrived yet. Only the intro gate needs
// this: it must not flash the app first and then snatch it away (#324 S16).
let loaded = false;
const listeners = new Set<() => void>();

/** Re-reads the config, e.g. on startup and whenever the configured server may have changed. */
export async function refreshInstanceConfig(signal?: AbortSignal): Promise<void> {
  const next = await fetchInstanceConfig(signal);
  if (signal?.aborted) return;
  current = next;
  loaded = true;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useInstanceConfig(): InstanceConfig | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

export function useInstanceConfigLoaded(): boolean {
  return useSyncExternalStore(subscribe, () => loaded, () => false);
}

/**
 * Whether the public-instance intro gate stands in front of the app (#324 S16): only
 * on a public instance, only for a visitor who has neither a sync setup nor chose to
 * work without an account, and never over the legal pages, which the gate links to.
 */
export function introGateVisible(opts: {
  config: InstanceConfig | null;
  hasSyncConfig: boolean;
  localOnlyAck: boolean;
  onLegalPage: boolean;
}): boolean {
  return opts.config?.publicInstance === true && !opts.hasSyncConfig && !opts.localOnlyAck && !opts.onLegalPage;
}

/** False only when the server has explicitly switched AI off. */
export function aiOffered(cfg: InstanceConfig | null): boolean {
  return cfg?.ai !== false;
}

/** False only when the server has explicitly switched photo uploads off. */
export function photoUploadsOffered(cfg: InstanceConfig | null): boolean {
  return cfg?.photoUploads !== false;
}
