/**
 * Instance branding (#324 S6). Two named presets plus "custom", chosen in the admin
 * panel and stored in data/branding.json. Nothing instance-specific lives in the code
 * beyond these two presets: a fork keeps the default and has nothing to delete.
 *
 * What leaves the server is always a *resolved* block (resolveBranding), never a
 * preset name, so the web app has exactly one render path and no copy of this table.
 */

export type BrandingPreset = 'nagellacke' | 'nailvault' | 'custom';
export const BRANDING_PRESETS: readonly BrandingPreset[] = ['nagellacke', 'nailvault', 'custom'];

export interface CustomBranding {
  name?: string;
  tagline?: string;
  accentColor?: string;
  introText?: string;
  /** Uploaded via POST /api/admin/branding/logo; stored under data/branding/. */
  logo?: { filename: string; mimeType: string; updatedAt: number };
}

export interface BrandingSettings {
  preset: BrandingPreset;
  custom?: CustomBranding;
}

export interface ResolvedBranding {
  /** Header wordmark text. */
  name: string;
  /** Browser tab and report title. */
  title: string;
  tagline: string | null;
  /** Only ever sets --md-primary on the client; strictly #rrggbb. */
  accentColor: string | null;
  /** Server-relative path of the logo (GET /api/branding/logo), or null. */
  logoUrl: string | null;
  introText: string | null;
}

export const DEFAULT_BRANDING_SETTINGS: BrandingSettings = { preset: 'nagellacke' };

/** The app as it has always looked. */
const NAGELLACKE: ResolvedBranding = {
  name: 'Nail Lacquer',
  title: 'Nagellacke',
  tagline: null,
  accentColor: null,
  logoUrl: null,
  introText: null,
};

/**
 * Placeholder wordmark for the NailVault preset: plain text set in the app's display
 * face. Deliberately a placeholder, meant to be replaced by a real logo at any time;
 * kept inline so the server can serve it without a build step copying assets. The
 * colour is fixed rather than currentColor, because an SVG loaded through <img> does
 * not inherit the page's colour and would render black on the dark header.
 */
export const NAILVAULT_WORDMARK_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Placeholder wordmark for the "NailVault" branding preset (#324). Replace freely. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 64" role="img" aria-label="NailVault">
  <text x="180" y="46" text-anchor="middle" fill="#f4ecf1"
        font-family="'Cormorant Garamond', Georgia, serif" font-size="44" font-weight="300"
        letter-spacing="4">NailVault</text>
</svg>
`;

export const MAX_BRANDING_NAME = 60;
export const MAX_BRANDING_TAGLINE = 140;
export const MAX_BRANDING_INTRO = 4000;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Cache-busting query so a replaced logo is not served from the browser cache. */
function logoPath(version: number | string): string {
  return `/api/branding/logo?v=${encodeURIComponent(String(version))}`;
}

export function resolvePreset(preset: Exclude<BrandingPreset, 'custom'>): ResolvedBranding {
  if (preset === 'nailvault') {
    return { ...NAGELLACKE, name: 'NailVault', title: 'NailVault', logoUrl: logoPath('nailvault') };
  }
  return { ...NAGELLACKE };
}

export function resolveBranding(settings: BrandingSettings): ResolvedBranding {
  if (settings.preset !== 'custom') return resolvePreset(settings.preset === 'nailvault' ? 'nailvault' : 'nagellacke');
  const c = settings.custom ?? {};
  const name = c.name?.trim() || NAGELLACKE.name;
  return {
    name,
    title: c.name?.trim() || NAGELLACKE.title,
    tagline: c.tagline?.trim() || null,
    accentColor: c.accentColor && HEX_COLOR.test(c.accentColor) ? c.accentColor : null,
    logoUrl: c.logo ? logoPath(c.logo.updatedAt) : null,
    introText: c.introText?.trim() || null,
  };
}

/**
 * Validates a POST /api/admin/branding body. Returns a German error message, or the
 * settings to store. The accent colour is held to #rrggbb because it ends up in a CSS
 * custom property: anything looser would be a way to inject CSS.
 */
export function parseBrandingInput(
  body: unknown,
  current: BrandingSettings,
): { error: string } | { settings: BrandingSettings } {
  if (!body || typeof body !== 'object') return { error: 'Ungültige Eingabe' };
  const b = body as { preset?: unknown; custom?: unknown };
  const preset = b.preset ?? current.preset;
  if (typeof preset !== 'string' || !BRANDING_PRESETS.includes(preset as BrandingPreset)) {
    return { error: 'preset muss nagellacke, nailvault oder custom sein' };
  }
  const next: BrandingSettings = { preset: preset as BrandingPreset, custom: { ...current.custom } };
  if (b.custom !== undefined) {
    if (!b.custom || typeof b.custom !== 'object') return { error: 'custom muss ein Objekt sein' };
    const c = b.custom as Record<string, unknown>;
    const text = (key: 'name' | 'tagline' | 'introText', max: number): string | undefined | { error: string } => {
      const v = c[key];
      if (v === undefined) return next.custom?.[key];
      if (typeof v !== 'string') return { error: `${key} muss Text sein` };
      if (v.length > max) return { error: `${key} darf höchstens ${max} Zeichen lang sein` };
      return v.trim() || undefined;
    };
    for (const [key, max] of [['name', MAX_BRANDING_NAME], ['tagline', MAX_BRANDING_TAGLINE], ['introText', MAX_BRANDING_INTRO]] as const) {
      const r = text(key, max);
      if (r && typeof r === 'object') return r;
      next.custom![key] = r as string | undefined;
    }
    if (c.accentColor !== undefined) {
      if (c.accentColor === null || c.accentColor === '') {
        next.custom!.accentColor = undefined;
      } else if (typeof c.accentColor !== 'string' || !HEX_COLOR.test(c.accentColor)) {
        return { error: 'accentColor muss eine Farbe im Format #rrggbb sein' };
      } else {
        next.custom!.accentColor = c.accentColor.toLowerCase();
      }
    }
  }
  return { settings: next };
}
