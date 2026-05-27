import { useState, useMemo, useEffect, useCallback, useRef } from "react";

const FINISH_OPTIONS = [
  { value: "Classic",     label: "Classic",      icon: "●" },
  { value: "Shimmer",     label: "Shimmer",      icon: "✨" },
  { value: "Glitter",     label: "Glitter",      icon: "✦" },
  { value: "Metallic",    label: "Metallic",     icon: "◉" },
  { value: "Chrome",      label: "Chrome",       icon: "◎" },
  { value: "Matte",       label: "Matte",        icon: "◼" },
  { value: "Satin",       label: "Satin",        icon: "◈" },
  { value: "Duochrome",   label: "Duochrome",    icon: "◑" },
  { value: "Holographic", label: "Holographic",  icon: "◇" },
  { value: "Jelly",       label: "Jelly",        icon: "○" },
  { value: "Neon",        label: "Neon",         icon: "◆" },
  { value: "Magnetic",    label: "Magnetic",     icon: "⬡" },
  { value: "Gel Look",    label: "Gel Look",     icon: "◐" },
  { value: "Top Coat",    label: "Top Coat",     icon: "▽" },
  { value: "Base Coat",   label: "Base Coat",    icon: "△" },
];

const SHIMMER_FINISHES = new Set(["Shimmer", "Glitter", "Metallic", "Chrome", "Holographic", "Duochrome"]);

const BRAND_SUGGESTIONS = [
  "Alessandro", "Barry M", "Butter London", "Catrice", "Chanel",
  "China Glaze", "CND", "Color Street", "Dance Legend", "Deborah Lippmann",
  "Depend", "Dior", "E.Mi", "Essie", "Flormar", "Gelish",
  "Golden Rose", "IBD", "Inglot", "IsaDora", "Kiko Milano",
  "Kiara Sky", "Kure Bazaar", "L.A. Colors", "Lancôme",
  "MAC", "Manucurist", "Maybelline", "Models Own",
  "Nailberry", "Nails Inc.", "NYX", "OPI", "Orly",
  "Pastel", "Revlon", "Rimmel", "Sally Hansen",
  "The Body Shop", "Wet n Wild", "YSL", "Zoya",
];

const STATUS_OPTIONS = [
  { value: "ok",    label: "✓ Vorhanden",      color: "rgba(150,255,180,0.7)" },
  { value: "wish",  label: "☆ Wunschliste",    color: "rgba(180,160,255,0.7)" },
  { value: "empty", label: "○ Leer",           color: "rgba(255,200,80,0.7)"  },
  { value: "gone",  label: "✕ Nicht mehr da",  color: "rgba(255,100,100,0.7)" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Neu" },
  { value: "name",   label: "Name" },
  { value: "brand",  label: "Marke" },
  { value: "hue",    label: "Farbe" },
];

function NailBottle({ color, finish, selected, status, brand }) {
  const uid = useMemo(() => color.replace("#", "") + Math.random().toString(36).slice(2, 7), []);
  const gId = `g${uid}`, sId = `s${uid}`, glId = `gl${uid}`;
  const faded = status === "empty" || status === "gone";
  const isWish = status === "wish";
  const shimmer = SHIMMER_FINISHES.has(finish || "Classic");
  const brandLabel = (brand || "").toUpperCase().slice(0, 9);
  const brandFs = brandLabel.length > 6 ? "3" : "4";
  return (
    <svg width="64" height="130" viewBox="0 0 64 130" fill="none"
      style={{ filter: selected ? `drop-shadow(0 0 14px ${color}bb)` : "drop-shadow(0 4px 10px rgba(0,0,0,0.55))", transition: "filter 0.3s, opacity 0.3s", opacity: faded ? 0.38 : isWish ? 0.62 : 1 }}>
      <defs>
        <linearGradient id={gId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} />
          <stop offset="60%" stopColor={color} stopOpacity="0.85" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id={sId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="white" stopOpacity="0.35" />
          <stop offset="40%" stopColor="white" stopOpacity="0.07" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        {shimmer && (
          <linearGradient id={glId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="white" stopOpacity="0.55" />
            <stop offset="25%" stopColor={color} />
            <stop offset="50%" stopColor="white" stopOpacity="0.35" />
            <stop offset="75%" stopColor={color} />
            <stop offset="100%" stopColor="white" stopOpacity="0.5" />
          </linearGradient>
        )}
      </defs>
      <rect x="18" y="2" width="28" height="28" rx="5" fill="#1a1a1a" />
      <rect x="20" y="4" width="24" height="24" rx="4" fill="#2a2a2a" />
      <rect x="22" y="5" width="8" height="22" rx="2" fill="white" fillOpacity="0.07" />
      <rect x="26" y="30" width="12" height="12" fill="#1a1a1a" />
      <rect x="27" y="30" width="5" height="12" fill="white" fillOpacity="0.04" />
      <rect x="10" y="42" width="44" height="82" rx="6" fill={shimmer ? `url(#${glId})` : `url(#${gId})`} />
      <rect x="10" y="42" width="44" height="82" rx="6" fill={`url(#${sId})`} />
      {status === "empty" && <rect x="10" y="90" width="44" height="34" rx="0" fill="rgba(0,0,0,0.55)" />}
      {isWish && <text x="32" y="39" textAnchor="middle" fontSize="10" fill="rgba(200,180,255,0.9)">☆</text>}
      <rect x="15" y="48" width="10" height="40" rx="3" fill="white" fillOpacity="0.17" />
      <rect x="16" y="49" width="4" height="20" rx="2" fill="white" fillOpacity="0.24" />
      <rect x="10" y="108" width="44" height="16" rx="6" fill="black" fillOpacity="0.2" />
      <rect x="18" y="75" width="28" height="30" rx="2" fill="white" fillOpacity="0.11" />
      <text x="32" y="87" textAnchor="middle" fontSize={brandFs} fill="white" fillOpacity="0.65" fontFamily="serif" letterSpacing="0.3">{brandLabel}</text>
      <line x1="20" y1="90" x2="44" y2="90" stroke="white" strokeOpacity="0.25" strokeWidth="0.5" />
      <text x="32" y="98" textAnchor="middle" fontSize="3.5" fill="white" fillOpacity="0.45" fontFamily="sans-serif">nail lacquer</text>
    </svg>
  );
}

const EMPTY_FORM = { num: "", name: "", brand: "", color: "#ff6699", finish: "Classic", count: 1, categories: [], status: "ok", notes: "" };

function PolishForm({ form, setForm, customCats, allBrands, allColors, onSubmit, submitLabel, onCancel, onAddCategory, onDeleteCategory, success }) {
  const [newCatName, setNewCatName]     = useState("");
  const [showNewCat, setShowNewCat]     = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const photoInputRef  = useRef(null);
  const photoCanvasRef = useRef(null);

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

  const swatchColors = useMemo(() => (allColors || []).filter(c => c !== form.color).slice(0, 24), [allColors, form.color]);

  return (
    <div style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "24px", padding: "26px 26px 22px" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
        <div style={{ textAlign: "center" }}>
          <NailBottle color={form.color} finish={form.finish} selected={false} status={form.status} brand={form.brand} />
          {form.name && (
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "13px", color: "rgba(255,255,255,0.65)", marginTop: "8px", maxWidth: "100px" }}>
              {form.brand && <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "9px", letterSpacing: "2px", color: "rgba(255,255,255,0.22)", textTransform: "uppercase" }}>{form.brand}</div>}
              {form.num && <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "2px", color: "rgba(255,255,255,0.28)" }}>{form.num}</div>}
              {form.name}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr", gap: "12px", marginBottom: "12px" }}>
        <div>
          <label className="form-label">Name *</label>
          <input className="form-input" placeholder="z.B. Blue You A Kiss" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="form-label">Marke *</label>
          <input className="form-input" list="brand-suggestions" placeholder="z.B. Catrice, OPI…"
            value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} />
          <datalist id="brand-suggestions">
            {[...new Set([...(allBrands || []), ...BRAND_SUGGESTIONS])].sort().map(b => <option key={b} value={b} />)}
          </datalist>
        </div>
        <div>
          <label className="form-label">Nummer</label>
          <input className="form-input" placeholder="z.B. 029" value={form.num} onChange={e => setForm(f => ({ ...f, num: e.target.value }))} />
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
          <div style={{ display: "flex", alignItems: "center", gap: "9px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "10px", padding: "8px 12px", height: "42px" }}>
            <div style={{ width: 22, height: 22, borderRadius: "5px", background: form.color, boxShadow: `0 0 8px ${form.color}88`, flexShrink: 0 }} />
            <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={{ width: "100%", height: "22px" }} />
            <button type="button" title="Farbe aus Foto auswählen" onClick={() => photoInputRef.current?.click()}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "7px", padding: "3px 7px", cursor: "pointer", fontSize: "14px", lineHeight: 1, flexShrink: 0, transition: "border-color 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"}>
              📷
            </button>
          </div>
          <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoSelect} style={{ display: "none" }} />
          {photoPreview && (
            <div style={{ marginTop: "10px", position: "relative", display: "inline-block" }}>
              <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "2px", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", marginBottom: "6px" }}>
                Auf die gewünschte Farbe tippen
              </div>
              <canvas ref={photoCanvasRef} onClick={handleCanvasClick}
                style={{ display: "block", cursor: "crosshair", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.12)", maxWidth: "100%" }} />
              <button onClick={() => setPhotoPreview(null)}
                style={{ position: "absolute", top: "26px", right: "6px", background: "rgba(0,0,0,0.55)", border: "none", color: "rgba(255,255,255,0.7)", borderRadius: "50%", width: "22px", height: "22px", cursor: "pointer", fontSize: "12px", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                ✕
              </button>
            </div>
          )}
          {swatchColors.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "8px" }}>
              {swatchColors.map(c => (
                <button key={c} title={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                  style={{ width: 18, height: 18, borderRadius: "50%", background: c, border: "1px solid rgba(255,255,255,0.18)", cursor: "pointer", padding: 0, transition: "transform 0.15s", flexShrink: 0 }}
                  onMouseEnter={e => e.currentTarget.style.transform = "scale(1.3)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"} />
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="form-label">Anzahl</label>
          <input className="form-input" type="number" min="1" max="99" value={form.count}
            onChange={e => setForm(f => ({ ...f, count: Math.max(1, parseInt(e.target.value) || 1) }))} style={{ textAlign: "center" }} />
        </div>
      </div>
      <div style={{ marginBottom: "14px" }}>
        <label className="form-label">Status</label>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {STATUS_OPTIONS.map(s => (
            <button key={s.value} className={`cat-chip ${form.status === s.value ? "on" : ""}`}
              style={form.status === s.value ? { borderColor: s.color, color: s.color, background: "rgba(255,255,255,0.08)" } : {}}
              onClick={() => setForm(f => ({ ...f, status: s.value }))}>{s.label}</button>
          ))}
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
          {customCats.length === 0 && !showNewCat && <span style={{ fontFamily: "'Jost',sans-serif", fontSize: "11px", color: "rgba(255,255,255,0.2)", alignSelf: "center" }}>Noch keine eigenen Kategorien</span>}
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
        <label className="form-label">Notizen</label>
        <textarea className="form-input" placeholder="Kaufdatum, Bewertung, Besonderheiten…" value={form.notes || ""}
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

function hexToHue(hex) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return 0;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  let h;
  if (max === r)      h = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else                h = (r - g) / (max - min) + 4;
  return h * 60;
}

function Bar({ value, max, color }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <div style={{ flex: 1, height: "6px", background: "rgba(255,255,255,0.07)", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "3px", transition: "width 0.6s ease" }} />
      </div>
      <span style={{ fontFamily: "'Jost',sans-serif", fontSize: "11px", color: "rgba(255,255,255,0.45)", minWidth: "28px", textAlign: "right" }}>{value}</span>
    </div>
  );
}

function StatCard({ children, style }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "20px", padding: "22px 24px", ...style }}>
      {children}
    </div>
  );
}

function CardLabel({ children }) {
  return <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: "rgba(255,255,255,0.22)", marginBottom: "14px" }}>{children}</div>;
}

