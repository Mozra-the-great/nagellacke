import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import IntroGate, { DEFAULT_INTRO_TEXT } from './IntroGate';
import AdoptLocalDataDialog from './AdoptLocalDataDialog';
import { introGateVisible } from '../utils/instance';
import type { InstanceConfig } from '../utils/instance';

const noop = () => {};

function config(publicInstance: boolean): InstanceConfig {
  return {
    publicInstance, photoUploads: true, ai: true,
    branding: { name: 'X', title: 'X', tagline: null, accentColor: null, logoUrl: null, introText: null },
  };
}

describe('introGateVisible (#324 S16)', () => {
  const base = { hasSyncConfig: false, localOnlyAck: false, onLegalPage: false };

  it('stands in front of the app only on a public instance', () => {
    expect(introGateVisible({ ...base, config: config(true) })).toBe(true);
    expect(introGateVisible({ ...base, config: config(false) })).toBe(false);
    // No answer (older server, offline, static host) means today's behaviour: no gate.
    expect(introGateVisible({ ...base, config: null })).toBe(false);
  });

  it('lets through whoever has a sync setup or chose to work without an account', () => {
    expect(introGateVisible({ ...base, config: config(true), hasSyncConfig: true })).toBe(false);
    expect(introGateVisible({ ...base, config: config(true), localOnlyAck: true })).toBe(false);
  });

  it('never covers the legal pages the gate itself links to', () => {
    expect(introGateVisible({ ...base, config: config(true), onLegalPage: true })).toBe(false);
  });
});

describe('IntroGate (#324 S16)', () => {
  it('offers both ways in, and describes the app when no intro text is maintained', () => {
    const html = renderToStaticMarkup(createElement(IntroGate, { introText: null, onAuthenticated: noop, onLocalOnly: noop }));
    expect(html).toContain('Anmelden oder Konto erstellen');
    expect(html).toContain('Ohne Konto weiter');
    expect(html).toContain(DEFAULT_INTRO_TEXT.split('\n')[0]);
    // The local-only way spells out what it costs before anyone picks it.
    expect(html).toContain('nur in diesem Browser');
    expect(html).toContain('privaten Fenster');
  });

  it('shows the maintained intro text instead of the default, as text rather than markup', () => {
    const html = renderToStaticMarkup(createElement(IntroGate, {
      introText: 'Willkommen bei <b>uns</b>', onAuthenticated: noop, onLocalOnly: noop,
    }));
    expect(html).toContain('Willkommen bei &lt;b&gt;uns&lt;/b&gt;');
    expect(html).not.toContain(DEFAULT_INTRO_TEXT.split('\n')[0]);
  });
});

describe('AdoptLocalDataDialog (#324 S16)', () => {
  it('names how many entries are at stake and offers both answers', () => {
    const html = renderToStaticMarkup(createElement(AdoptLocalDataDialog, { count: 3, onResolve: noop }));
    expect(html).toContain('liegen 3 Einträge, die');
    expect(html).toContain('Übernehmen');
    expect(html).toContain('Verwerfen');
    expect(html).toContain('role="dialog"');
  });

  it('uses the singular for one entry', () => {
    const html = renderToStaticMarkup(createElement(AdoptLocalDataDialog, { count: 1, onResolve: noop }));
    expect(html).toContain('liegt 1 Eintrag, der');
  });
});
