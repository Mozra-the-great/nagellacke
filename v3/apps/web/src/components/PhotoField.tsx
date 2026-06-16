import { useRef, useState } from 'react';
import { uploadPhoto } from '../utils/photos';
import styles from './PhotoField.module.css';

export default function PhotoField({
  value,
  onChange,
  label = 'Foto',
}: {
  value?: string;
  onChange: (filename: string | undefined) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    setError(null);
    try {
      const filename = await uploadPhoto(file);
      onChange(filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={styles.wrap}>
      {value && (
        <img src={`/photos/${value}`} alt={label} className={styles.preview} />
      )}
      <div className={styles.row}>
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className={styles.btn}
        >
          {uploading ? '⟳ Lädt…' : value ? '📷 Ändern' : '📷 Foto hinzufügen'}
        </button>
        {value && (
          <button type="button" className={styles.removeBtn} onClick={() => onChange(undefined)}>
            × Entfernen
          </button>
        )}
      </div>
      {error && <div className={styles.error}>{error}</div>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        style={{ display: 'none' }}
      />
    </div>
  );
}