function StatsPage({ polishes, customCats }) {
  const total        = polishes.length;
  const totalBottles = polishes.reduce((a, p) => a + (p.count || 1), 0);
  const available    = polishes.filter(p => (p.status || "ok") === "ok").length;
  const wish         = polishes.filter(p => p.status === "wish").length;
  const empty        = polishes.filter(p => p.status === "empty").length;
  const gone         = polishes.filter(p => p.status === "gone").length;

  const finishCounts = useMemo(() => {
    const map = {};
    polishes.forEach(p => { const f = p.finish || "Classic"; map[f] = (map[f] || 0) + 1; });
    return FINISH_OPTIONS.filter(f => map[f.value]).map(f => ({ ...f, count: map[f.value] || 0 }));
  }, [polishes]);

  const byBrand = useMemo(() => {
    const map = {};
    polishes.forEach(p => { const b = p.brand || "—"; map[b] = (map[b] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [polishes]);

  const byCat = useMemo(() => {
    return customCats.map(c => ({
      label: c.label,
      count: polishes.filter(p => (p.categories || []).includes(c.id)).length,
    })).filter(c => c.count > 0).sort((a, b) => b.count - a.count);
  }, [polishes, customCats]);

  const colorPalette = useMemo(() => {
    const unique = [...new Set(polishes.map(p => p.color))];
    return unique.sort((a, b) => hexToHue(a) - hexToHue(b));
  }, [polishes]);

  const bigNum = { fontFamily: "'Cormorant Garamond',serif", fontSize: "42px", fontWeight: 300, lineHeight: 1, color: "rgba(255,255,255,0.9)" };
  const bigLabel = { fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginTop: "6px" };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 18px 60px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: "14px", marginBottom: "20px" }}>
        {[
          { value: total,        label: "Lacke gesamt",   color: "rgba(255,255,255,0.9)"   },
          { value: totalBottles, label: "Flaschen",       color: "rgba(200,230,255,0.9)"   },
          { value: available,    label: "Verfügbar",      color: "rgba(150,255,180,0.85)"  },
          { value: wish,         label: "Wunschliste",    color: "rgba(180,160,255,0.85)"  },
          { value: empty + gone, label: "Leer / Weg",     color: "rgba(255,180,80,0.85)"   },
        ].map(({ value, label, color }) => (
          <StatCard key={label}>
            <div style={{ ...bigNum, color }}>{value}</div>
            <div style={bigLabel}>{label}</div>
          </StatCard>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "20px" }}>
        <StatCard>
          <CardLabel>Marken</CardLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {byBrand.map(([brand, count]) => (
              <div key={brand}>
                <div style={{ marginBottom: "4px" }}>
                  <span style={{ fontFamily: "'Jost',sans-serif", fontSize: "12px", color: "rgba(255,255,255,0.7)", letterSpacing: "1px" }}>{brand}</span>
                </div>
                <Bar value={count} max={total} color="rgba(180,180,255,0.55)" />
              </div>
            ))}
            {byBrand.length === 0 && <span style={{ fontFamily: "'Jost',sans-serif", fontSize: "12px", color: "rgba(255,255,255,0.2)" }}>Keine Marken eingetragen</span>}
          </div>
        </StatCard>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <StatCard>
            <CardLabel>Finish</CardLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {finishCounts.map(({ icon, label, count }) => (
                <div key={label}>
                  <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "11px", color: "rgba(255,255,255,0.45)", marginBottom: "3px" }}>{icon} {label}</div>
                  <Bar value={count} max={total} color="rgba(200,200,255,0.55)" />
                </div>
              ))}
            </div>
          </StatCard>

          <StatCard>
            <CardLabel>Status</CardLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                { label: "✓ Vorhanden",      value: available, color: "rgba(150,255,180,0.55)" },
                { label: "☆ Wunschliste",    value: wish,      color: "rgba(180,160,255,0.55)" },
                { label: "○ Leer",           value: empty,     color: "rgba(255,200,80,0.55)"  },
                { label: "✕ Nicht mehr da",  value: gone,      color: "rgba(255,100,100,0.55)" },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "11px", color: "rgba(255,255,255,0.45)", marginBottom: "3px" }}>{label}</div>
                  <Bar value={value} max={total} color={color} />
                </div>
              ))}
            </div>
          </StatCard>
        </div>
      </div>

      {byCat.length > 0 && (
        <StatCard style={{ marginBottom: "20px" }}>
          <CardLabel>Eigene Kategorien</CardLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {byCat.map(({ label, count }) => (
              <div key={label}>
                <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "11px", color: "rgba(255,255,255,0.45)", marginBottom: "3px" }}>◆ {label}</div>
                <Bar value={count} max={total} color="rgba(220,160,255,0.55)" />
              </div>
            ))}
          </div>
        </StatCard>
      )}

      <StatCard>
        <CardLabel>Farb-Palette · {colorPalette.length} Farben</CardLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {colorPalette.map(c => (
            <div key={c} title={c} style={{ width: "28px", height: "28px", borderRadius: "50%", background: c, boxShadow: `0 0 8px ${c}66`, border: "1.5px solid rgba(255,255,255,0.12)", flexShrink: 0, transition: "transform 0.2s", cursor: "default" }}
              onMouseEnter={e => e.currentTarget.style.transform = "scale(1.3)"}
              onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"} />
          ))}
        </div>
      </StatCard>
    </div>
  );
}

