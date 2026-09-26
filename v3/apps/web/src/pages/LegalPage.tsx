import LegalText, { LINK_STYLE } from '../components/LegalText';
import type { LegalPage as LegalPageData } from '../utils/legal';
import styles from './SettingsPage.module.css';

/** #/impressum and #/datenschutz: shareable, and reachable without an account. */
export default function LegalPage({ page, onBack }: { page: LegalPageData | null; onBack: () => void }) {
  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <p><a href="#" style={LINK_STYLE} onClick={(e) => { e.preventDefault(); onBack(); }}>← Zurück zur App</a></p>
        {page ? (
          <>
            <h2 className={styles.sectionTitle}>{page.title}</h2>
            <LegalText text={page.body} />
            <p className={styles.fieldHelpText}>
              Stand: {new Date(page.updatedAt).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}
            </p>
          </>
        ) : (
          <p className={styles.fieldHelpText}>Diese Seite ist auf diesem Server nicht hinterlegt.</p>
        )}
      </section>
    </div>
  );
}
