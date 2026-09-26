import ServerAuthForm from './ServerAuthForm';
import LegalText from './LegalText';
import settingsStyles from '../pages/SettingsPage.module.css';
import styles from './IntroGate.module.css';

/**
 * Shown when an admin maintained no intro text. It describes the app, never an
 * instance: nothing instance-specific belongs in the code (#324 plan).
 */
export const DEFAULT_INTRO_TEXT =
  'Hier verwaltest du deine Nagellack-Sammlung: Lacke, Sticker, ein Maniküre-Tagebuch und die Einkaufsliste.\n\n'
  + 'Mit einem Konto liegt deine Sammlung auf diesem Server und ist auf all deinen Geräten verfügbar, auch in der Android-App.';

interface IntroGateProps {
  introText: string | null;
  onAuthenticated: (token: string, refreshToken: string | undefined) => void;
  onLocalOnly: () => void;
}

/**
 * The page in front of the app on a public instance (#324 S16), for a visitor who has
 * neither signed in nor chosen to work without an account. Both ways lead into the
 * app; the second stays reversible through the banner App.tsx shows afterwards. The
 * legal pages stay reachable through App.tsx's footer, which the gate leaves in place.
 */
export default function IntroGate({ introText, onAuthenticated, onLocalOnly }: IntroGateProps) {
  return (
    <div className={settingsStyles.page}>
      <section className={settingsStyles.section}>
        <LegalText text={introText?.trim() ? introText : DEFAULT_INTRO_TEXT} />
      </section>

      <div className={styles.choices}>
        <section className={styles.choice} aria-labelledby="intro-account">
          <h2 id="intro-account" className={settingsStyles.sectionTitle}>Anmelden oder Konto erstellen</h2>
          {/* '' = this page's own origin, which on a public instance is the server itself. */}
          <ServerAuthForm serverUrl="" onAuthenticated={onAuthenticated} />
        </section>

        <section className={styles.choice} aria-labelledby="intro-local">
          <h2 id="intro-local" className={settingsStyles.sectionTitle}>Ohne Konto ausprobieren</h2>
          <p className={settingsStyles.fieldHelpText}>Deine Sammlung liegt dann nur in diesem Browser. Das heißt:</p>
          <ul className={styles.caveats}>
            <li>Sie ist weg, wenn du die Website-Daten löschst oder in einem privaten Fenster arbeitest.</li>
            <li>Andere Geräte und die Android-App sehen sie nicht.</li>
            <li>Fotos lassen sich ohne Konto nicht hochladen.</li>
            <li>Geht etwas verloren, kann niemand es wiederherstellen.</li>
          </ul>
          <p className={settingsStyles.fieldHelpText}>
            Ein Konto kannst du jederzeit nachträglich anlegen und die Sammlung dabei mitnehmen.
          </p>
          <button type="button" className={settingsStyles.syncBtn} onClick={onLocalOnly}>
            Ohne Konto weiter
          </button>
        </section>
      </div>

    </div>
  );
}
