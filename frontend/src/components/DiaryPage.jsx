import { useState, useRef, useEffect } from "react";

function PhotoPicker({ t, onFile, uploading, hasPhoto, onRemove, btnBase }) {
  const [open, setOpen] = useState(false);
  const camRef          = useRef(null);
  const galRef          = useRef(null);

  const pick = (ref) => { setOpen(false); ref.current?.click(); };

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

  const menuStyle = {
    position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100,
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
    <div data-photo-picker style={{ position: "relative", display: "block" }}>
      <button type="button" disabled={uploading} onClick={() => !uploading && setOpen(v => !v)}
        style={{ ...btnBase, display: "block", width: "100%", textAlign: "center" }}>
        {uploading ? "⟳ Wird hochgeladen…" : "📷 Foto wählen"}
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
      <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={handle} style={{ display: "none" }} />
      <input ref={galRef} type="file" accept="image/*"                       onChange={handle} style={{ display: "none" }} />
    </div>
  );
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function DiaryPage({ t, manicures, polishes, stickers, onAdd, onDelete, apiKey }) {
  const [showForm, setShowForm]         = useState(false);
  const [form, setForm]                 = useState({ date: todayISO(), polishRefs: [], stickerRefs: [], notes: "", photo: null });
  const [search, setSearch]             = useState("");
  const [stickerSearch, setStickerSearch] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError]         = useState(null);
  const [expandedId, setExpandedId]     = useState(null);

  const filtered = (polishes || []).filter(p => {
    const q = search.toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || (p.brand || "").toLowerCase().includes(q);
  });

  const filteredStickers = (stickers || []).filter(s => {
    const q = stickerSearch.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || (s.brand || "").toLowerCase().includes(q) || (s.style || "").toLowerCase().includes(q);
  });

  const toggleSticker = (s) => {
    const already = form.stickerRefs.some(r => r.name === s.name && r.brand === s.brand);
    setForm(f => ({
      ...f,
      stickerRefs: already
        ? f.stickerRefs.filter(r => !(r.name === s.name && r.brand === s.brand))
        : [...f.stickerRefs, { name: s.name, brand: s.brand || "", colors: s.colors || [] }],
    }));
  };

  const togglePolish = (p) => {
    const already = form.polishRefs.some(r => r.name === p.name && r.brand === p.brand);
    setForm(f => ({
      ...f,
      polishRefs: already
        ? f.polishRefs.filter(r => !(r.name === p.name && r.brand === p.brand))
        : [...f.polishRefs, { name: p.name, brand: p.brand || "", color: p.color }],
    }));
  };

  const handlePhotoUpload = (file) => {
    setPhotoError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxW = 800, maxH = 600;
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
          .then(d => {
            if (d.filename) setForm(f => ({ ...f, photo: d.filename }));
            else setPhotoError("Foto-Upload fehlgeschlagen" + (d.error ? `: ${d.error}` : ""));
          })
          .catch(() => setPhotoError("Foto-Upload fehlgeschlagen — Verbindungsfehler"))
          .finally(() => setPhotoUploading(false));
      };
      img.onerror = () => setPhotoError("Bild konnte nicht gelesen werden");
      img.src = ev.target.result;
    };
    reader.onerror = () => setPhotoError("Datei konnte nicht gelesen werden");
    reader.readAsDataURL(file);
  };

  const handleSubmit = () => {
    if (!form.date) return;
    onAdd({ date: form.date, polishRefs: form.polishRefs, stickerRefs: form.stickerRefs, notes: form.notes, photo: form.photo });
    setForm({ date: todayISO(), polishRefs: [], stickerRefs: [], notes: "", photo: null });
    setSearch(""); setStickerSearch("");
    setShowForm(false);
  };

  const btnBase = {
    background: "transparent", border: `1px solid ${t.filterBorder}`, color: t.textVeryMuted,
    padding: "5px 16px", borderRadius: t.filterRadius, cursor: "pointer",
    fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase",
    transition: "all 0.2s",
  };

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "32px 18px 60px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <span style={{ fontFamily: t.fontBody, fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: t.textVeryMuted }}>
          {manicures.length} Einträge
        </span>
        <button style={{ ...btnBase, borderColor: t.filterBorderActive, color: t.filterColorActive }}
          onClick={() => setShowForm(v => !v)}>
          {showForm ? "✕ Abbrechen" : "+ Neuer Eintrag"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: t.cardRadius,
                      padding: "22px 24px", marginBottom: "24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
            <div>
              <label className="form-label">Datum</label>
              <input type="date" className="form-input" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Foto (optional)</label>
              {form.photo && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <img src={`/photos/${form.photo}`} alt=""
                    style={{ width: 52, height: 39, objectFit: "cover", borderRadius: "6px", border: `1px solid ${t.cardBorder}` }} />
                </div>
              )}
              <PhotoPicker t={t} btnBase={btnBase} uploading={photoUploading} hasPhoto={!!form.photo}
                onFile={handlePhotoUpload}
                onRemove={form.photo ? () => setForm(f => ({ ...f, photo: null })) : undefined} />
              {photoError && (
                <div style={{ fontFamily: t.fontBody, fontSize: "11px", color: "rgba(255,120,120,0.85)", marginTop: "4px" }}>
                  ✕ {photoError}
                </div>
              )}
            </div>
          </div>

          <div style={{ marginBottom: "14px" }}>
            <label className="form-label">Verwendete Lacke</label>
            {form.polishRefs.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                {form.polishRefs.map(r => (
                  <span key={r.name + r.brand} style={{ display: "inline-flex", alignItems: "center", gap: "5px",
                    background: t.filterBgActive, border: `1px solid ${t.filterBorderActive}`,
                    borderRadius: "20px", padding: "2px 10px 2px 6px",
                    fontFamily: t.fontBody, fontSize: "11px", color: t.filterColorActive }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: r.color, display: "inline-block", flexShrink: 0 }} />
                    {r.name}
                    <button onClick={() => togglePolish(r)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: t.textVeryMuted,
                               fontSize: "12px", lineHeight: 1, padding: "0 0 0 2px" }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <input className="form-input" placeholder="Lack suchen…" value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ marginBottom: "6px" }} />
            <div style={{ maxHeight: "180px", overflowY: "auto", border: `1px solid ${t.cardBorder}`,
                          borderRadius: t.inputRadius, background: t.inputBg }}>
              {filtered.length === 0 && (
                <div style={{ padding: "10px 14px", fontFamily: t.fontBody, fontSize: "11px", color: t.textVeryMuted }}>
                  Keine Lacke gefunden
                </div>
              )}
              {filtered.map((p, i) => {
                const sel = form.polishRefs.some(r => r.name === p.name && r.brand === p.brand);
                return (
                  <div key={i} onClick={() => togglePolish(p)}
                    style={{ display: "flex", alignItems: "center", gap: "10px", padding: "7px 14px",
                             cursor: "pointer", background: sel ? (t.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)") : "transparent",
                             borderBottom: i < filtered.length - 1 ? `1px solid ${t.textFaint}` : "none" }}>
                    <span style={{ width: 14, height: 14, borderRadius: "50%", background: p.color,
                                   border: `1px solid ${t.cardBorder}`, flexShrink: 0 }} />
                    <span style={{ fontFamily: t.fontBody, fontSize: "12px", color: t.text, flex: 1 }}>{p.name}</span>
                    {p.brand && <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.textVeryMuted }}>{p.brand}</span>}
                    {sel && <span style={{ color: t.filterColorActive, fontSize: "12px" }}>✓</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {(stickers || []).length > 0 && (
            <div style={{ marginBottom: "14px" }}>
              <label className="form-label">Verwendete Sticker</label>
              {form.stickerRefs.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                  {form.stickerRefs.map(r => (
                    <span key={r.name + r.brand} style={{ display: "inline-flex", alignItems: "center", gap: "5px",
                      background: t.filterBgActive, border: `1px solid ${t.filterBorderActive}`,
                      borderRadius: "20px", padding: "2px 10px 2px 6px",
                      fontFamily: t.fontBody, fontSize: "11px", color: t.filterColorActive }}>
                      {r.colors && r.colors[0] && r.colors[0] !== "transparent" && (
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: r.colors[0], display: "inline-block", flexShrink: 0 }} />
                      )}
                      {r.name}
                      <button onClick={() => toggleSticker(r)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: t.textVeryMuted,
                                 fontSize: "12px", lineHeight: 1, padding: "0 0 0 2px" }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <input className="form-input" placeholder="Sticker suchen…" value={stickerSearch}
                onChange={e => setStickerSearch(e.target.value)}
                style={{ marginBottom: "6px" }} />
              <div style={{ maxHeight: "160px", overflowY: "auto", border: `1px solid ${t.cardBorder}`,
                            borderRadius: t.inputRadius, background: t.inputBg }}>
                {filteredStickers.length === 0 && (
                  <div style={{ padding: "10px 14px", fontFamily: t.fontBody, fontSize: "11px", color: t.textVeryMuted }}>
                    Keine Sticker gefunden
                  </div>
                )}
                {filteredStickers.map((s, i) => {
                  const sel = form.stickerRefs.some(r => r.name === s.name && r.brand === s.brand);
                  const firstColor = (s.colors || []).find(c => c !== "transparent");
                  return (
                    <div key={i} onClick={() => toggleSticker(s)}
                      style={{ display: "flex", alignItems: "center", gap: "10px", padding: "7px 14px",
                               cursor: "pointer", background: sel ? (t.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)") : "transparent",
                               borderBottom: i < filteredStickers.length - 1 ? `1px solid ${t.textFaint}` : "none" }}>
                      {firstColor
                        ? <span style={{ width: 14, height: 14, borderRadius: "50%", background: firstColor, border: `1px solid ${t.cardBorder}`, flexShrink: 0 }} />
                        : <span style={{ width: 14, height: 14, borderRadius: "50%", border: `1px solid ${t.cardBorder}`, flexShrink: 0, opacity: 0.4 }} />
                      }
                      <span style={{ fontFamily: t.fontBody, fontSize: "12px", color: t.text, flex: 1 }}>{s.name}</span>
                      {(s.brand || s.style) && (
                        <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.textVeryMuted }}>
                          {[s.brand, s.style].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      {sel && <span style={{ color: t.filterColorActive, fontSize: "12px" }}>✓</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ marginBottom: "18px" }}>
            <label className="form-label">Notizen</label>
            <textarea className="form-input" placeholder="Anlass, Haltbarkeit, Gedanken…"
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              style={{ resize: "vertical", minHeight: "58px", lineHeight: "1.5" }} />
          </div>

          <button className="add-btn" onClick={handleSubmit} disabled={!form.date}>Eintrag speichern</button>
        </div>
      )}

      {manicures.length === 0 && !showForm && (
        <div style={{ textAlign: "center", padding: "60px 0", fontFamily: t.fontBody,
                      fontSize: "12px", color: t.textVeryMuted, letterSpacing: "1px" }}>
          Noch keine Einträge. Starte mit „+ Neuer Eintrag".
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {manicures.map(m => {
          const expanded = expandedId === m.id;
          return (
            <div key={m.id} style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`,
                                     borderRadius: t.cardRadius, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", padding: "16px 18px",
                            cursor: "pointer" }}
                onClick={() => setExpandedId(expanded ? null : m.id)}>
                {m.photo && (
                  <img src={`/photos/${m.photo}`} alt=""
                    style={{ width: 72, height: 54, objectFit: "cover", borderRadius: "8px",
                             flexShrink: 0, border: `1px solid ${t.cardBorder}` }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: t.fontDisplay, fontSize: "18px", color: t.text, marginBottom: "6px" }}>
                    {formatDate(m.date)}
                  </div>
                  {m.polishRefs && m.polishRefs.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "4px" }}>
                      {m.polishRefs.map((r, i) => (
                        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "5px",
                          fontFamily: t.fontBody, fontSize: "11px", color: t.textMuted }}>
                          <span style={{ width: 10, height: 10, borderRadius: "50%", background: r.color,
                                         border: `1px solid ${t.cardBorder}`, flexShrink: 0, display: "inline-block" }} />
                          {r.name}{r.brand ? ` · ${r.brand}` : ""}
                          {i < m.polishRefs.length - 1 && <span style={{ color: t.textFaint }}>,</span>}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.stickerRefs && m.stickerRefs.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "6px" }}>
                      {m.stickerRefs.map((r, i) => {
                        const fc = (r.colors || []).find(c => c !== "transparent");
                        return (
                          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "5px",
                            fontFamily: t.fontBody, fontSize: "11px", color: t.textMuted }}>
                            {fc
                              ? <span style={{ width: 10, height: 10, borderRadius: "3px", background: fc, border: `1px solid ${t.cardBorder}`, flexShrink: 0, display: "inline-block" }} />
                              : <span style={{ fontSize: "10px", flexShrink: 0 }}>◌</span>
                            }
                            {r.name}{r.brand ? ` · ${r.brand}` : ""}
                            {i < m.stickerRefs.length - 1 && <span style={{ color: t.textFaint }}>,</span>}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {m.notes && (
                    <div style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.textVeryMuted,
                                  overflow: "hidden", display: "-webkit-box", WebkitLineClamp: expanded ? undefined : 2,
                                  WebkitBoxOrient: "vertical" }}>
                      {m.notes}
                    </div>
                  )}
                </div>
                <button onClick={e => { e.stopPropagation(); onDelete(m.id); }}
                  style={{ background: "transparent", border: "none", color: t.textVeryMuted,
                           cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: "2px", flexShrink: 0,
                           transition: "color 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.color = "rgba(255,120,120,0.9)"}
                  onMouseLeave={e => e.currentTarget.style.color = t.textVeryMuted}>×</button>
              </div>
              {expanded && m.photo && (
                <div style={{ padding: "0 18px 16px" }}>
                  <img src={`/photos/${m.photo}`} alt=""
                    style={{ maxWidth: "100%", borderRadius: "8px", border: `1px solid ${t.cardBorder}` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