function LogPanel({ apiKey }) {
  const [open, setOpen]       = useState(false);
  const [logs, setLogs]       = useState("");
  const [loading, setLoading] = useState(false);
  const [lines, setLines]     = useState(100);
  const [live, setLive]       = useState(false);
  const [hasError, setHasError] = useState(false);
  const logRef   = useRef(null);
  const timerRef = useRef(null);

  const fetchLogs = useCallback((n) => {
    const count = n ?? lines;
    setLoading(true);
    fetch(`/api/logs?lines=${count}`, { headers: { "X-Api-Key": apiKey || "" } })
      .then(r => {
        if (r.status === 401) { setLogs("API-Schlüssel fehlt — bitte in den Einstellungen (⚙) eintragen."); setHasError(true); setLoading(false); return null; }
        return r.json();
      })
      .then(d => {
        if (!d) return;
        setLogs(d.logs || "");
        setHasError(!!d.error);
        setLoading(false);
        setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 30);
      })
      .catch(() => { setHasError(true); setLoading(false); });
  }, [lines, apiKey]);

  useEffect(() => { if (open) fetchLogs(); }, [open]);

  useEffect(() => {
    clearInterval(timerRef.current);
    if (live && open) timerRef.current = setInterval(() => fetchLogs(), 3000);
    return () => clearInterval(timerRef.current);
  }, [live, open, fetchLogs]);

  const handleLines = (n) => { setLines(n); fetchLogs(n); };

  const btnBase = {
    background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
    color: "rgba(255,255,255,0.35)", padding: "3px 12px", borderRadius: "14px",
    cursor: "pointer", fontFamily: "'Jost',sans-serif", fontSize: "10px",
    letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s",
  };
  const btnActive = { ...btnBase, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", borderColor: "rgba(255,255,255,0.3)" };

  if (!open) return (
    <div style={{ textAlign: "center", paddingBottom: "12px" }}>
      <button style={btnBase}
        onMouseEnter={e => Object.assign(e.currentTarget.style, { color: "rgba(255,255,255,0.65)", borderColor: "rgba(255,255,255,0.3)" })}
        onMouseLeave={e => Object.assign(e.currentTarget.style, { color: "rgba(255,255,255,0.35)", borderColor: "rgba(255,255,255,0.15)" })}
        onClick={() => setOpen(true)}>
        ≡ System Logs
      </button>
    </div>
  );

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto 40px", padding: "0 18px" }}>
      <div style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "3px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", flexShrink: 0 }}>
            ≡ System Logs {loading && <span style={{ marginLeft: "8px", opacity: 0.5 }}>⟳</span>}
          </span>
          <div style={{ display: "flex", gap: "6px", marginLeft: "auto", flexWrap: "wrap", alignItems: "center" }}>
            {[50, 100, 200].map(n => (
              <button key={n} style={lines === n ? btnActive : btnBase} onClick={() => handleLines(n)}>{n}</button>
            ))}
            <button style={live ? { ...btnActive, borderColor: "rgba(100,255,150,0.4)", color: "rgba(100,255,150,0.8)" } : btnBase}
              onClick={() => setLive(v => !v)}>
              {live ? "● Live" : "○ Live"}
            </button>
            <button style={btnBase} onClick={() => fetchLogs()}
              onMouseEnter={e => Object.assign(e.currentTarget.style, { color: "rgba(255,255,255,0.7)", borderColor: "rgba(255,255,255,0.35)" })}
              onMouseLeave={e => Object.assign(e.currentTarget.style, { color: "rgba(255,255,255,0.35)", borderColor: "rgba(255,255,255,0.15)" })}>
              ↺ Refresh
            </button>
            <button style={{ ...btnBase, borderColor: "rgba(255,80,80,0.25)", color: "rgba(255,100,100,0.5)" }}
              onClick={() => { setOpen(false); setLive(false); }}
              onMouseEnter={e => Object.assign(e.currentTarget.style, { color: "rgba(255,120,120,0.9)", borderColor: "rgba(255,80,80,0.55)" })}
              onMouseLeave={e => Object.assign(e.currentTarget.style, { color: "rgba(255,100,100,0.5)", borderColor: "rgba(255,80,80,0.25)" })}>
              ✕ Schließen
            </button>
          </div>
        </div>
        <pre ref={logRef} style={{
          margin: 0, padding: "14px 18px", maxHeight: "420px", overflowY: "auto",
          fontFamily: "'Courier New', 'Consolas', monospace", fontSize: "11px",
          lineHeight: "1.6", color: hasError ? "rgba(255,140,140,0.8)" : "rgba(180,220,180,0.85)",
          whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}>
          {logs || (loading ? "Lade…" : "Keine Logs verfügbar")}
        </pre>
      </div>
    </div>
  );
}

