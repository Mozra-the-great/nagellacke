import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseLegalText, legalPageForHash } from './legal';
import LegalText from '../components/LegalText';

describe('parseLegalText (#324 S12)', () => {
  it('splits paragraphs on blank lines and keeps single line breaks', () => {
    const p = parseLegalText('Max Muster\nBeispielweg 1\r\n\r\nKontakt');
    expect(p).toHaveLength(2);
    expect(p[0]).toHaveLength(2);
    expect(p[1][0]).toEqual([{ type: 'text', text: 'Kontakt' }]);
  });

  it('links URLs and e-mail addresses, without trailing punctuation', () => {
    const [[line]] = parseLegalText('Siehe https://example.org/a. Oder mail@example.org!');
    expect(line).toEqual([
      { type: 'text', text: 'Siehe ' },
      { type: 'link', text: 'https://example.org/a', href: 'https://example.org/a' },
      { type: 'text', text: '. Oder ' },
      { type: 'link', text: 'mail@example.org', href: 'mailto:mail@example.org' },
      { type: 'text', text: '!' },
    ]);
  });

  it('renders typed markup as text, never as HTML', () => {
    const html = renderToStaticMarkup(createElement(LegalText, { text: '<script>alert(1)</script> <b>fett</b>' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<b>');
  });

  it('does not link javascript: or other schemes', () => {
    const html = renderToStaticMarkup(createElement(LegalText, { text: 'javascript:alert(1) data:text/html,x' }));
    expect(html).not.toContain('<a');
  });

  it('maps only the two known hashes', () => {
    expect(legalPageForHash('#/impressum')).toBe('impressum');
    expect(legalPageForHash('#/datenschutz')).toBe('datenschutz');
    expect(legalPageForHash('#/admin')).toBeNull();
    expect(legalPageForHash('')).toBeNull();
  });
});
