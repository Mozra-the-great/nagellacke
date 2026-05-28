import { useState, useEffect, useRef, useMemo } from "react";
import { NailBottle } from "./NailBottle.jsx";
import { FINISH_OPTIONS, STATUS_OPTIONS, BRAND_SUGGESTIONS } from "../constants.js";

export function PolishForm({ t, form, setForm, customCats, allBrands, allColors, onSubmit, submitLabel, onCancel, onAddCategory, onDeleteCategory, success, apiKey }) {
  const [newCatName, setNewCatName]     = useState("");
  const [showNewCat, setShowNewCat]     = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoPickerRef    = useRef(null);
  const photoCanvasRef    = useRef(null);
  const bottlePhotoRef    = useRef(null);

  const toggleCat = (catId) => setForm(f => ({
    ...f,
    categories: f.categories.includes(catId) ? f.categories.filter(c => c !== catId) : [...f.categories, catId],
  }));

  const commitNewCat = () => {
    if (!newCatName.trim()) return;
    onAddCategory && onAddCategory(newCatName.trim());
    setNewCatName("");
    setShowNewCat(false);
  };

  useEffect(() => {
    if (!photoPreview || !photoCanvasRef.current) return;
    const img = new Image();
    img.onload = () => {
      const canvas = photoCanvasRef.current;
      if (!canvas) return;
      const maxW = 280, maxH = 210;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = photoPreview;
  }, [photoPreview]);

  const handlePhotoSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleCanvasClick = (e) => {
    const canvas = photoCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (canvas.width  / rect.width));
    const y = Math.floor((e.clientY - rect.top)  * (canvas.height / rect.height));
    const [r, g, b] = canvas.getContext("2d").getImageData(x, y, 1, 1).data;
    const hex = "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
    setForm(f => ({ ...f, color: hex }));
    setPhotoPreview(null);
  };

  const handleBottlePhotoSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxW = 300, maxH = 450;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
        setPhotoUploading(true);
        fetch("/api/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Api-Key": apiKey || "" },
          body: JSON.stringify({ data: base64, ext: "jpg" }),
        })
          .then(r => r.json())
          .then(d => { if (d.filename) setForm(f => ({ ...f, photo: d.filename })); })
          .catch(() => {})
          .finally(() => setPhotoUploading(false));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const swatchColors = useMemo(() => (allColors || []).filter(c => c !== form.color).slice(0, 24), [allColors, form.color]);

  return (
    <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: t.cardRadius, padding: "26px 26px 22px" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
        <div style={{ textAlign: "center" }}>
          <NailBottle color={form.color} finish={form.finish} selected={false} status={form.status} brand={form.brand} />
          {form.name && (
            <div style={{ fontFamily: t.fontDisplay, fontSize: "13px", color: t.textMuted, marginTop: "8px", maxWidth: "100px" }}>
              {form.brand && <div style={{ fontFamily: t.fontBody, fontSize: "9px", letterSpacing: "2px", color: t.textFaint, textTransform: "uppercase" }}>{form.brand}</div>}
              {form.num && <div style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", color: t.textVeryMuted }}>{form.num}</div>}
              {form.name}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr", gap: "12px", marginBottom: "12px" }}>
        <div>
          <label htmlFor="polish-name" className="form-label">Name *</label>
          <input id="polish-name" className="form-input" placeholder="z.B. Blue You A Kiss" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="polish-brand" className="form-label">Marke *</label>
          <input id="polish-brand" className="form-input" list="brand-suggestions" placeholder="z.B. Catrice, OPI…"
            value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} />
          <datalist id="brand-suggestions">
            {[...new Set([...(allBrands || []), ...BRAND_SUGGESTIONS])].sort().map(b => <option key={b} value={b} />)}
          </datalist>
        </div>
        <div>
          <label htmlFor="polish-num" className="form-label">Nummer</label>
          <input id="polish-num" className="form-input" placeholder="z.B. 029" value={form.num} onChange={e => setForm(f => ({ ...f, num: e.target.value }))} />
        </div>
      </div>
      <div style={{ marginBottom: "12px" }}>
        <label className="form-label">Finish / Effekt</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {FINISH_OPTIONS.map(f => (
            <button key={f.value} className={`cat-chip ${form.finish === f.value ? "on" : ""}`}
              onClick={() => setForm(frm => ({ ...frm, finish: f.value }))}>
              {f.icon} {f.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: "12px", marginBottom: "12px" }}>
        <div>
          <label className="form-label">Farbe</label>
          <div style={{ display: "flex", alignItems: "center", gap: "9px", background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: t.inputRadius, padding: "8px 12px", height: "42px" }}>
            <div style={{ width: 22, height: 22, borderRadius: "5px", background: form.color, boxShadow: `0 0 8px ${form.color}88`, flexShrink: 0 }} />
            <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={{ width: "100%", height: "22px" }} />
            <button type="button" title="Foto aufnehmen oder aus Galerie wählen" onClick={() => photoPickerRef.current?.click()}
              style={{ background: "transparent", border: `1px solid ${t.inputBorder}`, borderRadius: "7px", padding: "3px 7px", cursor: "pointer", fontSize: "14px", lineHeight: 1, transition: "border-color 0.15s", flexShrink: 0 }}
              onMouseEnter={e => e.currentTarget.style.borderColor = t.inputBorderFocus}
              onMouseLeave={e => e.currentTarget.style.borderColor = t.inputBorder}>
              📷
            </button>
          </div>
          <input ref={photoPickerRef} type="file" accept="image/*" onChange={handlePhotoSelect} style={{ display: "none" }} />
          {photoPreview && (
            <div style={{ marginTop: "10px", position: "relative", display: "inline-block" }}>
              <div style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", color: t.textVeryMuted, textTransform: "uppercase", marginBottom: "6px" }}>
                Auf die gewünschte Farbe tippen
              </div>
              <canvas ref={photoCanvasRef} onClick={handleCanvasClick}
                style={{ display: "block", cursor: "crosshair", borderRadius: t.inputRadius, border: `1px solid ${t.cardBorder}`, maxWidth: "100%" }} />
              <button aria-label="Foto schließen" onClick={() => setPhotoPreview(null)}
                style={{ position: "absolute", top: "26px", right: "6px", background: "rgba(0,0,0,0.55)", border: "none", color: "rgba(255,255,255,0.7)", borderRadius: "50%", width: "22px", height: "22px", cursor: "pointer", fontSize: "12px", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                ✕
              </button>
            </div>
          )}
          {swatchColors.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "8px" }}>
              {swatchColors.map(c => (
                <button key={c} title={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                  style={{ width: 18, height: 18, borderRadius: "50%", background: c, border: `1px solid ${t.inputBorder}`, cursor: "pointer", padding: 0, transition: "transform 0.15s", flexShrink: 0 }}
                  onMouseEnter={e => e.currentTarget.style.transform = "scale(1.3)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"} />
              ))}
            </div>
          )}
        </div>
        <div>
          <label htmlFor="polish-count" className="form-label">Anzahl</label>
          <input id="polish-count" className="form-input" type="number" min="1" max="99" value={form.count}
            onChange={e => setForm(f => ({ ...f, count: Math.max(1, parseInt(e.target.value) || 1) }))} style={{ textAlign: "center" }} />
        </div>
      </div>
      <div style={{ marginBottom: "14px" }}>
        <label className="form-label">Flaschenfoto</label>
        {form.photo ? (
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <img src={`/photos/${form.photo}`} alt="Flaschenfoto"
              style={{ width: 48, height: 72, objectFit: "cover", borderRadius: "8px", border: `1px solid ${t.cardBorder}` }} />
            <button type="button" onClick={() => setForm(f => ({ ...f, photo: null }))}
              style={{ background: "transparent", border: `1px solid ${t.inputBorder}`, color: t.textVeryMuted,
                       borderRadius: t.filterRadius, padding: "3px 10px", cursor: "pointer",
                       fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase" }}>
              ✕ Entfernen
            </button>
          </div>
        ) : (
          <button type="button" disabled={photoUploading} onClick={() => bottlePhotoRef.current?.click()}
            style={{ background: "transparent", border: `1px solid ${t.inputBorder}`, color: t.textVeryMuted,
                     borderRadius: t.filterRadius, padding: "5px 14px", cursor: "pointer",
                     fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase" }}>
            {photoUploading ? "⟳ Wird hochgeladen…" : "📷 Foto hinzufügen"}
          </button>
        )}
        <input ref={bottlePhotoRef} type="file" accept="image/*" onChange={handleBottlePhotoSelect} style={{ display: "none" }} />
      </div>
      <div style={{ marginBottom: "14px" }}>
        <label className="form-label">Status</label>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {STATUS_OPTIONS.map(s => (
            <button key={s.value} className={`cat-chip ${form.status === s.value ? "on" : ""}`}
              style={form.status === s.value ? { borderColor: s.color, color: s.color, background: t.inputBg } : {}}
              onClick={() => setForm(f => ({ ...f, status: s.value }))}>{s.label}</button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: "14px" }}>
        <div className="form-label" id="rating-label">Bewertung</div>
        <div role="group" aria-labelledby="rating-label" style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          {[1,2,3,4,5].map(n => (
            <button key={n} type="button"
              aria-label={`${n} Stern${n > 1 ? "e" : ""}`}
              aria-pressed={(form.rating || 0) === n}
              onClick={() => setForm(f => ({ ...f, rating: (f.rating || 0) === n ? 0 : n }))}
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "20px",
                       color: (form.rating || 0) >= n ? t.accentText : t.textFaint,
                       padding: "2px", lineHeight: 1, transition: "color 0.15s" }}>★</button>
          ))}
          {(form.rating || 0) > 0 && (
            <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.textVeryMuted, marginLeft: "6px" }}>
              {form.rating}/5
            </span>
          )}
        </div>
      </div>
      <div style={{ marginBottom: "14px" }}>
        <label className="form-label">Kategorien</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "8px" }}>
          {customCats.map(c => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "2px" }}>
              <button className={`cat-chip ${form.categories.includes(c.id) ? "on" : ""}`} onClick={() => toggleCat(c.id)}>◆ {c.label}</button>
              {onDeleteCategory && (
                <button onClick={() => onDeleteCategory(c.id)}
                  title={`Kategorie „${c.label}" löschen`}
                  style={{ background: "transparent", border: "none", color: "rgba(255,100,100,0.4)", cursor: "pointer", fontSize: "11px", padding: "2px 4px", lineHeight: 1, borderRadius: "6px", transition: "color 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.color = "rgba(255,120,120,0.9)"}
                  onMouseLeave={e => e.currentTarget.style.color = "rgba(255,100,100,0.4)"}>×</button>
              )}
            </div>
          ))}
          {customCats.length === 0 && !showNewCat && <span style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.textVeryMuted, alignSelf: "center" }}>Noch keine eigenen Kategorien</span>}
        </div>
        {showNewCat ? (
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <input className="form-input" placeholder="Kategorie-Name" value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && commitNewCat()}
              autoFocus style={{ width: "160px", padding: "5px 12px", fontSize: "12px", borderRadius: "20px" }} />
            <button className="add-trigger open" style={{ borderStyle: "solid" }} onClick={commitNewCat}>✓</button>
            <button className="add-trigger" onClick={() => { setShowNewCat(false); setNewCatName(""); }}>✕</button>
          </div>
        ) : (
          <button className="add-trigger" style={{ fontSize: "10px", padding: "4px 11px" }} onClick={() => setShowNewCat(true)}>+ Neue Kategorie</button>
        )}
      </div>
      <div style={{ marginBottom: "18px" }}>
        <label htmlFor="polish-notes" className="form-label">Notizen</label>
        <textarea id="polish-notes" className="form-input" placeholder="Kaufdatum, Bewertung, Besonderheiten…" value={form.notes || ""}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          style={{ resize: "vertical", minHeight: "58px", lineHeight: "1.5" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <button className="add-btn" onClick={onSubmit} disabled={!form.name.trim()}>{submitLabel}</button>
        {onCancel && <button className="add-trigger" onClick={onCancel}>Abbrechen</button>}
        {success && <span className="success-msg">✓ Gespeichert!</span>}
      </div>
    </div>
  );
}
