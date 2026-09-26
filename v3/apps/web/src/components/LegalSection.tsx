import { useEffect, useState } from 'react';
import { getLegalAdmin, saveLegal } from '../utils/admin';
import type { LegalEditable } from '../utils/admin';
import LegalText from './LegalText';
import styles from '../pages/SettingsPage.module.css';

type Key = 'impressum' | 'datenschutz';
const DEFAULT_TITLES: Record<Key, string> = { impressum: 'Impressum', datenschutz: 'Datenschutz' };

/**
 * Admin → Rechtstexte (#324 S12). Plain text per page, with a preview rendered exactly
 * like the public page. An empty text removes the page, and with it the footer link.
 */
export default function LegalSection() {
  const [pages, setPages] = useState<LegalEditable | null>(null);
  const [drafts, setDrafts] = useState<Record<Key, { title: string; body: string }>>({
    impressum: { title: DEFAULT_TITLES.impressum, body: '' },
    datenschutz: { title: DEFAULT_TITLES.datenschutz, body: '' },
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  const apply = (p: LegalEditable) => {
    setPages(p);
    setDrafts({
      impressum: { title: p.impressum?.title ?? DEFAULT_TITLES.impressum, body: p.impressum?.body ?? '' },
      datenschutz: { title: p.datenschutz?.title ?? DEFAULT_TITLES.datenschutz, body: p.datenschutz?.body ?? '' },
    });
  };
  useEffect(() => {
    getLegalAdmin().then(apply).catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Fehler'); setStatus('error'); });
  }, []);

  const save = async () => {
    setStatus('saving');
    setError('');
    try {
      apply(await saveLegal(drafts));
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
      setStatus('error');
    }
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Rechtstexte</h2>
      <p className={styles.fieldHelpText}>
        Impressum und Datenschutzerklärung dieser Instanz, als reiner Text: Leerzeilen trennen Absätze, Web- und
        E-Mail-Adressen werden automatisch verlinkt. Ist ein Text gepflegt, erscheint unten in der App ein Link darauf
        (für alle Besucher, auch ohne Anmeldung). Ein leerer Text entfernt die Seite.
      </p>
      {(['impressum', 'datenschutz'] as Key[]).map((key) => (
        <div key={key} style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px', color: 'var(--md-on-surface-variant)' }}>
            {DEFAULT_TITLES[key]}{' '}
            <span className={styles.fieldHint}>
              ({pages?.[key] ? `Stand ${new Date(pages[key]!.updatedAt).toLocaleString('de-DE')} · #/${key}` : 'nicht hinterlegt'})
            </span>
          </h3>
          <label className={styles.field}>
            <span>Titel</span>
            <input
              value={drafts[key].title}
              maxLength={120}
              onChange={(e) => setDrafts((d) => ({ ...d, [key]: { ...d[key], title: e.target.value } }))}
            />
          </label>
          <label className={styles.field}>
            <span>Text</span>
            <textarea
              rows={8}
              maxLength={50000}
              value={drafts[key].body}
              onChange={(e) => setDrafts((d) => ({ ...d, [key]: { ...d[key], body: e.target.value } }))}
            />
          </label>
          {drafts[key].body.trim() && (
            <details>
              <summary className={styles.fieldHelpText} style={{ cursor: 'pointer' }}>Vorschau</summary>
              <div style={{ padding: 12, marginTop: 8, borderRadius: 'var(--radius-md)', background: 'var(--md-surface-variant)', fontSize: 14 }}>
                <LegalText text={drafts[key].body} />
              </div>
            </details>
          )}
        </div>
      ))}
      {status === 'error' && <div className={styles.errorBanner}>{error}</div>}
      <div className={styles.btnRow}>
        <button className={styles.saveBtn} onClick={() => void save()} disabled={status === 'saving' || !pages}>
          {status === 'saving' ? 'Speichere…' : status === 'saved' ? '✓ Gespeichert' : 'Speichern'}
        </button>
      </div>
    </section>
  );
}