function UpdatePanel({ apiKey }) {
  const [version, setVersion]             = useState(null);
  const [status, setStatus]               = useState("idle");
  const [latestVersion, setLatestVersion] = useState(null);
  const [errorMsg, setErrorMsg]           = useState("");
  const pollRef                           = useRef(null);

  useEffect(() => {
    fetch("/api/version").then(r => r.json()).then(d => setVersion(d.version)).catch(() => {});
    return () => clearInterval(pollRef.current);
  }, []);

  const check = () => {
    setStatus("checking"); setErrorMsg("");
    fetch("/api/update/check", { headers: { "X-Api-Key": apiKey || "" } })
      .then(r => {
        if (r.status === 401) { setErrorMsg("API-Schlüssel fehlt — bitte in den Einstellungen (⚙) eintragen."); setStatus("error"); return null; }
        return r.json();
      })
      .then(d => {
        if (!d) return;
        if (d.error) { setErrorMsg(d.error); setStatus("error"); return; }
        if (d.updateAvailable) { setLatestVersion(d.latestVersion); setStatus("available"); }
        else { setStatus("uptodate"); setTimeout(() => setStatus("idle"), 3500); }
      })
      .catch(e => { setErrorMsg(e.message); setStatus("error"); });
  };

  const applyUpdate = () => {
    setStatus("updating");
    fetch("/api/update/apply", { method: "POST", headers: { "X-Api-Key": apiKey || "" } })
      .then(r => {
        if (r.status === 401) { setErrorMsg("API-Schlüssel fehlt — bitte in den Einstellungen (⚙) eintragen."); setStatus("error"); return null; }
        return r.json();
      })
      .then(d => {
      if (!d) return;
      if (d.error) { setErrorMsg(d.error); setStatus("error"); return; }
      setStatus("restarting");
      // Poll until the new version appears instead of a fixed delay
      pollRef.current = setInterval(() => {
        fetch("/api/version").then(r => r.json()).then(d => {
          if (d.version && d.version !== version) {
            clearInterval(pollRef.current);
            window.location.reload();
          }
        }).catch(() => {});
      }, 2000);
      // Hard fallback after 60 seconds
      setTimeout(() => { clearInterval(pollRef.current); window.location.reload(); }, 60000);
    }).catch(e => { setErrorMsg(e.message); setStatus("error"); });
  };

  const btnStyle = { background: "transparent", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.38)", padding: "4px 14px", borderRadius: "16px", cursor: "pointer", fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" };
  const updateBtnStyle = { ...btnStyle, borderColor: "rgba(255,210,60,0.45)", color: "rgba(255,210,60,0.75)" };
  const textStyle = { fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase" };

  return (
    <div style={{ textAlign: "center", padding: "0 0 36px" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
        {version && <span style={{ ...textStyle, color: "rgba(255,255,255,0.15)" }}>v{version}</span>}
        {status === "idle"       && <button style={btnStyle} onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.65)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.35)"; }} onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.38)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; }} onClick={check}>Updates prüfen</button>}
        {status === "checking"   && <span style={{ ...textStyle, color: "rgba(255,255,255,0.25)" }}>Prüfe…</span>}
        {status === "uptodate"   && <span style={{ ...textStyle, color: "rgba(150,255,180,0.55)" }}>✓ Aktuell</span>}
        {status === "available"  && <>
          <span style={{ ...textStyle, color: "rgba(255,210,60,0.75)" }}>↑ v{latestVersion} verfügbar</span>
          <button style={updateBtnStyle} onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,210,60,1)"; e.currentTarget.style.borderColor = "rgba(255,210,60,0.75)"; e.currentTarget.style.background = "rgba(255,210,60,0.07)"; }} onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,210,60,0.75)"; e.currentTarget.style.borderColor = "rgba(255,210,60,0.45)"; e.currentTarget.style.background = "transparent"; }} onClick={applyUpdate}>Jetzt updaten</button>
        </>}
        {status === "updating"   && <span style={{ ...textStyle, color: "rgba(255,255,255,0.3)" }}>⟳ Installiere Update…</span>}
        {status === "restarting" && <span style={{ ...textStyle, color: "rgba(150,255,180,0.6)" }}>✓ Update installiert · warte auf Neustart…</span>}
        {status === "error"      && <>
          <span style={{ ...textStyle, color: "rgba(255,120,120,0.7)" }}>✕ {errorMsg}</span>
          <button style={btnStyle} onClick={() => setStatus("idle")}>Zurück</button>
        </>}
      </div>
    </div>
  );
}

