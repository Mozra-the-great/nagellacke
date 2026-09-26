import { serverBase } from './serverBase';

/**
 * Impressum and Datenschutz (#324 S11/S12), maintained per instance in the admin panel.
 * Plain text by design: the app has no markdown or sanitizer dependency and not a single
 * dangerouslySetInnerHTML, and these pages are no reason to start. parseLegalText turns
 * the text into paragraphs, lines and link segments that React renders as nodes.
 */
export type LegalPageKey = 'impressum' | 'datenschutz';
export interface LegalPage { title: string; body: string; updatedAt: number }
export type LegalPages = Record<LegalPageKey, LegalPage | null>;

export const LEGAL_ROUTES: Record<LegalPageKey, string> = {
  impressum: '#/impressum',
  datenschutz: '#/datenschutz',
};

export function legalPageForHash(hash: string): LegalPageKey | null {
  if (hash === LEGAL_ROUTES.impressum) return 'impressum';
  if (hash === LEGAL_ROUTES.datenschutz) return 'datenschutz';
  return null;
}

/** Null on any failure, and null means "no legal links", as on a server older than #324. */
export async function fetchLegalPages(signal?: AbortSignal): Promise<LegalPages | null> {
  try {
    const res = await fetch(`${serverBase()}/api/legal`, { signal });
    if (!res.ok) return null;
    const d = await res.json() as Partial<Record<LegalPageKey, unknown>>;
    const page = (v: unknown): LegalPage | null => {
      const p = v as Partial<LegalPage> | null;
      return p && typeof p.title === 'string' && typeof p.body === 'string' && typeof p.updatedAt === 'number'
        ? { title: p.title, body: p.body, updatedAt: p.updatedAt } : null;
    };
    return { impressum: page(d.impressum), datenschutz: page(d.datenschutz) };
  } catch {
    return null;
  }
}

export type LegalSegment =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string };

// A URL runs to the next whitespace; trailing sentence punctuation is not part of it.
const TOKEN = /(https?:\/\/[^\s<>"]+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

function segmentLine(line: string): LegalSegment[] {
  const out: LegalSegment[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    let raw = m[0];
    const trail = /[.,;:!?)\]]+$/.exec(raw)?.[0] ?? '';
    if (trail) raw = raw.slice(0, -trail.length);
    const start = m.index ?? 0;
    if (start > last) out.push({ type: 'text', text: line.slice(last, start) });
    out.push(m[1]
      ? { type: 'link', text: raw, href: raw }
      : { type: 'link', text: raw, href: `mailto:${raw}` });
    last = start + raw.length;
  }
  if (last < line.length) out.push({ type: 'text', text: line.slice(last) });
  return out;
}

/** Paragraphs (split on blank lines) of lines of segments. */
export function parseLegalText(text: string): LegalSegment[][][] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split('\n').map(segmentLine));
}
