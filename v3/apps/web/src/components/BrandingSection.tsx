import { useEffect, useId, useState } from 'react';
import {
  getBrandingState, saveBranding, uploadBrandingLogo, deleteBrandingLogo,
} from '../utils/admin';
import type { BrandingPreset, BrandingState, ResolvedBranding } from '../utils/admin';
import { refreshInstanceConfig } from '../utils/instance';
import { serverBase } from '../utils/serverBase';
import styles from '../pages/SettingsPage.module.css';

const PRESET_LABELS: Record<BrandingPreset, string> = {
  nagellacke: 'Nail Lacquer',
  nailvault: 'NailVault',
  custom: 'Eigenes',
};

/**
 * Admin → Branding (#324 S9). Chooses one of the two presets or a custom branding.
 * The preview renders the resolved block the same way the header does, so what an
 * admin sees here is what visitors get.
 */
export default function BrandingSection() {
  const [state, setState] = useState<BrandingState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [preset, setPreset] = useState<BrandingPreset>('nagellacke');
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [introText, setIntroText] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const presetLabelId = useId();

  const applyState = (s: BrandingState) => {
    setState(s);
    setPreset(s.settings.preset);
    setName(s.settings.custom?.name ?? '');
    setTagline(s.settings.custom?.tagline ?? '');
    setAccentColor(s.settings.custom?.accentColor ?? '');
    setIntroText(s.settings.custom?.introText ?? '');
  };

  const load = () => {
    getBrandingState().then(applyState).catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Fehler'));
  };
  useEffect(load, []);

  const fillFrom = (b: ResolvedBranding) => {
    setName(b.name);
    setTagline(b.tagline ?? '');
    setAccentColor(b.accentColor ?? '');
    setIntroText(b.introText ?? '');
  };

  const run = async (action: () => Promise<unknown>) => {
    setStatus('saving');
    setError('');
    try {
      await action();
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
      load();
      // The header reads the same config; show the change without a reload.
      void refreshInstanceConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
      setStatus('error');
    }
  };

  const save = () => run(() => saveBranding(
    preset === 'custom'
      ? { preset, custom: { name, tagline, accentColor, introText } }
      : { preset },
  ));

  // What the header would show with the current, unsaved choice.
  const preview: ResolvedBranding | null = !state ? null
    : preset === 'nagellacke' ? state.presets.nagellacke
    : preset === 'nailvault' ? state.presets.nailvault
    : {
      name: name.trim() || state.presets.nagellacke.name,
      title: name.trim() || state.presets.nagellacke.title,
      tagline: tagline.trim() || null,
      accentColor: /^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : null,
      // The logo route serves whatever preset is *saved*, so a custom logo can only be
      // previewed once custom is the saved choice.
      logoUrl: state.settings.preset === 'custom' ? state.resolved.logoUrl : null,
      introText: introText.trim() || null,
    };

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Branding</h2>
      <p className={styles.fieldHelpText}>
        Name, Untertitel, Akzentfarbe und Logo, die Besucher dieser Instanz sehen. Gilt für die Web-App; die
        Android-App bleibt unverändert.
      </p>
      {loadError && <div className={styles.errorBanner}>{loadError}</div>}

      <div className={styles.field} role="group" aria-labelledby={presetLabelId}>
        <span id={presetLabelId}>Vorlage</span>
        <div className={styles.segmented}>
          {(Object.keys(PRESET_LABELS) as BrandingPreset[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={preset === p}
              className={`${styles.segBtn} ${preset === p ? styles.segBtnActive : ''}`}
              onClick={() => setPreset(p)}
            >{PRESET_LABELS[p]}</button>
          ))}
        </div>
        {preset === 'nailvault' && (
          <p className={styles.fieldHelpText}>Das NailVault-Logo ist ein Platzhalter-Schriftzug und kann jederzeit ersetzt werden.</p>
        )}
      </div>

      {preset === 'custom' && state && (
        <>
          <div className={styles.btnRow}>
            <button type="button" className={styles.syncBtn} onClick={() => fillFrom(state.presets.nagellacke)}>Aus „Nail Lacquer" vorbefüllen</button>
            <button type="button" className={styles.syncBtn} onClick={() => fillFrom(state.presets.nailvault)}>Aus „NailVault" vorbefüllen</button>
          </div>
          <label className={styles.field}>
            <span>Name</span>
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={state.presets.nagellacke.name} />
          </label>
          <label className={styles.field}>
            <span>Untertitel</span>
            <input value={tagline} maxLength={140} onChange={(e) => setTagline(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Akzentfarbe <span className={styles.fieldHint}>(#rrggbb, leer = Standard)</span></span>
            <div className={styles.btnRow} style={{ alignItems: 'center' }}>
              <input
                type="color"
                aria-label="Akzentfarbe wählen"
                value={/^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : '#ffc8e6'}
                onChange={(e) => setAccentColor(e.target.value)}
                style={{ width: 48, height: 40, padding: 0, border: 'none', background: 'none' }}
              />
              <input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} placeholder="#ffc8e6" style={{ flex: 1 }} />
            </div>
          </label>
          <label className={styles.field}>
            <span>Einleitungstext <span className={styles.fieldHint}>(für die spätere Einleitungsseite, reiner Text)</span></span>
            <textarea value={introText} maxLength={4000} rows={4} onChange={(e) => setIntroText(e.target.value)} />
          </label>
          <div className={styles.field}>
            <span>Logo <span className={styles.fieldHint}>(PNG, JPEG oder WebP)</span></span>
            <div className={styles.btnRow}>
              <label className={styles.syncBtn} style={{ cursor: 'pointer' }}>
                Logo hochladen…
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void run(() => uploadBrandingLogo(file));
                  }}
                />
              </label>
              {state.settings.custom?.logo && (
                <button type="button" className={styles.syncBtn} onClick={() => void run(deleteBrandingLogo)}>Logo entfernen</button>
              )}
            </div>
          </div>
        </>
      )}

      {preview && (
        <div
          aria-label="Vorschau"
          style={{
            margin: '12px 0', padding: '16px', borderRadius: 'var(--radius-md)', textAlign: 'center',
            background: 'rgba(8,6,18,0.92)', border: '1px solid var(--md-outline-variant)',
          }}
        >
          {preview.logoUrl
            ? <img src={`${serverBase()}${preview.logoUrl}`} alt={preview.name} style={{ maxHeight: 56, maxWidth: '100%' }} />
            : <div style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 300, letterSpacing: 3 }}>{preview.name}</div>}
          {preview.tagline && <div style={{ fontSize: 13, color: 'var(--md-on-surface-variant)', marginTop: 4 }}>{preview.tagline}</div>}
          <div style={{ marginTop: 10 }}>
            <span style={{
              display: 'inline-block', padding: '6px 14px', borderRadius: 'var(--radius-xl)', fontSize: 13, fontWeight: 600,
              background: preview.accentColor ?? 'rgba(255,200,230,0.9)', color: 'var(--md-on-primary)',
            }}>Beispiel-Knopf</span>
          </div>
        </div>
      )}

      {status === 'error' && <div className={styles.errorBanner}>{error}</div>}
      <div className={styles.btnRow}>
        <button className={styles.saveBtn} onClick={() => void save()} disabled={status === 'saving' || !state}>
          {status === 'saving' ? 'Speichere…' : status === 'saved' ? '✓ Gespeichert' : 'Speichern'}
        </button>
      </div>
    </section>
  );
}