export default function App() {
  const [polishes, setPolishes]           = useState([]);
  const [customCats, setCustomCats]       = useState([]);
  const [loading, setLoading]             = useState(true);
  const [saveStatus, setSaveStatus]       = useState("idle");
  const [selected, setSelected]           = useState(null);
  const [activeFilter, setActiveFilter]   = useState("all");
  const [search, setSearch]               = useState("");
  const [sortBy, setSortBy]               = useState("newest");
  const [showAdd, setShowAdd]             = useState(false);
  const [form, setForm]                   = useState(EMPTY_FORM);
  const [addSuccess, setAddSuccess]       = useState(false);
  const [editIdx, setEditIdx]             = useState(null);
  const [editForm, setEditForm]           = useState(null);
  const [editSuccess, setEditSuccess]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeBrand, setActiveBrand]     = useState(null);
  const [view, setView]                   = useState("collection");
  const [undoEntry, setUndoEntry]         = useState(null);
  const [batchMode, setBatchMode]         = useState(false);
  const [batchSel, setBatchSel]           = useState(new Set());
  const undoTimer                         = useRef(null);
  const importRef                         = useRef(null);
  const [apiKey, setApiKey]               = useState(() => localStorage.getItem("nagellacke_api_key") || "");
  const [showSettings, setShowSettings]   = useState(false);
  const [settingsInput, setSettingsInput] = useState("");

  useEffect(() => {
    fetch("/api/data")
      .then(r => r.json())
      .then(data => { setPolishes(data.polishes || []); setCustomCats(data.customCats || []); })
      .catch(e => console.error("Load error:", e))
      .finally(() => setLoading(false));
  }, []);

  const saveToBackend = useCallback((newPolishes, newCats) => {
    setSaveStatus("saving");
    fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey || "" },
      body: JSON.stringify({ polishes: newPolishes, customCats: newCats }),
    })
      .then(r => {
        if (r.status === 401) { setSaveStatus("unauth"); setTimeout(() => setSaveStatus("idle"), 4000); return null; }
        return r.json();
      })
      .then(d => { if (!d) return; setSaveStatus("saved"); setTimeout(() => setSaveStatus("idle"), 1800); })
      .catch(() => { setSaveStatus("error"); setTimeout(() => setSaveStatus("idle"), 3000); });
  }, [apiKey]);

  const updatePolishes = useCallback((np) => { setPolishes(np); saveToBackend(np, customCats); }, [customCats, saveToBackend]);
  const updateCats     = useCallback((nc) => { setCustomCats(nc); saveToBackend(polishes, nc); }, [polishes, saveToBackend]);

  const allBrands = useMemo(() => [...new Set(polishes.map(p => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [polishes]);
  const allColors = useMemo(() => [...new Set(polishes.map(p => p.color))], [polishes]);

  const usedFinishes = useMemo(() => {
    const inUse = new Set(polishes.map(p => p.finish || "Classic"));
    return FINISH_OPTIONS.filter(f => inUse.has(f.value));
  }, [polishes]);

  const usedCustomCats = useMemo(() => {
    const inUse = new Set(polishes.flatMap(p => p.categories || []));
    return customCats.filter(c => inUse.has(c.id));
  }, [polishes, customCats]);

  const sorted = useMemo(() => {
    const arr = [...polishes];
    if (sortBy === "name")  arr.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === "brand") arr.sort((a, b) => (a.brand || "").localeCompare(b.brand || ""));
    if (sortBy === "hue")   arr.sort((a, b) => hexToHue(a.color) - hexToHue(b.color));
    return arr;
  }, [polishes, sortBy]);

  const filtered = useMemo(() => sorted.filter(p => {
    if (search) {
      const q = search.toLowerCase();
      const finishLabel = (FINISH_OPTIONS.find(f => f.value === (p.finish || "Classic"))?.label || "").toLowerCase();
      const catLabels   = (p.categories || []).map(cid => customCats.find(c => c.id === cid)?.label || "").join(" ").toLowerCase();
      const notesText   = (p.notes || "").toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !(p.num || "").includes(q) && !(p.brand || "").toLowerCase().includes(q) && !finishLabel.includes(q) && !catLabels.includes(q) && !notesText.includes(q)) return false;
    }
    if (activeBrand && (p.brand || "") !== activeBrand) return false;
    if (activeFilter === "all")  return true;
    if (activeFilter === "wish") return p.status === "wish";
    if (activeFilter === "empty") return p.status === "empty" || p.status === "gone";
    if (FINISH_OPTIONS.some(f => f.value === activeFilter)) return (p.finish || "Classic") === activeFilter;
    return (p.categories || []).includes(activeFilter);
  }), [sorted, search, activeFilter, activeBrand, customCats]);

  const sel = selected !== null ? polishes[selected] : null;

  // ── Undo ──
  const triggerUndo = (snapshot, label) => {
    clearTimeout(undoTimer.current);
    setUndoEntry({ ...snapshot, label });
    undoTimer.current = setTimeout(() => setUndoEntry(null), 5000);
  };

  const undoDelete = () => {
    if (!undoEntry) return;
    setPolishes(undoEntry.polishes);
    setCustomCats(undoEntry.customCats);
    saveToBackend(undoEntry.polishes, undoEntry.customCats);
    setUndoEntry(null);
    clearTimeout(undoTimer.current);
  };

  const saveApiKey = () => {
    localStorage.setItem("nagellacke_api_key", settingsInput);
    setApiKey(settingsInput);
    setShowSettings(false);
  };

  useEffect(() => { setBatchSel(new Set()); }, [activeFilter, activeBrand, sortBy]);

  // ── CRUD ──
  const handleAdd = () => {
    if (!form.name.trim()) return;
    const newPolishes = [...polishes, {
      name: form.name.trim(), brand: form.brand.trim() || undefined,
      color: form.color, finish: form.finish,
      categories: form.categories, status: form.status,
      ...(form.num.trim()             && { num:   form.num.trim() }),
      ...(parseInt(form.count) > 1    && { count: parseInt(form.count) }),
      ...(form.notes.trim()           && { notes: form.notes.trim() }),
    }];
    updatePolishes(newPolishes);
    setForm(EMPTY_FORM);
    setAddSuccess(true);
    setTimeout(() => setAddSuccess(false), 2200);
  };

  const openEdit = (idx) => {
    const p = polishes[idx];
    setEditIdx(idx);
    setEditForm({ num: p.num || "", name: p.name, brand: p.brand || "", color: p.color, finish: p.finish || "Classic", count: p.count || 1, categories: [...(p.categories || [])], status: p.status || "ok", notes: p.notes || "" });
    setConfirmDelete(false);
    setEditSuccess(false);
  };

  const handleSave = () => {
    if (!editForm.name.trim()) return;
    const cnt = parseInt(editForm.count);
    const newPolishes = polishes.map((p, i) => i !== editIdx ? p : {
      ...p, name: editForm.name.trim(), brand: editForm.brand.trim() || undefined,
      color: editForm.color, finish: editForm.finish,
      categories: editForm.categories, status: editForm.status,
      ...(editForm.num.trim()   ? { num: editForm.num.trim() }   : { num: undefined }),
      ...(editForm.notes.trim() ? { notes: editForm.notes.trim() } : { notes: undefined }),
      count: cnt > 1 ? cnt : undefined,
    });
    updatePolishes(newPolishes);
    setEditSuccess(true);
    setTimeout(() => { setEditSuccess(false); setEditIdx(null); setEditForm(null); }, 1500);
  };

  const handleDelete = () => {
    triggerUndo({ polishes, customCats }, polishes[editIdx]?.name || "Lack");
    updatePolishes(polishes.filter((_, i) => i !== editIdx));
    setEditIdx(null); setEditForm(null); setSelected(null); setConfirmDelete(false);
  };

  // ── Categories ──
  const addCategory = (label) => {
    if (!label.trim()) return;
    if (customCats.some(c => c.label.toLowerCase() === label.trim().toLowerCase())) return;
    const id = label.trim().toLowerCase().replace(/\s+/g, "_") + "_" + Date.now();
    updateCats([...customCats, { id, label: label.trim() }]);
  };

  const deleteCategory = (catId) => {
    const newCats     = customCats.filter(c => c.id !== catId);
    const newPolishes = polishes.map(p => ({ ...p, categories: (p.categories || []).filter(c => c !== catId) }));
    setPolishes(newPolishes);
    setCustomCats(newCats);
    saveToBackend(newPolishes, newCats);
    if (activeFilter === catId) setActiveFilter("all");
  };

  // ── Batch ──
  const toggleBatch = (idx) => {
    setBatchSel(s => { const ns = new Set(s); ns.has(idx) ? ns.delete(idx) : ns.add(idx); return ns; });
  };

  const batchDelete = () => {
    const snapshot = { polishes, customCats };
    triggerUndo(snapshot, `${batchSel.size} Lacke`);
    updatePolishes(polishes.filter((_, i) => !batchSel.has(i)));
    setBatchSel(new Set()); setBatchMode(false);
  };

  const batchSetStatus = (status) => {
    updatePolishes(polishes.map((p, i) => batchSel.has(i) ? { ...p, status } : p));
    setBatchSel(new Set()); setBatchMode(false);
  };

  // ── Export / Import ──
  const exportData = () => {
    const blob = new Blob([JSON.stringify({ polishes, customCats }, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `nagellacke-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data.polishes)) { alert("Ungültige Datei — kein polishes-Array gefunden"); return; }
        const IMPORT_COLOR_RE = /^#[0-9a-f]{6}$/i;
        const IMPORT_STATUSES = new Set(["ok", "wish", "empty", "gone"]);
        const invalid = data.polishes.some(p =>
          !p || typeof p !== "object" ||
          typeof p.name !== "string" || !p.name.trim() ||
          (p.color !== undefined && !IMPORT_COLOR_RE.test(p.color)) ||
          (p.status !== undefined && !IMPORT_STATUSES.has(p.status))
        );
        if (invalid) { alert("Datei enthält ungültige Lack-Daten (Name, Farbe oder Status fehlerhaft)"); return; }
        if (window.confirm(`${data.polishes.length} Lacke importieren? Die aktuellen Daten werden ersetzt.`)) {
          const newPolishes = data.polishes;
          const newCats     = Array.isArray(data.customCats) ? data.customCats : [];
          setPolishes(newPolishes); setCustomCats(newCats);
          saveToBackend(newPolishes, newCats);
        }
      } catch { alert("Datei konnte nicht gelesen werden"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const getPolishLabel = (p) => p.finish || "Classic";
  const statusObj = (p) => STATUS_OPTIONS.find(s => s.value === (p.status || "ok")) || STATUS_OPTIONS[0];

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0a080f,#12091a)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: "'Georgia',serif", color: "rgba(255,255,255,0.3)", fontSize: "18px", letterSpacing: "4px" }}>Lade Kollektion…</div>
    </div>
  );

  const batchSmallBtn = { background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.55)", padding: "6px 14px", borderRadius: "18px", cursor: "pointer", fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", transition: "all 0.2s" };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0a080f 0%,#12091a 50%,#080c18 100%)", color: "#fff" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Jost:wght@200;300;400&display=swap');
        *{box-sizing:border-box;}
        .bottle-card{cursor:pointer;transition:transform 0.35s cubic-bezier(0.34,1.56,0.64,1);display:flex;flex-direction:column;align-items:center;gap:10px;padding:20px 10px 16px;border-radius:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);position:relative;overflow:visible;}
        .bottle-card:hover{transform:translateY(-10px) scale(1.03);background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.15);}
        .bottle-card.active{transform:translateY(-14px) scale(1.06);border-color:rgba(255,255,255,0.3);}
        .bottle-card.batch-selected{border-color:rgba(180,160,255,0.5);background:rgba(180,160,255,0.07);}
        .filter-btn{background:transparent;border:1px solid rgba(255,255,255,0.18);color:rgba(255,255,255,0.45);padding:6px 16px;border-radius:20px;cursor:pointer;font-family:'Jost',sans-serif;font-weight:300;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;transition:all 0.2s;white-space:nowrap;}
        .filter-btn.active,.filter-btn:hover{background:rgba(255,255,255,0.1);color:white;border-color:rgba(255,255,255,0.4);}
        .filter-btn.custom-cat{border-style:dashed;}
        .count-badge{position:absolute;top:10px;right:10px;background:rgba(255,255,255,0.15);border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-family:'Jost',sans-serif;color:white;}
        .status-dot{position:absolute;top:10px;left:10px;width:8px;height:8px;border-radius:50%;}
        .batch-check{position:absolute;top:8px;left:8px;width:20px;height:20px;border-radius:50%;border:1.5px solid rgba(180,160,255,0.5);background:transparent;display:flex;align-items:center;justify-content:center;font-size:11px;transition:all 0.15s;}
        .batch-check.on{background:rgba(180,160,255,0.35);border-color:rgba(180,160,255,0.8);color:white;}
        @keyframes slideUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
        .slide-up{animation:slideUp 0.3s ease forwards;}
        .form-input{background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.14);border-radius:10px;color:white;padding:10px 14px;font-family:'Jost',sans-serif;font-size:14px;font-weight:300;outline:none;width:100%;transition:border-color 0.2s;}
        .form-input:focus{border-color:rgba(255,255,255,0.38);background:rgba(255,255,255,0.1);}
        .form-input::placeholder{color:rgba(255,255,255,0.22);}
        .form-label{font-family:'Jost',sans-serif;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-bottom:6px;display:block;}
        .cat-chip{padding:5px 12px;border-radius:14px;cursor:pointer;font-family:'Jost',sans-serif;font-size:11px;letter-spacing:1px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.4);transition:all 0.18s;}
        .cat-chip.on{background:rgba(255,255,255,0.14);color:white;border-color:rgba(255,255,255,0.35);}
        .add-btn{background:linear-gradient(135deg,rgba(255,255,255,0.15),rgba(255,255,255,0.05));border:1px solid rgba(255,255,255,0.22);color:white;padding:11px 28px;border-radius:24px;cursor:pointer;font-family:'Jost',sans-serif;font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:300;transition:all 0.22s;}
        .add-btn:hover{background:rgba(255,255,255,0.2);border-color:rgba(255,255,255,0.48);}
        .add-btn:disabled{opacity:0.28;cursor:not-allowed;}
        .edit-btn{background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.18);color:rgba(255,255,255,0.7);padding:8px 20px;border-radius:20px;cursor:pointer;font-family:'Jost',sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;transition:all 0.2s;}
        .edit-btn:hover{background:rgba(255,255,255,0.14);color:white;}
        .delete-btn{background:rgba(255,60,60,0.1);border:1px solid rgba(255,80,80,0.3);color:rgba(255,120,120,0.8);padding:8px 20px;border-radius:20px;cursor:pointer;font-family:'Jost',sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;transition:all 0.2s;}
        .delete-btn:hover{background:rgba(255,60,60,0.22);color:rgb(255,160,160);}
        .delete-confirm-btn{background:rgba(255,40,40,0.3);border:1px solid rgba(255,80,80,0.6);color:white;padding:8px 20px;border-radius:20px;cursor:pointer;font-family:'Jost',sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;}
        .add-trigger{background:transparent;border:1px dashed rgba(255,255,255,0.22);color:rgba(255,255,255,0.42);padding:6px 16px;border-radius:20px;cursor:pointer;font-family:'Jost',sans-serif;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;transition:all 0.2s;}
        .add-trigger:hover,.add-trigger.open{border-color:rgba(255,255,255,0.48);color:white;background:rgba(255,255,255,0.06);}
        .search-wrap{position:relative;display:flex;align-items:center;}
        .search-icon{position:absolute;left:14px;color:rgba(255,255,255,0.28);font-size:14px;pointer-events:none;}
        .search-input{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:24px;color:white;padding:8px 36px 8px 38px;font-family:'Jost',sans-serif;font-size:13px;font-weight:300;outline:none;width:200px;transition:all 0.2s;}
        .search-input:focus{border-color:rgba(255,255,255,0.35);background:rgba(255,255,255,0.09);width:240px;}
        .search-input::placeholder{color:rgba(255,255,255,0.2);}
        .sort-select{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:20px;color:rgba(255,255,255,0.5);padding:8px 14px;font-family:'Jost',sans-serif;font-size:11px;letter-spacing:1px;outline:none;cursor:pointer;transition:border-color 0.2s;}
        .sort-select:focus{border-color:rgba(255,255,255,0.3);}
        .sort-select option{background:#16101f;color:white;}
        @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
        .success-msg{animation:fadeIn 0.3s ease;color:rgba(150,255,180,0.85);font-family:'Jost',sans-serif;font-size:12px;letter-spacing:2px;}
        .save-indicator{font-family:'Jost',sans-serif;font-size:10px;letter-spacing:2px;transition:opacity 0.3s;}
        .empty-state{grid-column:1/-1;text-align:center;padding:60px 20px;color:rgba(255,255,255,0.2);font-family:'Cormorant Garamond',serif;font-style:italic;font-size:22px;}
        input[type="color"]{-webkit-appearance:none;border:none;cursor:pointer;background:transparent;padding:0;}
        input[type="color"]::-webkit-color-swatch-wrapper{padding:0;}
        input[type="color"]::-webkit-color-swatch{border:none;border-radius:6px;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:2px;}
        @media(max-width:600px){
          .bottle-card{padding:14px 6px 12px;}
          .filter-btn{padding:5px 10px;font-size:10px;}
          .search-input{width:160px;}
          .search-input:focus{width:190px;}
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{ textAlign: "center", padding: "48px 24px 24px", borderBottom: "1px solid rgba(255,255,255,0.05)", position: "relative" }}>
        <button onClick={() => setView(v => v === "stats" ? "collection" : "stats")}
          style={{ position: "absolute", top: "20px", right: "20px", background: view === "stats" ? "rgba(255,255,255,0.1)" : "transparent", border: "1px solid rgba(255,255,255,0.18)", color: view === "stats" ? "white" : "rgba(255,255,255,0.38)", padding: "7px 16px", borderRadius: "20px", cursor: "pointer", fontFamily: "'Jost',sans-serif", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" }}
          onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.4)"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
          onMouseLeave={e => { if (view !== "stats") { e.currentTarget.style.color = "rgba(255,255,255,0.38)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; e.currentTarget.style.background = "transparent"; } }}>
          {view === "stats" ? "◈ Kollektion" : "◈ Statistiken"}
        </button>
        <div style={{ fontSize: "10px", letterSpacing: "6px", color: "rgba(255,255,255,0.28)", fontFamily: "'Jost',sans-serif", textTransform: "uppercase", marginBottom: "12px" }}>meine kollektion</div>
        <h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "clamp(34px,6vw,62px)", fontWeight: 300, letterSpacing: "4px", margin: 0, background: "linear-gradient(135deg,#fff 0%,rgba(255,255,255,0.55) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.1 }}>Nail Lacquer</h1>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: "italic", color: "rgba(255,255,255,0.28)", fontSize: "15px", marginTop: "7px", letterSpacing: "2px" }}>
          {polishes.filter(p => p.status === "ok").length} vorhanden · {polishes.reduce((a, p) => a + (p.count || 1), 0)} Flaschen gesamt
          {search && ` · ${filtered.length} Treffer`}
        </div>

        {/* Save indicator */}
        <div style={{ height: "20px", marginTop: "6px" }}>
          {saveStatus === "saving" && <span className="save-indicator" style={{ color: "rgba(255,255,255,0.3)" }}>● Speichert…</span>}
          {saveStatus === "saved"  && <span className="save-indicator" style={{ color: "rgba(150,255,180,0.6)" }}>✓ Gespeichert</span>}
          {saveStatus === "error"  && <span className="save-indicator" style={{ color: "rgba(255,120,120,0.7)" }}>✕ Fehler beim Speichern</span>}
          {saveStatus === "unauth" && <span className="save-indicator" style={{ color: "rgba(255,180,80,0.9)", cursor: "pointer" }} onClick={() => { setShowSettings(true); setSettingsInput(apiKey); }}>⚙ API-Schlüssel fehlt — hier eintragen</span>}
        </div>

        {/* Search + Sort */}
        <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginTop: "12px", flexWrap: "wrap", alignItems: "center" }}>
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input className="search-input" placeholder="Suchen…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: "12px", background: "transparent", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: "14px", lineHeight: 1 }}>×</button>}
          </div>
          <select className="sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: "6px", justifyContent: "center", marginTop: "14px", flexWrap: "wrap", padding: "0 12px" }}>
          <button className={`filter-btn ${activeFilter === "all" ? "active" : ""}`} onClick={() => setActiveFilter("all")}>◈ Alle</button>
          {usedFinishes.map(f => (
            <button key={f.value} className={`filter-btn ${activeFilter === f.value ? "active" : ""}`} onClick={() => setActiveFilter(f.value)}>
              {f.icon} {f.label}
            </button>
          ))}
          {polishes.some(p => p.status === "wish") && (
            <button className={`filter-btn ${activeFilter === "wish" ? "active" : ""}`} onClick={() => setActiveFilter("wish")} style={{ borderColor: "rgba(180,160,255,0.35)", color: activeFilter === "wish" ? "white" : "rgba(180,160,255,0.7)" }}>☆ Wunsch</button>
          )}
          {polishes.some(p => p.status === "empty" || p.status === "gone") && (
            <button className={`filter-btn ${activeFilter === "empty" ? "active" : ""}`} onClick={() => setActiveFilter("empty")}>○ Leer / Weg</button>
          )}
          {usedCustomCats.map(c => (
            <button key={c.id} className={`filter-btn custom-cat ${activeFilter === c.id ? "active" : ""}`} onClick={() => setActiveFilter(c.id)}>◆ {c.label}</button>
          ))}
        </div>

        {/* Brand filter */}
        {allBrands.length > 1 && (
          <div style={{ display: "flex", gap: "6px", justifyContent: "center", marginTop: "8px", flexWrap: "wrap", padding: "0 12px" }}>
            <span style={{ fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "2px", color: "rgba(255,255,255,0.2)", textTransform: "uppercase", alignSelf: "center", paddingRight: "4px" }}>Marke</span>
            <button className={`filter-btn ${activeBrand === null ? "active" : ""}`} onClick={() => setActiveBrand(null)}>◈ Alle</button>
            {allBrands.map(b => (
              <button key={b} className={`filter-btn ${activeBrand === b ? "active" : ""}`} onClick={() => setActiveBrand(activeBrand === b ? null : b)}>{b}</button>
            ))}
          </div>
        )}
      </div>

      {/* ── Stats Page ── */}
      {view === "stats" && <StatsPage polishes={polishes} customCats={customCats} />}

      {/* ── Collection View ── */}
      {view === "collection" && <>

      {/* ── Neuer Lack + Auswählen ── */}
      {editIdx === null && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "12px", padding: "28px 0 8px", flexWrap: "wrap" }}>
          <button
            onClick={() => { if (showAdd) setForm(EMPTY_FORM); setShowAdd(v => !v); setSelected(null); setBatchMode(false); setBatchSel(new Set()); }}
            style={{
              background: showAdd ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg,rgba(255,100,170,0.18),rgba(160,100,255,0.14))",
              border: `1px solid ${showAdd ? "rgba(255,255,255,0.18)" : "rgba(255,130,200,0.45)"}`,
              color: showAdd ? "rgba(255,255,255,0.45)" : "rgba(255,200,230,0.9)",
              padding: "13px 46px", borderRadius: "32px", cursor: "pointer",
              fontFamily: "'Jost',sans-serif", fontSize: "13px", letterSpacing: "4px", textTransform: "uppercase", transition: "all 0.25s",
            }}>
            {showAdd ? "✕ Schließen" : "+ Neuer Lack"}
          </button>
          {!showAdd && polishes.length > 0 && (
            <button
              onClick={() => { setBatchMode(v => !v); setBatchSel(new Set()); setSelected(null); }}
              style={{
                background: batchMode ? "rgba(180,160,255,0.12)" : "transparent",
                border: `1px solid ${batchMode ? "rgba(180,160,255,0.45)" : "rgba(255,255,255,0.18)"}`,
                color: batchMode ? "rgba(180,160,255,0.9)" : "rgba(255,255,255,0.35)",
                padding: "8px 20px", borderRadius: "20px", cursor: "pointer",
                fontFamily: "'Jost',sans-serif", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s",
              }}>
              {batchMode ? "✕ Abbrechen" : "◻ Auswählen"}
            </button>
          )}
        </div>
      )}

      {/* ── Add Form ── */}
      {showAdd && (
        <div className="slide-up" style={{ margin: "16px auto 28px", maxWidth: "560px", padding: "0 16px" }}>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "21px", fontWeight: 300, letterSpacing: "3px", marginBottom: "16px", color: "rgba(255,255,255,0.72)", paddingLeft: "4px" }}>Neuen Lack hinzufügen</div>
          <PolishForm form={form} setForm={setForm} customCats={customCats} allBrands={allBrands} allColors={allColors}
            onSubmit={handleAdd} submitLabel="+ Hinzufügen" onAddCategory={addCategory} onDeleteCategory={deleteCategory} success={addSuccess} />
        </div>
      )}

      {/* ── Edit Form ── */}
      {editIdx !== null && editForm && !showAdd && (
        <div className="slide-up" style={{ margin: "28px auto", maxWidth: "560px", padding: "0 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", paddingLeft: "4px", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "21px", fontWeight: 300, letterSpacing: "3px", color: "rgba(255,255,255,0.72)" }}>Lack bearbeiten</div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {!confirmDelete ? (
                <button className="delete-btn" onClick={() => setConfirmDelete(true)}>✕ Löschen</button>
              ) : (
                <>
                  <span style={{ fontFamily: "'Jost',sans-serif", fontSize: "11px", color: "rgba(255,150,150,0.8)" }}>Wirklich löschen?</span>
                  <button className="delete-confirm-btn" onClick={handleDelete}>Ja, löschen</button>
                  <button className="add-trigger" onClick={() => setConfirmDelete(false)}>Nein</button>
                </>
              )}
            </div>
          </div>
          <PolishForm form={editForm} setForm={setEditForm} customCats={customCats} allBrands={allBrands} allColors={allColors}
            onSubmit={handleSave} submitLabel="✓ Speichern"
            onCancel={() => { setEditIdx(null); setEditForm(null); setConfirmDelete(false); }}
            onAddCategory={addCategory} onDeleteCategory={deleteCategory} success={editSuccess} />
        </div>
      )}

      {/* ── Detail panel ── */}
      {sel && !showAdd && editIdx === null && !batchMode && (
        <div className="slide-up" style={{ margin: "24px auto", maxWidth: "520px", padding: "0 16px" }}>
          <div style={{ background: `linear-gradient(135deg,${sel.color}20 0%,${sel.color}07 100%)`, border: `1px solid ${sel.color}40`, borderRadius: "20px", padding: "22px 26px", position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
              <NailBottle color={sel.color} finish={sel.finish} selected={true} status={sel.status} brand={sel.brand} />
              <div style={{ flex: 1 }}>
                {sel.brand && <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "3px", color: "rgba(255,255,255,0.28)", marginBottom: "2px", textTransform: "uppercase" }}>{sel.brand}</div>}
                {sel.num   && <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "11px", letterSpacing: "4px", color: "rgba(255,255,255,0.38)", marginBottom: "5px" }}>№ {sel.num}</div>}
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "25px", fontWeight: 400, lineHeight: 1.2, marginBottom: "7px" }}>{sel.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "9px", marginTop: "8px", flexWrap: "wrap" }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: sel.color, boxShadow: `0 0 12px ${sel.color}88`, border: "2px solid rgba(255,255,255,0.18)", flexShrink: 0 }} />
                  <span style={{ fontFamily: "'Jost',sans-serif", fontSize: "11px", color: "rgba(255,255,255,0.38)", letterSpacing: "1px" }}>
                    {sel.color.toUpperCase()} · {getPolishLabel(sel)}{sel.count ? ` · ×${sel.count}` : ""}
                  </span>
                </div>
                <div style={{ marginTop: "10px" }}>
                  <span style={{ fontFamily: "'Jost',sans-serif", fontSize: "11px", letterSpacing: "1.5px", color: statusObj(sel).color, background: "rgba(255,255,255,0.05)", border: `1px solid ${statusObj(sel).color}55`, borderRadius: "12px", padding: "3px 12px" }}>
                    {statusObj(sel).label}
                  </span>
                </div>
                {(sel.categories || []).length > 0 && (
                  <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "10px" }}>
                    {(sel.categories || []).map(cid => {
                      const cat = customCats.find(c => c.id === cid);
                      return cat ? <span key={cid} style={{ fontFamily: "'Jost',sans-serif", fontSize: "10px", color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.07)", borderRadius: "10px", padding: "3px 10px", border: "1px solid rgba(255,255,255,0.1)" }}>◆ {cat.label}</span> : null;
                    })}
                  </div>
                )}
                {sel.notes && (
                  <div style={{ marginTop: "12px", fontFamily: "'Jost',sans-serif", fontSize: "12px", color: "rgba(255,255,255,0.35)", lineHeight: "1.6", fontStyle: "italic", borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: "10px" }}>
                    {sel.notes}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "18px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <button className="edit-btn" onClick={() => openEdit(selected)}>✎ Bearbeiten</button>
            </div>
            <button onClick={() => setSelected(null)} style={{ position: "absolute", top: "14px", right: "18px", background: "transparent", border: "none", color: "rgba(255,255,255,0.28)", cursor: "pointer", fontSize: "20px", lineHeight: 1 }}>×</button>
          </div>
        </div>
      )}

      {/* ── Grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: "14px", maxWidth: "1100px", margin: "0 auto", padding: "22px 18px 80px" }}>
        {filtered.length === 0 ? (
          <div className="empty-state">Keine Treffer{search ? ` für „${search}"` : ""}</div>
        ) : filtered.map((p) => {
          const globalIdx = polishes.indexOf(p);
          const st = statusObj(p);
          const isBatchSel = batchSel.has(globalIdx);
          return (
            <div key={`${p.name}-${globalIdx}`}
              className={`bottle-card ${!batchMode && selected === globalIdx ? "active" : ""} ${batchMode && isBatchSel ? "batch-selected" : ""}`}
              style={p.status !== "ok" && p.status !== "wish" ? { borderColor: "rgba(255,255,255,0.04)" } : {}}
              onClick={() => {
                if (batchMode) { toggleBatch(globalIdx); return; }
                setShowAdd(false); setEditIdx(null); setEditForm(null);
                setSelected(selected === globalIdx ? null : globalIdx);
              }}>
              {batchMode ? (
                <div className={`batch-check ${isBatchSel ? "on" : ""}`}>{isBatchSel ? "✓" : ""}</div>
              ) : (
                p.count && <div className="count-badge">×{p.count}</div>
              )}
              {!batchMode && p.status !== "ok" && p.status !== "wish" && <div className="status-dot" style={{ background: st.color }} />}
              <NailBottle color={p.color} finish={p.finish} selected={!batchMode && selected === globalIdx} status={p.status} brand={p.brand} />
              <div style={{ textAlign: "center" }}>
                {p.brand && allBrands.length > 1 && <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "9px", letterSpacing: "2px", color: "rgba(255,255,255,0.2)", marginBottom: "2px", textTransform: "uppercase" }}>{p.brand}</div>}
                {p.num && <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "3px", color: "rgba(255,255,255,0.28)", marginBottom: "3px" }}>{p.num}</div>}
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "13px", fontWeight: 400, lineHeight: 1.3, color: p.status !== "ok" && p.status !== "wish" ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.83)", maxWidth: "110px" }}>{p.name}</div>
                {p.finish && p.finish !== "Classic" && <div style={{ fontSize: "10px", color: "rgba(255,220,100,0.55)", marginTop: "3px" }}>{FINISH_OPTIONS.find(f => f.value === p.finish)?.icon} {p.finish}</div>}
              </div>
            </div>
          );
        })}
      </div>

      </>}

      {/* ── Settings Panel ── */}
      {showSettings && (
        <div style={{ maxWidth: "480px", margin: "0 auto 20px", padding: "0 16px" }}>
          <div style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px", padding: "18px 20px" }}>
            <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "3px", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: "12px" }}>⚙ Einstellungen · API-Schlüssel</div>
            <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "11px", color: "rgba(255,255,255,0.3)", marginBottom: "10px", lineHeight: "1.6" }}>
              Den Schlüssel aus der Server-Konsole (Startausgabe des Dienstes) hier eintragen. Er wird lokal gespeichert.
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input type="password" className="form-input" placeholder="48-stelliger Hex-Schlüssel"
                value={settingsInput} onChange={e => setSettingsInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && saveApiKey()}
                style={{ flex: 1 }} />
              <button className="add-btn" onClick={saveApiKey} style={{ padding: "10px 18px", fontSize: "11px", whiteSpace: "nowrap" }}>Speichern</button>
              <button className="add-trigger" onClick={() => setShowSettings(false)}>✕</button>
            </div>
            {apiKey && <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "10px", color: "rgba(150,255,180,0.55)", marginTop: "10px", letterSpacing: "1px" }}>✓ Schlüssel gesetzt</div>}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{ textAlign: "center", padding: "0 0 20px", display: "flex", justifyContent: "center", gap: "14px", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "4px", color: "rgba(255,255,255,0.1)", textTransform: "uppercase" }}>Nail Lacquer Kollektion</span>
        <button onClick={exportData}
          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.2)", borderRadius: "14px", padding: "3px 12px", cursor: "pointer", fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" }}
          onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.55)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.2)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}>
          ↓ Export
        </button>
        <button onClick={() => importRef.current?.click()}
          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.2)", borderRadius: "14px", padding: "3px 12px", cursor: "pointer", fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" }}
          onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.55)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.2)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}>
          ↑ Import
        </button>
        <input ref={importRef} type="file" accept=".json" onChange={importData} style={{ display: "none" }} />
        <button
          onClick={() => { setShowSettings(v => !v); if (!showSettings) setSettingsInput(apiKey); }}
          style={{ background: showSettings ? "rgba(255,255,255,0.07)" : "transparent", border: `1px solid ${showSettings ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)"}`, color: showSettings ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)", borderRadius: "14px", padding: "3px 12px", cursor: "pointer", fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" }}
          onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.55)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; }}
          onMouseLeave={e => { if (!showSettings) { e.currentTarget.style.color = "rgba(255,255,255,0.2)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; } }}>
          {apiKey ? "⚙" : "⚙ Schlüssel fehlt"}
        </button>
      </div>

      <LogPanel apiKey={apiKey} />
      <UpdatePanel apiKey={apiKey} />

      {/* ── Undo Snackbar ── */}
      {undoEntry && (
        <div style={{ position: "fixed", bottom: batchMode && batchSel.size > 0 ? "80px" : "20px", left: "50%", transform: "translateX(-50%)", background: "rgba(16,10,28,0.97)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "30px", padding: "11px 20px", display: "flex", alignItems: "center", gap: "14px", zIndex: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.55)", whiteSpace: "nowrap" }}>
          <span style={{ fontFamily: "'Jost',sans-serif", fontSize: "12px", color: "rgba(255,255,255,0.55)", letterSpacing: "1px" }}>„{undoEntry.label}" gelöscht</span>
          <button onClick={undoDelete} style={{ background: "rgba(150,255,180,0.12)", border: "1px solid rgba(150,255,180,0.35)", color: "rgba(150,255,180,0.9)", borderRadius: "20px", padding: "5px 16px", cursor: "pointer", fontFamily: "'Jost',sans-serif", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase" }}>↩ Rückgängig</button>
        </div>
      )}

      {/* ── Batch Action Bar ── */}
      {batchMode && batchSel.size > 0 && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(12,8,22,0.97)", borderTop: "1px solid rgba(255,255,255,0.1)", padding: "14px 20px", display: "flex", justifyContent: "center", alignItems: "center", gap: "10px", flexWrap: "wrap", zIndex: 100, backdropFilter: "blur(10px)" }}>
          <span style={{ fontFamily: "'Jost',sans-serif", fontSize: "12px", color: "rgba(255,255,255,0.4)", letterSpacing: "2px", marginRight: "4px" }}>{batchSel.size} ausgewählt</span>
          {STATUS_OPTIONS.map(s => (
            <button key={s.value} onClick={() => batchSetStatus(s.value)}
              style={{ ...batchSmallBtn, borderColor: s.color.replace("0.7)", "0.35)"), color: s.color }}>
              {s.label}
            </button>
          ))}
          <button onClick={batchDelete} style={{ ...batchSmallBtn, borderColor: "rgba(255,80,80,0.45)", color: "rgba(255,120,120,0.85)" }}>✕ Löschen</button>
        </div>
      )}
    </div>
  );
}
