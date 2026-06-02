import { useState, useRef, useEffect } from "react";
import { STICKER_TYPE_OPTIONS, STICKER_STYLE_SUGGESTIONS, EMPTY_STICKER } from "../constants.js";

const TRANSPARENT_BG =
  "linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%) 0 0/8px 8px," +
  "linear-gradient(45deg,#ccc 25%,white 25%,white 75%,#ccc 75%) 4px 4px/8px 8px";
const MULTICOLOR_BG =
  "linear-gradient(135deg,#ff6b6b 0%,#ffd93d 20%,#6bcb77 40%,#4d96ff 60%,#c77dff 80%,#ff6b6b 100%)";

function PhotoPicker({ t, onFile, uploading, hasPhoto, onRemove }) {
  const [open, setOpen]  = useState(false);
  const camRef           = useRef(null);
  const galRef           = useRef(null);

  const pick = (ref) => { ref.current?.click(); setOpen(false); };

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (!e.target.closest("[data-photo-picker]")) setOpen(false); };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open]);

  const handle = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    onFile(file);
  };

  const triggerStyle = {
    background: "transparent", border: `1px solid ${t.inputBorder}`, color: t.textVeryMuted,
    borderRadius: t.filterRadius, padding: "3px 10px", cursor: uploading ? "default" : "pointer",
    fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase",
    opacity: uploading ? 0.6 : 1,
  };
  const menuStyle = {
    /* UX-4: right:0 prevents overflow on right edge of screen */
    position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 100,
    background: t.dark ? "rgba(18,12,30,0.97)" : t.cardBg,
    border: `1px solid ${t.cardBorder}`, borderRadius: t.cardRadius,
    minWidth: "150px", boxShadow: "0 4px 20px rgba(0,0,0,0.35)", overflow: "hidden",
  };
  const itemStyle = (danger) => ({
    display: "block", width: "100%", textAlign: "left",
    padding: "10px 14px", border: "none", background: "transparent",
    color: danger ? "rgba(255,120,120,0.85)" : t.textMuted,
    cursor: "pointer", fontFamily: t.fontBody, fontSize: "12px", letterSpacing: "1px",
    borderTop: danger ? `1px solid ${t.cardBorder}` : "none",
  });

  return (
    <div data-photo-picker style={{ position: "relative", display: "inline-block" }}>
      <button type="button" disabled={uploading} onClick={() => !uploading && setOpen(v => !v)}
        style={triggerStyle}>
        {uploading ? "⟳ Hochladen…" : hasPhoto ? "📷 Foto ändern" : "📷 Foto"}
      </button>
      {open && (
        <div style={menuStyle}>
          <button type="button" style={itemStyle(false)} onClick={() => pick(camRef)}>📷 Kamera</button>
          <button type="button" style={{ ...itemStyle(false), borderTop: `1px solid ${t.cardBorder}` }} onClick={() => pick(galRef)}>🖼 Galerie</button>
          {hasPhoto && onRemove && (
            <button type="button" style={itemStyle(true)} onClick={() => { setOpen(false); onRemove(); }}>✕ Entfernen</button>
          )}
        </div>
      )}
      <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={handle} style={{ position: "absolute", width: "0.1px", height: "0.1px", opacity: 0, overflow: "hidden", top: 0, left: 0 }} />
      <input ref={galRef} type="file" accept="image/*"                       onChange={handle} style={{ position: "absolute", width: "0.1px", height: "0.1px", opacity: 0, overflow: "hidden", top: 0, left: 0 }} />
    </div>
  );
}

