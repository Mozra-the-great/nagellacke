import { useState, useMemo, useEffect, useCallback } from "react";

const BUILT_IN_FILTERS = [
  { id: "all",     label: "Alle",            icon: "◈" },
  { id: "shimmer", label: "Shimmer",         icon: "✨" },
  { id: "classic", label: "Classic",         icon: "●" },
  { id: "coat",    label: "Top / Base Coat", icon: "◻" },
  { id: "empty",   label: "Leer / Weg",      icon: "○" },
];

const STATUS_OPTIONS = [
  { value: "ok",    label: "✓ Vorhanden",      color: "rgba(150,255,180,0.7)" },
  { value: "empty", label: "○ Leer",           color: "rgba(255,200,80,0.7)" },
  { value: "gone",  label: "✕ Nicht mehr da",  color: "rgba(255,100,100,0.7)" },
];

function NailBottle({ color, shimmer, selected, status }) {
  const uid = useMemo(() => color.replace("#", "") + Math.random().toString(36).slice(2, 7), []);
  const gId = `g${uid}`, sId = `s${uid}`, glId = `gl${uid}`;
  const faded = status === "empty" || status === "gone";
  return (
    <svg width="64" height="130" viewBox="0 0 64 130" fill="none"
      style={{ filter: selected ? `drop-shadow(0 0 14px ${color}bb)` : "drop-shadow(0 4px 10px rgba(0,0,0,0.55))", transition: "filter 0.3s, opacity 0.3s", opacity: faded ? 0.38 : 1 }}>
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
      <rect x="15" y="48" width="10" height="40" rx="3" fill="white" fillOpacity="0.17" />
      <rect x="16" y="49" width="4" height="20" rx="2" fill="white" fillOpacity="0.24" />
      <rect x="10" y="108" width="44" height="16" rx="6" fill="black" fillOpacity="0.2" />
      <rect x="18" y="75" width="28" height="30" rx="2" fill="white" fillOpacity="0.11" />
      <text x="32" y="87" textAnchor="middle" fontSize="4" fill="white" fillOpacity="0.65" fontFamily="serif" letterSpacing="0.5">CATRICE</text>
      <line x1="20" y1="90" x2="44" y2="90" stroke="white" strokeOpacity="0.25" strokeWidth="0.5" />
      <text x="32" y="98" textAnchor="middle" fontSize="3.5" fill="white" fillOpacity="0.45" fontFamily="sans-serif">nail lacquer</text>
    </svg>
  );
}

const EMPTY_FORM = { num: "", name: "", color: "#ff6699", shimmer: false, count: 1, categories: [], status: "ok" };

