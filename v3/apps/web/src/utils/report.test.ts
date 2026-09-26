import { describe, it, expect } from 'vitest';
import { generateReport } from './report';

const EMPTY = { polishes: [], customCats: [], manicures: [], stickers: [] };

describe('generateReport branding (#324 S8)', () => {
  it('uses the default name when none is given', () => {
    const html = generateReport(EMPTY, 'week', new Date('2026-09-20T00:00:00'), (f) => f);
    expect(html).toContain('<div class="cover-title">Nagellacke</div>');
  });

  it('escapes a server-supplied name: the report opens as a blob on the app origin', () => {
    const html = generateReport(EMPTY, 'week', new Date('2026-09-20T00:00:00'), (f) => f, '<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