function ColorEditor({ t, colors, onAdd, onAddTransparent, onAddMulticolor, onRemove }) {
  const pickerRef = useRef(null);
  const btnStyle = (disabled) => ({
    background: "transparent", border: `1px solid ${t.inputBorder}`, color: t.textVeryMuted,
    borderRadius: t.filterRadius, padding: "3px 10px", cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase",
    opacity: disabled ? 0.4 : 1,
  });
  const colorDot = (c) => c === "transparent" ? TRANSPARENT_BG : c === "multicolor" ? MULTICOLOR_BG : c;
  return (
    <div>
      {colors.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", marginBottom: "8px" }}>
          {colors.map((c, i) => (
            <div key={i} style={{ position: "relative", display: "inline-flex" }}>
              <span style={{
                display: "inline-block", width: 26, height: 26, borderRadius: "50%",
                background: colorDot(c), border: `1px solid rgba(255,255,255,0.2)`,
              }} />
              <button type="button" onClick={() => onRemove(i)} aria-label="Farbe entfernen"
                style={{ position: "absolute", top: -5, right: -5, width: 14, height: 14,
                         background: "rgba(0,0,0,0.6)", border: "none", color: "rgba(255,255,255,0.85)",
                         borderRadius: "50%", cursor: "pointer", fontSize: "9px", lineHeight: 1,
                         display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" disabled={colors.length >= 10} onClick={() => pickerRef.current?.click()}
          style={btnStyle(colors.length >= 10)}>
          + Farbe
        </button>
        <button type="button"
          disabled={colors.length >= 10 || colors.includes("transparent")}
          onClick={onAddTransparent}
          style={btnStyle(colors.length >= 10 || colors.includes("transparent"))}>
          ◌ Transparent
        </button>
        <button type="button"
          disabled={colors.length >= 10 || colors.includes("multicolor")}
          onClick={onAddMulticolor}
          style={btnStyle(colors.length >= 10 || colors.includes("multicolor"))}>
          ◑ Mehrfarbig
        </button>
        <input ref={pickerRef} type="color" defaultValue="#ff6699"
          onChange={e => onAdd(e.target.value)}
          style={{ width: 0, height: 0, opacity: 0, position: "absolute", pointerEvents: "none" }} />
      </div>
    </div>
  );
}

function StickerFormFields({ t, f, setF, allBrands, apiKey, photoUploading, uploadError, onPhotoFile, onSubmit, submitLabel, onCancel }) {
  const statusOpts = [
    { value: "ok",    label: "✓ Vorhanden",   color: "rgba(150,255,180,0.7)" },
    { value: "wish",  label: "☆ Wunschliste", color: "rgba(180,160,255,0.7)" },
    { value: "empty", label: "○ Leer",         color: "rgba(255,200,80,0.7)"  },
  ];
  return (
    <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: t.cardRadius, padding: "22px 24px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
        <div>
          <label className="form-label">Name *</label>
          <input className="form-input" placeholder="z.B. Cherry Blossoms" value={f.name}
            onChange={e => setF(frm => ({ ...frm, name: e.target.value }))} />
        </div>
        <div>
          <label className="form-label">Marke</label>
          <input className="form-input" list="sticker-brand-list" placeholder="z.B. Born Pretty"
            value={f.brand} onChange={e => setF(frm => ({ ...frm, brand: e.target.value }))} />
          <datalist id="sticker-brand-list">
            {allBrands.map(b => <option key={b} value={b} />)}
          </datalist>
        </div>
      </div>

      <div style={{ marginBottom: "12px" }}>
        <label className="form-label">Stil</label>
        <input className="form-input" list="sticker-style-list" placeholder="z.B. Blumen, Marble…"
          value={f.style} onChange={e => setF(frm => ({ ...frm, style: e.target.value }))} />
        <datalist id="sticker-style-list">
          {STICKER_STYLE_SUGGESTIONS.map(s => <option key={s} value={s} />)}
        </datalist>
      </div>

      <div style={{ marginBottom: "12px" }}>
        <label className="form-label">Typ</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {STICKER_TYPE_OPTIONS.map(opt => (
            <button type="button" key={opt.value} className={`cat-chip ${f.type === opt.value ? "on" : ""}`}
              onClick={() => setF(frm => ({ ...frm, type: opt.value }))}>
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: "12px" }}>
        <label className="form-label">Farben</label>
        <ColorEditor t={t} colors={f.colors}
          onAdd={hex => setF(frm => frm.colors.length >= 10 ? frm : { ...frm, colors: [...frm.colors, hex] })}
          onAddTransparent={() => setF(frm =>
            frm.colors.length >= 10 || frm.colors.includes("transparent") ? frm
            : { ...frm, colors: [...frm.colors, "transparent"] }
          )}
          onAddMulticolor={() => setF(frm =>
            frm.colors.length >= 10 || frm.colors.includes("multicolor") ? frm
            : { ...frm, colors: [...frm.colors, "multicolor"] }
          )}
          onRemove={i => setF(frm => ({ ...frm, colors: frm.colors.filter((_, ci) => ci !== i) }))}
        />
      </div>

      <div style={{ marginBottom: "12px" }}>
        <label className="form-label">Status</label>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {statusOpts.map(s => (
            <button type="button" key={s.value} className={`cat-chip ${f.status === s.value ? "on" : ""}`}
              style={f.status === s.value ? { borderColor: s.color, color: s.color, background: t.inputBg } : {}}
              onClick={() => setF(frm => ({ ...frm, status: s.value }))}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: "12px" }}>
        <div className="form-label">Bewertung</div>
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          {[1,2,3,4,5].map(n => (
            <button key={n} type="button"
              aria-label={`${n} Stern${n > 1 ? "e" : ""}`}
              aria-pressed={(f.rating || 0) === n}
              onClick={() => setF(frm => ({ ...frm, rating: (frm.rating || 0) === n ? 0 : n }))}
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "20px",
                       color: (f.rating || 0) >= n ? t.accentText : t.textFaint,
                       padding: "2px", lineHeight: 1, transition: "color 0.15s" }}>★</button>
          ))}
          {(f.rating || 0) > 0 && (
            <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.textVeryMuted, marginLeft: "6px" }}>
              {f.rating}/5
            </span>
          )}
        </div>
      </div>

      <div style={{ marginBottom: "14px" }}>
        <label className="form-label">Foto</label>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {/* A11Y-4: Descriptive alt text using sticker name */}
          {f.photo && (
            <img src={`/photos/${f.photo}`} alt={`Foto von ${f.name || "Sticker"}`}
              style={{ width: 72, height: 54, objectFit: "cover", borderRadius: "8px", border: `1px solid ${t.cardBorder}` }} />
          )}
          <PhotoPicker t={t} uploading={photoUploading} hasPhoto={!!f.photo}
            onFile={onPhotoFile}
            onRemove={f.photo ? () => setF(frm => ({ ...frm, photo: null })) : undefined} />
        </div>
        {uploadError && (
          <div style={{ fontFamily: t.fontBody, fontSize: "11px", color: "rgba(255,120,120,0.85)", marginTop: "6px" }}>
            ✕ {uploadError}
          </div>
        )}
      </div>

      <div style={{ marginBottom: "18px" }}>
        <label className="form-label">Notizen</label>
        <textarea className="form-input" placeholder="Herkunft, Haltbarkeit, Gedanken…"
          value={f.notes} onChange={e => setF(frm => ({ ...frm, notes: e.target.value }))}
          style={{ resize: "vertical", minHeight: "58px", lineHeight: "1.5" }} />
      </div>

      {!apiKey && (
        <div style={{ fontFamily: t.fontBody, fontSize: "11px", color: "rgba(255,180,80,0.9)",
                      marginBottom: "10px", letterSpacing: "1px" }}>
          ⚠ Kein API-Schlüssel — Änderungen werden nicht gespeichert. Unter ⚙ eintragen.
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <button type="button" className="add-btn" onClick={onSubmit} disabled={!f.name.trim()}>{submitLabel}</button>
        {onCancel && <button type="button" className="add-trigger" onClick={onCancel}>Abbrechen</button>}
      </div>
    </div>
  );
}

export function StickerPage({ t, stickers, onAdd, onSave, onDelete, apiKey }) {
  const [showForm, setShowForm]               = useState(false);
  const [form, setForm]                       = useState({ ...EMPTY_STICKER });
  const [editIdx, setEditIdx]                 = useState(null);
  const [editForm, setEditForm]               = useState(null);
  const [search, setSearch]                   = useState("");
  const [filterType, setFilterType]           = useState("all");
  const [photoUploading, setPhotoUploading]   = useState(false);
  const [editPhotoUploading, setEditPhotoUploading] = useState(false);
  const [uploadError, setUploadError]         = useState(null);
  const [editUploadError, setEditUploadError] = useState(null);
  const [photoMode, setPhotoMode]             = useState({});

  const allBrands = [...new Set(stickers.map(s => s.brand).filter(Boolean))].sort();
  const usedTypes = [...new Set(stickers.map(s => s.type).filter(Boolean))];

  const filtered = stickers.filter(s => {
    if (filterType !== "all" && s.type !== filterType) return false;
    const q = search.toLowerCase();
    return !q ||
      s.name.toLowerCase().includes(q) ||
      (s.brand || "").toLowerCase().includes(q) ||
      (s.style || "").toLowerCase().includes(q);
  });

  const makePhotoUploader = (setF, setUploading, setError) => (file) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxW = 600, maxH = 450;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
        setUploading(true);
        fetch("/api/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Api-Key": apiKey || "" },
          body: JSON.stringify({ data: base64, ext: "jpg" }),
        })
          .then(r => r.json())
          .then(d => {
            if (d.filename) setF(frm => ({ ...frm, photo: d.filename }));
            else setError("Foto-Upload fehlgeschlagen" + (d.error ? `: ${d.error}` : ""));
          })
          .catch(() => setError("Foto-Upload fehlgeschlagen — Verbindungsfehler"))
          .finally(() => setUploading(false));
      };
      img.onerror = () => setError("Bild konnte nicht gelesen werden");
      img.src = ev.target.result;
    };
    reader.onerror = () => setError("Datei konnte nicht gelesen werden");
    reader.readAsDataURL(file);
  };

  const handleAddSubmit = () => {
    if (!form.name.trim()) return;
    onAdd({ ...form, name: form.name.trim() });
    setForm({ ...EMPTY_STICKER });
    setUploadError(null);
    setShowForm(false);
  };

  const openEdit = (idx) => {
    setEditIdx(idx);
    setEditForm({ ...stickers[idx] });
    setEditUploadError(null);
    setShowForm(false);
  };
  const cancelEdit = () => { setEditIdx(null); setEditForm(null); setEditUploadError(null); };
  const handleSaveEdit = () => {
    if (!editForm.name.trim()) return;
    onSave(editIdx, { ...editForm, name: editForm.name.trim() });
    setEditIdx(null);
    setEditForm(null);
    setEditUploadError(null);
  };

  const btnBase = {
    background: "transparent", border: `1px solid ${t.filterBorder}`, color: t.textVeryMuted,
    padding: "5px 16px", borderRadius: t.filterRadius, cursor: "pointer",
    fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase",
    transition: "all 0.2s",
  };

  return (
    <div style={{ maxWidth: "820px", margin: "0 auto", padding: "32px 18px 60px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <span style={{ fontFamily: t.fontBody, fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: t.textVeryMuted }}>
          {stickers.length} Sticker
        </span>
        <button type="button" style={{ ...btnBase, borderColor: t.filterBorderActive, color: t.filterColorActive }}
          onClick={() => { setShowForm(v => !v); if (!showForm) { cancelEdit(); } }}>
          {showForm ? "✕ Abbrechen" : "+ Neuer Sticker"}
        </button>
      </div>

      {showForm && (
        <div style={{ marginBottom: "24px" }}>
          <StickerFormFields
            t={t} f={form} setF={setForm} allBrands={allBrands} apiKey={apiKey}
            photoUploading={photoUploading} uploadError={uploadError}
            onPhotoFile={makePhotoUploader(setForm, setPhotoUploading, setUploadError)}
            onSubmit={handleAddSubmit} submitLabel="Sticker speichern"
            onCancel={() => { setShowForm(false); setUploadError(null); }}
          />
        </div>
      )}

      {stickers.length > 0 && (
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "18px", alignItems: "center" }}>
          <button type="button" className={`filter-btn ${filterType === "all" ? "active" : ""}`}
            onClick={() => setFilterType("all")}>Alle</button>
          {STICKER_TYPE_OPTIONS.filter(opt => usedTypes.includes(opt.value)).map(opt => (
            <button type="button" key={opt.value} className={`filter-btn ${filterType === opt.value ? "active" : ""}`}
              onClick={() => setFilterType(opt.value)}>
              {opt.icon} {opt.label}
            </button>
          ))}
          <input className="form-input" placeholder="Suche…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ marginLeft: "auto", maxWidth: "180px", padding: "5px 12px", fontSize: "12px" }} />
        </div>
      )}

      {stickers.length === 0 && !showForm && (
        <div style={{ textAlign: "center", padding: "60px 0", fontFamily: t.fontBody,
                      fontSize: "12px", color: t.textVeryMuted, letterSpacing: "1px" }}>
          Noch keine Sticker. Starte mit „+ Neuer Sticker".
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {filtered.map(s => {
          const realIdx  = stickers.indexOf(s);
          const isEditing = editIdx === realIdx;
          const typeOpt  = STICKER_TYPE_OPTIONS.find(o => o.value === s.type);
          const showPhoto = (photoMode[realIdx] !== false) && s.photo;

          return (
            <div key={realIdx} style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`,
                                        borderRadius: t.cardRadius, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", cursor: "pointer" }}
                onClick={() => isEditing ? cancelEdit() : openEdit(realIdx)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "8px", flexWrap: "wrap" }}>
                    {(s.colors || []).map((c, ci) => (
                      <span key={ci} style={{
                        display: "inline-block", width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                        background: c === "transparent" ? TRANSPARENT_BG : c === "multicolor" ? MULTICOLOR_BG : c,
                        border: `1px solid ${t.cardBorder}`,
                      }} />
                    ))}
                    {s.photo && (
                      <button type="button"
                        onClick={e => { e.stopPropagation(); setPhotoMode(m => ({ ...m, [realIdx]: photoMode[realIdx] === false ? undefined : false })); }}
                        title={showPhoto ? "Foto ausblenden" : "Foto zeigen"}
                        style={{ background: "transparent", border: `1px solid ${t.inputBorder}`,
                                 color: t.textVeryMuted, borderRadius: "6px", padding: "1px 7px",
                                 cursor: "pointer", fontSize: "12px", lineHeight: 1.4, marginLeft: "4px" }}>
                        {showPhoto ? "◼" : "📷"}
                      </button>
                    )}
                  </div>
                  {showPhoto && (
                    <div style={{ marginBottom: "10px" }}>
                      {/* A11Y-4: Use sticker name as alt text */}
                    <img src={`/photos/${s.photo}`} alt={s.name}
                        style={{ maxWidth: "100%", maxHeight: "220px", objectFit: "contain",
                                 borderRadius: "8px", border: `1px solid ${t.cardBorder}` }} />
                    </div>
                  )}
                  <div style={{ fontFamily: t.fontDisplay, fontSize: "18px", color: t.text, marginBottom: "3px" }}>
                    {s.name}
                  </div>
                  {(s.brand || s.style) && (
                    <div style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.textVeryMuted, marginBottom: "6px" }}>
                      {[s.brand, s.style].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {typeOpt && (
                      <span style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "1.5px",
                                     textTransform: "uppercase", color: t.textVeryMuted }}>
                        {typeOpt.icon} {typeOpt.label}
                      </span>
                    )}
                    {s.rating > 0 && (
                      <span style={{ color: t.accentText, fontSize: "12px" }}>{"★".repeat(s.rating)}</span>
                    )}
                  </div>
                </div>
                <button type="button" onClick={e => { e.stopPropagation(); onDelete(realIdx); }}
                  aria-label="Sticker löschen"
                  style={{ background: "transparent", border: "none", color: t.textVeryMuted,
                           cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: "2px", flexShrink: 0,
                           transition: "color 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.color = "rgba(255,120,120,0.9)"}
                  onMouseLeave={e => e.currentTarget.style.color = t.textVeryMuted}>×</button>
              </div>

              {isEditing && editForm && (
                <div style={{ borderTop: `1px solid ${t.cardBorder}`, padding: "16px" }}>
                  <StickerFormFields
                    t={t} f={editForm} setF={setEditForm} allBrands={allBrands} apiKey={apiKey}
                    photoUploading={editPhotoUploading} uploadError={editUploadError}
                    onPhotoFile={makePhotoUploader(setEditForm, setEditPhotoUploading, setEditUploadError)}
                    onSubmit={handleSaveEdit} submitLabel="Speichern"
                    onCancel={cancelEdit}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
