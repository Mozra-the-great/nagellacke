import { useState, useRef, useEffect } from 'react';
import styles from './ColorFromPhoto.module.css';

interface Props {
  onColorPicked: (hex: string) => void;
  onClose: () => void;
}

export default function ColorFromPhoto({ onColorPicked, onClose }: Props) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [pickedColor, setPickedColor] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => { if (imgUrl) URL.revokeObjectURL(imgUrl); };
  }, [imgUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    setImgUrl(URL.createObjectURL(file));
    setPickedColor(null);
  };

  useEffect(() => {
    if (!imgUrl || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      const MAX = 1200;
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = imgUrl;
  }, [imgUrl]);

  const pickColor = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((clientX - rect.left) * scaleX);
    const y = Math.round((clientY - rect.top) * scaleY);
    const [r, g, b] = ctx.getImageData(
      Math.max(0, Math.min(x, canvas.width - 1)),
      Math.max(0, Math.min(y, canvas.height - 1)),
      1, 1,
    ).data;
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    setPickedColor(hex);
  };

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className={styles.container} onClick={(e) => e.stopPropagation()}>
        <div className={styles.topBar}>
          <span className={styles.topTitle}>Farbe aus Foto</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Schließen">✕</button>
        </div>

        {!imgUrl ? (
          <div className={styles.selectArea} onClick={() => fileInputRef.current?.click()}>
            <span className={styles.selectIcon}>📷</span>
            <span className={styles.selectText}>Foto auswählen oder Kamera öffnen</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pickColor(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (e.buttons > 0) pickColor(e.clientX, e.clientY);
            }}
          />
        )}

        <div className={styles.pickerBar}>
          {pickedColor ? (
            <>
              <div className={styles.colorPreview} style={{ background: pickedColor }} />
              <span className={styles.colorHex}>{pickedColor}</span>
              <button
                className={styles.applyBtn}
                onClick={() => onColorPicked(pickedColor)}
              >
                Übernehmen
              </button>
            </>
          ) : (
            <span className={styles.hint}>
              {imgUrl ? 'Auf eine Farbe im Foto tippen' : 'Foto auswählen um eine Farbe zu picken'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
