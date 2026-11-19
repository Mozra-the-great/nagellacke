import { CODE_LABEL } from '../utils/reauth';
import styles from '../pages/SettingsPage.module.css';

/**
 * The second re-auth field next to a password prompt (#479): shown only when the account has 2FA
 * on. The same field style and attributes as the code field of the 2FA setup; it adds no new look.
 */
export default function TotpCodeField({ visible, value, onChange, onEnter }: {
  visible: boolean;
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
}) {
  if (!visible) return null;
  return (
    <label className={styles.field}>
      <span>{CODE_LABEL}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="text"
        placeholder="123456"
        autoComplete="one-time-code"
        onKeyDown={onEnter ? (e) => { if (e.key === 'Enter') onEnter(); } : undefined}
      />
    </label>
  );
}