function PolishForm({ form, setForm, customCats, onSubmit, submitLabel, onCancel, success }) {
  const toggleCat = (catId) => setForm(f => ({
    ...f,
    categories: f.categories.includes(catId) ? f.categories.filter(c => c !== catId) : [...f.categories, catId],
  }));
  return (
    <div style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "24px", padding: "26px 26px 22px" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
        <div style={{ textAlign: "center" }}>
          <NailBottle color={form.color} shimmer={form.shimmer} selected={false} status={form.status} />
          {form.name && (
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "13px", color: "rgba(255,255,255,0.65)", marginTop: "8px", maxWidth: "100px" }}>
              {form.num && <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "2px", color: "rgba(255,255,255,0.28)" }}>{form.num}</div>}
              {form.name}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
        <div>
          <label className="form-label">Name *</label>
          <input className="form-input" placeholder="z.B. Blue You A Kiss" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="form-label">Nummer</label>
          <input className="form-input" placeholder="z.B. 029" value={form.num} onChange={e => setForm(f => ({ ...f, num: e.target.value }))} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: "12px", marginBottom: "12px" }}>
        <div>
          <label className="form-label">Farbe</label>
          <div style={{ display: "flex", alignItems: "center", gap: "9px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "10px", padding: "8px 12px", height: "42px" }}>
            <div style={{ width: 22, height: 22, borderRadius: "5px", background: form.color, boxShadow: `0 0 8px ${form.color}88`, flexShrink: 0 }} />
            <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={{ width: "100%", height: "22px" }} />
          </div>
        </div>
        <div>
          <label className="form-label">Effekt</label>
          <button className={`toggle-btn ${form.shimmer ? "on" : ""}`} onClick={() => setForm(f => ({ ...f, shimmer: !f.shimmer }))}>
            {form.shimmer ? "✨ Shimmer" : "● Classic"}
          </button>
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
      <div style={{ marginBottom: "18px" }}>
        <label className="form-label">Kategorien</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
          <button className={`cat-chip ${form.categories.includes("coat") ? "on" : ""}`} onClick={() => toggleCat("coat")}>◻ Top / Base Coat</button>
          {customCats.map(c => (
            <button key={c.id} className={`cat-chip ${form.categories.includes(c.id) ? "on" : ""}`} onClick={() => toggleCat(c.id)}>◆ {c.label}</button>
          ))}
          {customCats.length === 0 && <span style={{ fontFamily: "'Jost',sans-serif", fontSize: "11px", color: "rgba(255,255,255,0.2)", alignSelf: "center" }}>Noch keine eigenen Kategorien</span>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <button className="add-btn" onClick={onSubmit} disabled={!form.name.trim()}>{submitLabel}</button>
        {onCancel && <button className="add-trigger" onClick={onCancel}>Abbrechen</button>}
        {success && <span className="success-msg">✓ Gespeichert!</span>}
      </div>
    </div>
  );
}

export default function App() {
  const [polishes, setPolishes]           = useState([]);
  const [customCats, setCustomCats]       = useState([]);
  const [loading, setLoading]             = useState(true);
  const [saveStatus, setSaveStatus]       = useState("idle"); // idle | saving | saved | error
  const [selected, setSelected]           = useState(null);
  const [activeFilter, setActiveFilter]   = useState("all");
  const [search, setSearch]               = useState("");
  const [showAdd, setShowAdd]             = useState(false);
  const [form, setForm]                   = useState(EMPTY_FORM);
  const [addSuccess, setAddSuccess]       = useState(false);
  const [editIdx, setEditIdx]             = useState(null);
  const [editForm, setEditForm]           = useState(null);
  const [editSuccess, setEditSuccess]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newCatInput, setNewCatInput]     = useState("");
  const [showCatInput, setShowCatInput]   = useState(false);

  // ── Load from backend on mount ──
  useEffect(() => {
    fetch("/api/data")
      .then(r => r.json())
      .then(data => {
        setPolishes(data.polishes || []);
        setCustomCats(data.customCats || []);
      })
      .catch(e => console.error("Load error:", e))
      .finally(() => setLoading(false));
  }, []);

  // ── Save to backend (debounced) ──
  const saveToBackend = useCallback((newPolishes, newCats) => {
    setSaveStatus("saving");
    fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ polishes: newPolishes, customCats: newCats }),
    })
      .then(r => r.json())
      .then(() => { setSaveStatus("saved"); setTimeout(() => setSaveStatus("idle"), 1800); })
      .catch(() => { setSaveStatus("error"); setTimeout(() => setSaveStatus("idle"), 3000); });
  }, []);

  const updatePolishes = (newPolishes) => { setPolishes(newPolishes); saveToBackend(newPolishes, customCats); };
  const updateCats = (newCats) => { setCustomCats(newCats); saveToBackend(polishes, newCats); };

  const allFilters = [...BUILT_IN_FILTERS, ...customCats.map(c => ({ id: c.id, label: c.label, icon: "◆", custom: true }))];

  const filtered = useMemo(() => polishes.filter(p => {
    const q = search.toLowerCase();
    if (q && !p.name.toLowerCase().includes(q) && !(p.num || "").includes(q)) return false;
    if (activeFilter === "all") return true;
    if (activeFilter === "shimmer") return !!p.shimmer;
    if (activeFilter === "classic") return !p.shimmer && !(p.categories || []).includes("coat") && p.status === "ok";
    if (activeFilter === "coat") return (p.categories || []).includes("coat");
    if (activeFilter === "empty") return p.status === "empty" || p.status === "gone";
    return (p.categories || []).includes(activeFilter);
  }), [polishes, customCats, search, activeFilter]);

  const sel = selected !== null ? polishes[selected] : null;

  const handleAdd = () => {
    if (!form.name.trim()) return;
    const newPolishes = [...polishes, {
      name: form.name.trim(), color: form.color, shimmer: form.shimmer,
      categories: form.categories, status: form.status,
      ...(form.num.trim() && { num: form.num.trim() }),
      ...(parseInt(form.count) > 1 && { count: parseInt(form.count) }),
    }];
    updatePolishes(newPolishes);
    setForm(EMPTY_FORM);
    setAddSuccess(true);
    setTimeout(() => setAddSuccess(false), 2200);
  };

  const openEdit = (idx) => {
    const p = polishes[idx];
    setEditIdx(idx);
    setEditForm({ num: p.num || "", name: p.name, color: p.color, shimmer: !!p.shimmer, count: p.count || 1, categories: [...(p.categories || [])], status: p.status || "ok" });
    setConfirmDelete(false);
    setEditSuccess(false);
  };

  const handleSave = () => {
    if (!editForm.name.trim()) return;
    const newPolishes = polishes.map((p, i) => i !== editIdx ? p : {
      ...p, name: editForm.name.trim(), color: editForm.color, shimmer: editForm.shimmer,
      categories: editForm.categories, status: editForm.status,
      ...(editForm.num.trim() ? { num: editForm.num.trim() } : { num: undefined }),
      count: parseInt(editForm.count) > 1 ? parseInt(editForm.count) : undefined,
    });
    updatePolishes(newPolishes);
    setEditSuccess(true);
    setTimeout(() => { setEditSuccess(false); setEditIdx(null); setEditForm(null); }, 1500);
  };

  const handleDelete = () => {
    updatePolishes(polishes.filter((_, i) => i !== editIdx));
    setEditIdx(null); setEditForm(null); setSelected(null); setConfirmDelete(false);
  };

  const handleAddCategory = () => {
    const label = newCatInput.trim();
    if (!label) return;
    const id = label.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now();
    updateCats([...customCats, { id, label }]);
    setNewCatInput(""); setShowCatInput(false);
  };

  const getPolishLabel = (p) => {
    if ((p.categories || []).includes("coat")) return "Top / Base Coat";
    if (p.shimmer) return "Shimmer";
    return "Classic";
  };

  const statusObj = (p) => STATUS_OPTIONS.find(s => s.value === (p.status || "ok")) || STATUS_OPTIONS[0];

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0a080f,#12091a)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: "'Georgia',serif", color: "rgba(255,255,255,0.3)", fontSize: "18px", letterSpacing: "4px" }}>Lade Kollektion…</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0a080f 0%,#12091a 50%,#080c18 100%)", color: "#fff" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Jost:wght@200;300;400&display=swap');
        *{box-sizing:border-box;}
        .bottle-card{cursor:pointer;transition:transform 0.35s cubic-bezier(0.34,1.56,0.64,1);display:flex;flex-direction:column;align-items:center;gap:10px;padding:20px 10px 16px;border-radius:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);position:relative;overflow:visible;}
        .bottle-card:hover{transform:translateY(-10px) scale(1.03);background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.15);}
        .bottle-card.active{transform:translateY(-14px) scale(1.06);border-color:rgba(255,255,255,0.3);}
        .filter-btn{background:transparent;border:1px solid rgba(255,255,255,0.18);color:rgba(255,255,255,0.45);padding:6px 16px;border-radius:20px;cursor:pointer;font-family:'Jost',sans-serif;font-weight:300;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;transition:all 0.2s;white-space:nowrap;}
        .filter-btn.active,.filter-btn:hover{background:rgba(255,255,255,0.1);color:white;border-color:rgba(255,255,255,0.4);}
        .filter-btn.custom-cat{border-style:dashed;}
        .count-badge{position:absolute;top:10px;right:10px;background:rgba(255,255,255,0.15);border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-family:'Jost',sans-serif;color:white;}
        .status-dot{position:absolute;top:10px;left:10px;width:8px;height:8px;border-radius:50%;}
        @keyframes slideUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
        .slide-up{animation:slideUp 0.3s ease forwards;}
        .form-input{background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.14);border-radius:10px;color:white;padding:10px 14px;font-family:'Jost',sans-serif;font-size:14px;font-weight:300;outline:none;width:100%;transition:border-color 0.2s;}
        .form-input:focus{border-color:rgba(255,255,255,0.38);background:rgba(255,255,255,0.1);}
        .form-input::placeholder{color:rgba(255,255,255,0.22);}
        .form-label{font-family:'Jost',sans-serif;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-bottom:6px;display:block;}
        .toggle-btn{padding:10px 16px;border-radius:10px;cursor:pointer;width:100%;font-family:'Jost',sans-serif;font-size:13px;font-weight:300;border:1px solid rgba(255,255,255,0.14);transition:all 0.2s;background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.4);}
        .toggle-btn.on{background:rgba(255,255,255,0.12);color:white;border-color:rgba(255,255,255,0.32);}
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
        .search-input{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:24px;color:white;padding:8px 36px 8px 38px;font-family:'Jost',sans-serif;font-size:13px;font-weight:300;outline:none;width:220px;transition:all 0.2s;}
        .search-input:focus{border-color:rgba(255,255,255,0.35);background:rgba(255,255,255,0.09);width:260px;}
        .search-input::placeholder{color:rgba(255,255,255,0.2);}
        @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
        .success-msg{animation:fadeIn 0.3s ease;color:rgba(150,255,180,0.85);font-family:'Jost',sans-serif;font-size:12px;letter-spacing:2px;}
        .save-indicator{font-family:'Jost',sans-serif;font-size:10px;letter-spacing:2px;transition:opacity 0.3s;}
        .empty-state{grid-column:1/-1;text-align:center;padding:60px 20px;color:rgba(255,255,255,0.2);font-family:'Cormorant Garamond',serif;font-style:italic;font-size:22px;}
        input[type="color"]{-webkit-appearance:none;border:none;cursor:pointer;background:transparent;padding:0;}
        input[type="color"]::-webkit-color-swatch-wrapper{padding:0;}
        input[type="color"]::-webkit-color-swatch{border:none;border-radius:6px;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:2px;}
      `}</style>

      {/* ── Header ── */}
      <div style={{ textAlign: "center", padding: "48px 24px 28px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ fontSize: "10px", letterSpacing: "6px", color: "rgba(255,255,255,0.28)", fontFamily: "'Jost',sans-serif", textTransform: "uppercase", marginBottom: "12px" }}>
          meine kollektion · catrice
        </div>
        <h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "clamp(34px,6vw,62px)", fontWeight: 300, letterSpacing: "4px", margin: 0, background: "linear-gradient(135deg,#fff 0%,rgba(255,255,255,0.55) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.1 }}>
          Nail Lacquer
        </h1>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: "italic", color: "rgba(255,255,255,0.28)", fontSize: "15px", marginTop: "7px", letterSpacing: "2px" }}>
          {polishes.filter(p => p.status === "ok").length} vorhanden · {polishes.reduce((a, p) => a + (p.count || 1), 0)} Flaschen gesamt
          {search && ` · ${filtered.length} Treffer`}
        </div>

        {/* Save indicator */}
        <div style={{ height: "20px", marginTop: "6px" }}>
          {saveStatus === "saving" && <span className="save-indicator" style={{ color: "rgba(255,255,255,0.3)" }}>● Speichert…</span>}
          {saveStatus === "saved"  && <span className="save-indicator" style={{ color: "rgba(150,255,180,0.6)" }}>✓ Gespeichert</span>}
          {saveStatus === "error"  && <span className="save-indicator" style={{ color: "rgba(255,120,120,0.7)" }}>✕ Fehler beim Speichern</span>}
        </div>

        {/* Search */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: "12px" }}>
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input className="search-input" placeholder="Suchen…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: "12px", background: "transparent", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: "14px", lineHeight: 1 }}>×</button>}
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: "6px", justifyContent: "center", marginTop: "14px", flexWrap: "wrap", padding: "0 12px" }}>
          {allFilters.map(f => (
            <button key={f.id} className={`filter-btn ${f.custom ? "custom-cat" : ""} ${activeFilter === f.id ? "active" : ""}`} onClick={() => setActiveFilter(f.id)}>
              {f.icon} {f.label}
            </button>
          ))}
          {showCatInput ? (
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <input className="form-input" placeholder="Kategorie-Name" value={newCatInput}
                onChange={e => setNewCatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAddCategory()}
                autoFocus style={{ width: "160px", padding: "5px 12px", fontSize: "12px", borderRadius: "20px" }} />
              <button className="add-trigger open" onClick={handleAddCategory} style={{ borderStyle: "solid" }}>✓</button>
              <button className="add-trigger" onClick={() => { setShowCatInput(false); setNewCatInput(""); }}>✕</button>
            </div>
          ) : (
            <button className="add-trigger" onClick={() => setShowCatInput(true)}>+ Kategorie</button>
          )}
          <button className={`add-trigger ${showAdd ? "open" : ""}`} onClick={() => { setShowAdd(v => !v); setSelected(null); setEditIdx(null); setEditForm(null); }}>
            {showAdd ? "✕ Schließen" : "+ Neuer Lack"}
          </button>
        </div>
      </div>

      {/* ── Add Form ── */}
      {showAdd && (
        <div className="slide-up" style={{ margin: "28px auto", maxWidth: "560px", padding: "0 16px" }}>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "21px", fontWeight: 300, letterSpacing: "3px", marginBottom: "16px", color: "rgba(255,255,255,0.72)", paddingLeft: "4px" }}>Neuen Lack hinzufügen</div>
          <PolishForm form={form} setForm={setForm} customCats={customCats} onSubmit={handleAdd} submitLabel="+ Hinzufügen" success={addSuccess} />
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
          <PolishForm form={editForm} setForm={setEditForm} customCats={customCats}
            onSubmit={handleSave} submitLabel="✓ Speichern"
            onCancel={() => { setEditIdx(null); setEditForm(null); setConfirmDelete(false); }} success={editSuccess} />
        </div>
      )}

      {/* ── Detail panel ── */}
      {sel && !showAdd && editIdx === null && (
        <div className="slide-up" style={{ margin: "24px auto", maxWidth: "520px", padding: "0 16px" }}>
          <div style={{ background: `linear-gradient(135deg,${sel.color}20 0%,${sel.color}07 100%)`, border: `1px solid ${sel.color}40`, borderRadius: "20px", padding: "22px 26px", position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
              <NailBottle color={sel.color} shimmer={sel.shimmer} selected={true} status={sel.status} />
              <div style={{ flex: 1 }}>
                {sel.num && <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "11px", letterSpacing: "4px", color: "rgba(255,255,255,0.38)", marginBottom: "5px" }}>№ {sel.num}</div>}
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
                {(sel.categories || []).filter(c => c !== "coat").length > 0 && (
                  <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "10px" }}>
                    {(sel.categories || []).filter(c => c !== "coat").map(cid => {
                      const cat = customCats.find(c => c.id === cid);
                      return cat ? <span key={cid} style={{ fontFamily: "'Jost',sans-serif", fontSize: "10px", color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.07)", borderRadius: "10px", padding: "3px 10px", border: "1px solid rgba(255,255,255,0.1)" }}>◆ {cat.label}</span> : null;
                    })}
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: "14px", maxWidth: "1100px", margin: "0 auto", padding: "22px 18px 60px" }}>
        {filtered.length === 0 ? (
          <div className="empty-state">Keine Treffer{search ? ` für „${search}"` : ""}</div>
        ) : filtered.map((p, i) => {
          const globalIdx = polishes.indexOf(p);
          const st = statusObj(p);
          return (
            <div key={`${p.name}-${globalIdx}`}
              className={`bottle-card ${selected === globalIdx ? "active" : ""}`}
              style={p.status !== "ok" ? { borderColor: "rgba(255,255,255,0.04)" } : {}}
              onClick={() => { setShowAdd(false); setEditIdx(null); setEditForm(null); setSelected(selected === globalIdx ? null : globalIdx); }}>
              {p.count && <div className="count-badge">×{p.count}</div>}
              {p.status !== "ok" && <div className="status-dot" style={{ background: st.color }} />}
              <NailBottle color={p.color} shimmer={p.shimmer} selected={selected === globalIdx} status={p.status} />
              <div style={{ textAlign: "center" }}>
                {p.num && <div style={{ fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "3px", color: "rgba(255,255,255,0.28)", marginBottom: "3px" }}>{p.num}</div>}
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "13px", fontWeight: 400, lineHeight: 1.3, color: p.status !== "ok" ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.83)", maxWidth: "110px" }}>{p.name}</div>
                {p.shimmer && <div style={{ fontSize: "10px", color: "rgba(255,220,100,0.55)", marginTop: "3px" }}>✨</div>}
                {(p.categories || []).includes("coat") && <div style={{ fontSize: "10px", color: "rgba(180,220,255,0.55)", marginTop: "2px" }}>◻ Coat</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ textAlign: "center", padding: "0 0 30px", fontFamily: "'Jost',sans-serif", fontSize: "10px", letterSpacing: "4px", color: "rgba(255,255,255,0.1)", textTransform: "uppercase" }}>
        Catrice · High Shine Gel Collection
      </div>
    </div>
  );
}
