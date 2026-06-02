import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { THEMES } from "./themes.js";
import { FINISH_OPTIONS, STATUS_OPTIONS, SORT_OPTIONS, EMPTY_FORM } from "./constants.js";
import { hexToHue } from "./utils.js";
import { NailBottle } from "./components/NailBottle.jsx";
import { PolishForm } from "./components/PolishForm.jsx";
import { StatsPage } from "./components/StatsPage.jsx";
import { LogPanel } from "./components/LogPanel.jsx";
import { UpdatePanel } from "./components/UpdatePanel.jsx";
import { SyncPanel } from "./components/SyncPanel.jsx";
import { DiaryPage } from "./components/DiaryPage.jsx";
import { StickerPage } from "./components/StickerPage.jsx";

const statusTextColor = (status, dark) => {
  if (dark) return (STATUS_OPTIONS.find(s => s.value === (status || "ok")) || STATUS_OPTIONS[0]).color;
  return { ok: "#1a6b2a", wish: "#4a3080", empty: "#7a5000", gone: "#8b1a1a" }[status || "ok"] || "#444444";
};

// BUG-4: Stable key for photoViewSet to avoid index-based bugs after sort/filter
const photoKey = (p) => `${p.createdAt || 0}:${p.name}:${p.brand || ""}`;

export default function App() {
  const [polishes, setPolishes]           = useState([]);
  const [customCats, setCustomCats]       = useState([]);
  const [loading, setLoading]             = useState(true);
  const [loadError, setLoadError]         = useState(null);   // UX-1
  const [loadTrigger, setLoadTrigger]     = useState(0);      // UX-1: retry trigger
  const [saveStatus, setSaveStatus]       = useState("idle");
  const [selected, setSelected]           = useState(null);
  const [activeFilter, setActiveFilter]   = useState("all");
  const [searchInput, setSearchInput]     = useState("");     // BUG-9: debounced input
  const [search, setSearch]               = useState("");
  const searchDebounceRef                 = useRef(null);
  const [sortBy, setSortBy]               = useState("newest");
  const [showAdd, setShowAdd]             = useState(false);
  const [form, setForm]                   = useState(EMPTY_FORM);
  const [addSuccess, setAddSuccess]       = useState(false);
  const [editIdx, setEditIdx]             = useState(null);
  const [editForm, setEditForm]           = useState(null);
  const [editSuccess, setEditSuccess]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeBrand, setActiveBrand]     = useState(null);
  const [view, setView]                   = useState(() => localStorage.getItem("nagellacke_view") || "collection");
  const [undoEntry, setUndoEntry]         = useState(null);
  const [batchMode, setBatchMode]         = useState(false);
  const [batchSel, setBatchSel]           = useState(new Set());
  const [showBatchMore, setShowBatchMore] = useState(false);
  const [batchBrandInput, setBatchBrandInput] = useState("");
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false); // UX-3
  const [importModal, setImportModal]     = useState(null);
  const [importError, setImportError]     = useState(null);   // BUG-12: replace alert
  const [toast, setToast]                 = useState(null);   // BUG-12: replace alert
  const [dupeWarning, setDupeWarning]     = useState(null);   // BUG-12: replace confirm
  const [manicures, setManicures]         = useState([]);
  const [stickers, setStickers]           = useState([]);
  const [photoViewSet, setPhotoViewSet]   = useState(new Set());
  const undoTimer                         = useRef(null);
  const importRef                         = useRef(null);
  const searchRef                         = useRef(null);
  const importModalRef                    = useRef(null);     // A11Y-2: focus management
  const [apiKey, setApiKey]               = useState(() => localStorage.getItem("nagellacke_api_key") || "");
  const [showSettings, setShowSettings]   = useState(false);
  const [settingsInput, setSettingsInput] = useState("");
  const [theme, setTheme]                 = useState(() => localStorage.getItem("nagellacke_theme") || "darkLuxury");
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  // UX-1: Data fetch with error state and retry support
  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    fetch("/api/data")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => {
        const ensureFields = (item, prefix) => {
          const now = Date.now();
          const needsId = !item.id;
          const needsUpdatedAt = !item.updatedAt;
          if (!needsId && !needsUpdatedAt) return { item, patched: false };
          return {
            item: {
              ...item,
              id: needsId ? `${prefix}-${item.createdAt || now}-${(item.name || item.label || '').replace(/\W/g, '').slice(0, 12)}-${Math.random().toString(36).slice(2, 6)}` : item.id,
              updatedAt: needsUpdatedAt ? (item.createdAt || now) : item.updatedAt,
            },
            patched: true,
          };
        };
        let anyPatched = false;
        const polishes   = (data.polishes   || []).map(p => { const r = ensureFields(p, 'p'); if (r.patched) anyPatched = true; return r.item; });
        const customCats = (data.customCats || []).map(p => { const r = ensureFields(p, 'c'); if (r.patched) anyPatched = true; return r.item; });
        const manicures  = (data.manicures  || []).map(p => { const r = ensureFields(p, 'm'); if (r.patched) anyPatched = true; return r.item; });
        const stickers   = (data.stickers   || []).map(p => { const r = ensureFields(p, 's'); if (r.patched) anyPatched = true; return r.item; });
        setPolishes(polishes);
        setCustomCats(customCats);
        setManicures(manicures);
        setStickers(stickers);
        if (anyPatched) {
          fetch("/api/data", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Api-Key": localStorage.getItem("nagellacke_api_key") || "" },
            body: JSON.stringify({ polishes, customCats, manicures, stickers }),
          }).catch(() => {});
        }
      })
      .catch(e => setLoadError(e.message || "Verbindungsfehler"))
      .finally(() => setLoading(false));
  }, [loadTrigger]);

  const saveToBackend = useCallback((newPolishes, newCats, newManicures, newStickers) => {
    setSaveStatus("saving");
    fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey || "" },
      body: JSON.stringify({ polishes: newPolishes, customCats: newCats, manicures: newManicures, stickers: newStickers ?? stickers }),
    })
      .then(r => {
        if (r.status === 401) { setSaveStatus("unauth"); setTimeout(() => setSaveStatus("idle"), 4000); return null; }
        return r.json();
      })
      .then(d => { if (!d) return; setSaveStatus("saved"); setTimeout(() => setSaveStatus("idle"), 1800); })
      .catch(() => { setSaveStatus("error"); setTimeout(() => setSaveStatus("idle"), 3000); });
  }, [apiKey, stickers]);

  const handleSyncComplete = useCallback((data) => {
    const p = data.polishes   || [];
    const c = data.customCats || [];
    const m = data.manicures  || [];
    const s = data.stickers   || [];
    setPolishes(p); setCustomCats(c); setManicures(m); setStickers(s);
    saveToBackend(p, c, m, s);
  }, [saveToBackend]);

  // BUG-1: Always pass stickers explicitly to prevent stale-closure data loss
  const updatePolishes = useCallback((np) => { setPolishes(np); saveToBackend(np, customCats, manicures, stickers); }, [customCats, manicures, stickers, saveToBackend]);
  const updateCats     = useCallback((nc) => { setCustomCats(nc); saveToBackend(polishes, nc, manicures, stickers); }, [polishes, manicures, stickers, saveToBackend]);

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
    if (sortBy === "newest") arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (sortBy === "oldest") arr.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (sortBy === "name")   arr.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === "brand")  arr.sort((a, b) => (a.brand || "").localeCompare(b.brand || ""));
    if (sortBy === "hue")    arr.sort((a, b) => hexToHue(a.color) - hexToHue(b.color));
    if (sortBy === "rating") arr.sort((a, b) => (b.rating || 0) - (a.rating || 0));
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
    if (activeFilter === "all")    return true;
    if (activeFilter === "wish")   return p.status === "wish";
    if (activeFilter === "empty")  return p.status === "empty" || p.status === "gone";
    if (activeFilter === "rated")  return (p.rating || 0) > 0;
    if (FINISH_OPTIONS.some(f => f.value === activeFilter)) return (p.finish || "Classic") === activeFilter;
    return (p.categories || []).includes(activeFilter);
  }), [sorted, search, activeFilter, activeBrand, customCats]);

  const sel = selected !== null ? polishes[selected] : null;

  // ── Toast helper (replaces window.alert) ──
  const showToast = useCallback((msg, duration = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(null), duration);
  }, []);

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
    saveToBackend(undoEntry.polishes, undoEntry.customCats, manicures, stickers);
    setUndoEntry(null);
    clearTimeout(undoTimer.current);
  };

  const saveApiKey = () => {
    localStorage.setItem("nagellacke_api_key", settingsInput);
    setApiKey(settingsInput);
    setShowSettings(false);
  };

  useEffect(() => { setBatchSel(new Set()); }, [activeFilter, activeBrand, sortBy]);

  useEffect(() => { localStorage.setItem("nagellacke_view", view); }, [view]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e) => setSystemPrefersDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "/" || e.key === "f") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "Escape") { setSelected(null); setShowAdd(false); setEditIdx(null); setEditForm(null); setShowSettings(false); setShowThemePicker(false); setImportModal(null); setDupeWarning(null); }
      if (e.key === "n" && !showAdd && editIdx === null && view === "collection") setShowAdd(true);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showAdd, editIdx, view]);

  // A11Y-2: Move focus into import modal when it opens
  useEffect(() => {
    if (importModal && importModalRef.current) {
      importModalRef.current.focus();
    }
  }, [importModal]);

  // ── CRUD ──
  const handleAdd = (formData) => {
    if (!formData.name.trim()) return;
    const newHue = hexToHue(formData.color);
    const newFinish = formData.finish || "Classic";
    const dupe = polishes.find(p => { const d = Math.abs(hexToHue(p.color) - newHue); return Math.min(d, 360 - d) < 15 && (p.finish || "Classic") === newFinish; });
    // BUG-12: Replace window.confirm with inline dupe warning
    if (dupe) {
      setDupeWarning({ formData, dupe });
      return;
    }
    commitAdd(formData);
  };

  const commitAdd = (formData) => {
    setDupeWarning(null);
    const now = Date.now();
    const newPolishes = [...polishes, {
      id: `p-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: formData.name.trim(), brand: formData.brand.trim() || undefined,
      color: formData.color, finish: formData.finish,
      categories: formData.categories, status: formData.status,
      createdAt: now, updatedAt: now,
      ...(formData.num.trim()          && { num:   formData.num.trim() }),
      ...(parseInt(formData.count) > 1 && { count: parseInt(formData.count) }),
      ...(formData.notes.trim()        && { notes: formData.notes.trim() }),
      ...(formData.rating > 0          && { rating: formData.rating }),
      ...(formData.photo               && { photo: formData.photo }),
    }];
    updatePolishes(newPolishes);
    setForm(EMPTY_FORM);
    setAddSuccess(true);
    setTimeout(() => setAddSuccess(false), 2200);
  };

  const openEdit = (idx) => {
    const p = polishes[idx];
    setEditIdx(idx);
    setEditForm({ num: p.num || "", name: p.name, brand: p.brand || "", color: p.color, finish: p.finish || "Classic", count: p.count || 1, categories: [...(p.categories || [])], status: p.status || "ok", notes: p.notes || "", rating: p.rating || 0, photo: p.photo || null });
    setConfirmDelete(false);
    setEditSuccess(false);
  };

  const handleSave = () => {
    if (!editForm.name.trim()) return;
    const cnt = parseInt(editForm.count);
    const oldPhoto = polishes[editIdx]?.photo;
    // BUG-11: Add .catch on fire-and-forget photo delete
    if (oldPhoto && oldPhoto !== editForm.photo) {
      fetch(`/api/photos/${oldPhoto}`, { method: "DELETE", headers: { "X-Api-Key": apiKey || "" } })
        .catch(e => console.error("Foto-Löschung fehlgeschlagen:", e));
    }
    const newPolishes = polishes.map((p, i) => i !== editIdx ? p : {
      ...p, name: editForm.name.trim(), brand: editForm.brand.trim() || undefined,
      color: editForm.color, finish: editForm.finish,
      categories: editForm.categories, status: editForm.status,
      updatedAt: Date.now(),
      ...(editForm.num.trim()   ? { num: editForm.num.trim() }   : { num: undefined }),
      ...(editForm.notes.trim() ? { notes: editForm.notes.trim() } : { notes: undefined }),
      count: cnt > 1 ? cnt : undefined,
      rating: editForm.rating > 0 ? editForm.rating : undefined,
      photo: editForm.photo || undefined,
    });
    updatePolishes(newPolishes);
    setEditSuccess(true);
    setTimeout(() => { setEditSuccess(false); setEditIdx(null); setEditForm(null); }, 1500);
  };

  const handleDelete = () => {
    const deletedPhoto = polishes[editIdx]?.photo;
    // BUG-11: Add .catch on fire-and-forget photo delete
    if (deletedPhoto) {
      fetch(`/api/photos/${deletedPhoto}`, { method: "DELETE", headers: { "X-Api-Key": apiKey || "" } })
        .catch(e => console.error("Foto-Löschung fehlgeschlagen:", e));
    }
    triggerUndo({ polishes, customCats }, polishes[editIdx]?.name || "Lack");
    updatePolishes(polishes.filter((_, i) => i !== editIdx));
    setEditIdx(null); setEditForm(null); setSelected(null); setConfirmDelete(false);
  };

  // BUG-4: photoViewSet uses stable string keys instead of mutable array indices
  const togglePhotoView = (key) => setPhotoViewSet(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const handleAddManicure = (entry) => {
    const now = Date.now();
    const m = { ...entry, id: `m-${now}-${Math.random().toString(36).slice(2)}`, createdAt: now, updatedAt: now };
    const next = [m, ...manicures];
    setManicures(next);
    saveToBackend(polishes, customCats, next, stickers);
  };

  const handleSaveManicure = (id, entry) => {
    const next = manicures.map(m => m.id === id ? { ...m, ...entry, updatedAt: Date.now() } : m);
    setManicures(next);
    saveToBackend(polishes, customCats, next, stickers);
  };

  const handleDeleteManicure = (id) => {
    const entry = manicures.find(m => m.id === id);
    if (entry?.photo) {
      fetch(`/api/photos/${entry.photo}`, { method: "DELETE", headers: { "X-Api-Key": apiKey || "" } })
        .catch(e => console.error("Foto-Löschung fehlgeschlagen:", e));
    }
    const next = manicures.filter(m => m.id !== id);
    setManicures(next);
    saveToBackend(polishes, customCats, next, stickers);
  };

  // ── Stickers ──
  const handleAddSticker = (s) => {
    const now = Date.now();
    const next = [{ ...s, id: `s-${now}-${Math.random().toString(36).slice(2, 8)}`, createdAt: now, updatedAt: now }, ...stickers];
    setStickers(next);
    saveToBackend(polishes, customCats, manicures, next);
  };

  const handleSaveSticker = (idx, s) => {
    const old = stickers[idx];
    if (old.photo && old.photo !== s.photo) {
      fetch(`/api/photos/${old.photo}`, { method: "DELETE", headers: { "X-Api-Key": apiKey || "" } })
        .catch(e => console.error("Foto-Löschung fehlgeschlagen:", e));
    }
    const next = stickers.map((st, i) => i === idx ? { ...st, ...s, updatedAt: Date.now() } : st);
    setStickers(next);
    saveToBackend(polishes, customCats, manicures, next);
  };

  const handleDeleteSticker = (idx) => {
    if (stickers[idx]?.photo) {
      fetch(`/api/photos/${stickers[idx].photo}`, { method: "DELETE", headers: { "X-Api-Key": apiKey || "" } })
        .catch(e => console.error("Foto-Löschung fehlgeschlagen:", e));
    }
    const next = stickers.filter((_, i) => i !== idx);
    setStickers(next);
    saveToBackend(polishes, customCats, manicures, next);
  };

  // ── Categories ──
  const addCategory = (label) => {
    if (!label.trim()) return;
    if (customCats.some(c => c.label.toLowerCase() === label.trim().toLowerCase())) return;
    const now = Date.now();
    const id = label.trim().toLowerCase().replace(/\s+/g, "_") + "_" + now;
    updateCats([...customCats, { id, label: label.trim(), updatedAt: now }]);
  };

  const deleteCategory = (catId) => {
    const newCats     = customCats.filter(c => c.id !== catId);
    const newPolishes = polishes.map(p => ({ ...p, categories: (p.categories || []).filter(c => c !== catId) }));
    setPolishes(newPolishes);
    setCustomCats(newCats);
    saveToBackend(newPolishes, newCats, manicures, stickers);
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
    setBatchSel(new Set()); setBatchMode(false); setShowBatchMore(false); setBatchDeleteConfirm(false);
  };

  const batchSetStatus = (status) => {
    updatePolishes(polishes.map((p, i) => batchSel.has(i) ? { ...p, status, updatedAt: Date.now() } : p));
    setBatchSel(new Set()); setBatchMode(false); setShowBatchMore(false);
  };

  const batchSetBrand = (brand) => {
    if (!batchSel.size || !brand.trim()) return;
    updatePolishes(polishes.map((p, i) => batchSel.has(i) ? { ...p, brand: brand.trim(), updatedAt: Date.now() } : p));
    setBatchSel(new Set()); setBatchMode(false); setShowBatchMore(false); setBatchBrandInput("");
  };

  const batchSetFinish = (finish) => {
    if (!batchSel.size || !finish) return;
    updatePolishes(polishes.map((p, i) => batchSel.has(i) ? { ...p, finish, updatedAt: Date.now() } : p));
    setBatchSel(new Set()); setBatchMode(false); setShowBatchMore(false);
  };

  const batchAddCategory = (catId) => {
    if (!batchSel.size || !catId) return;
    updatePolishes(polishes.map((p, i) =>
      batchSel.has(i) && !(p.categories || []).includes(catId)
        ? { ...p, categories: [...(p.categories || []), catId], updatedAt: Date.now() }
        : p
    ));
    setBatchSel(new Set()); setBatchMode(false); setShowBatchMore(false);
  };

  // ── Export / Import ──
  const [exporting, setExporting] = useState(false);
  const exportData = async () => {
    if (exporting) return;
    setExporting(true);
    // Collect all photo filenames referenced anywhere
    const filenames = new Set([
      ...polishes.flatMap(p => p.photo ? [p.photo] : []),
      ...stickers.flatMap(s => s.photo ? [s.photo] : []),
      ...manicures.flatMap(m => [
        ...(m.photo  ? [m.photo]  : []),
        ...(Array.isArray(m.photos) ? m.photos : []),
      ]),
    ]);

    // Fetch each photo as base64 and embed it
    const photos = {};
    await Promise.all([...filenames].map(async (name) => {
      try {
        const res = await fetch(`/photos/${encodeURIComponent(name)}`);
        if (!res.ok) return;
        const buf   = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        // Chunk to avoid call-stack overflow on large files
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        const mime = res.headers.get("content-type") || "image/jpeg";
        photos[name] = `data:${mime};base64,${btoa(binary)}`;
      } catch { /* skip unreadable photos */ }
    }));

    const payload = { polishes, customCats, manicures, stickers, photos };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `nagellacke-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  };

  const importData = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        // BUG-12: Replace alert() with state-based error
        if (!Array.isArray(data.polishes)) {
          setImportError("Ungültige Datei — kein polishes-Array gefunden");
          setImportModal({ error: true });
          return;
        }
        const IMPORT_COLOR_RE = /^#[0-9a-f]{6}$/i;
        const IMPORT_STATUSES = new Set(["ok", "wish", "empty", "gone"]);
        // BUG-3: Validate more fields (brand, finish, count, rating)
        const IMPORT_FINISHES = new Set(FINISH_OPTIONS.map(f => f.value));
        const invalid = data.polishes.some(p =>
          !p || typeof p !== "object" ||
          typeof p.name !== "string" || !p.name.trim() ||
          (p.color  !== undefined && !IMPORT_COLOR_RE.test(p.color)) ||
          (p.status !== undefined && !IMPORT_STATUSES.has(p.status)) ||
          (p.brand  !== undefined && typeof p.brand !== "string") ||
          (p.finish !== undefined && !IMPORT_FINISHES.has(p.finish)) ||
          (p.count  !== undefined && (typeof p.count !== "number" || p.count < 1 || p.count > 999 || !Number.isInteger(p.count))) ||
          (p.rating !== undefined && (typeof p.rating !== "number" || p.rating < 0 || p.rating > 5))
        );
        if (invalid) {
          setImportError("Datei enthält ungültige Lack-Daten (Name, Farbe, Status oder andere Felder fehlerhaft)");
          setImportModal({ error: true });
          return;
        }
        setImportError(null);
        setImportModal({
          polishes:   data.polishes,
          customCats: Array.isArray(data.customCats) ? data.customCats : [],
          manicures:  Array.isArray(data.manicures)  ? data.manicures  : [],
          stickers:   Array.isArray(data.stickers)   ? data.stickers   : [],
          photos:     data.photos && typeof data.photos === "object" ? data.photos : {},
        });
      } catch {
        setImportError("Datei konnte nicht gelesen werden");
        setImportModal({ error: true });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Upload embedded photos from a backup and return a filename mapping old→new
  const uploadImportedPhotos = async (photos) => {
    const map = {};
    await Promise.all(Object.entries(photos || {}).map(async ([oldName, dataUrl]) => {
      try {
        const [header, b64] = dataUrl.split(",");
        const mimeType = header.match(/:(.*?);/)?.[1] || "image/jpeg";
        const res = await fetch("/api/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Api-Key": apiKey || "" },
          body: JSON.stringify({ data: b64, mimeType }),
        });
        if (res.ok) {
          const { filename } = await res.json();
          map[oldName] = filename;
        }
      } catch { /* skip failed uploads */ }
    }));
    return map;
  };

  const remapPhotos = (items, photoMap, field = "photo") =>
    items.map(item => {
      if (!item[field]) return item;
      const mapped = photoMap[item[field]];
      return mapped ? { ...item, [field]: mapped } : item;
    });

  const doImportReplace = async (data) => {
    const photoMap  = await uploadImportedPhotos(data.photos);
    const newPolishes  = remapPhotos(data.polishes,  photoMap);
    const newStickers  = remapPhotos(data.stickers,  photoMap);
    const newManicures = data.manicures.map(m => ({
      ...m,
      ...(m.photo  ? { photo:  photoMap[m.photo]  ?? m.photo  } : {}),
      ...(m.photos ? { photos: m.photos.map(f => photoMap[f] ?? f) } : {}),
    }));
    setPolishes(newPolishes);
    setCustomCats(data.customCats);
    setManicures(newManicures);
    setStickers(newStickers);
    saveToBackend(newPolishes, data.customCats, newManicures, newStickers);
    setImportModal(null);
    setImportError(null);
  };

  const doImportMerge = async (data) => {
    const photoMap = await uploadImportedPhotos(data.photos);
    // BUG-7: Case-insensitive deduplication for polishes
    const toAdd = remapPhotos(
      data.polishes.filter(imp =>
        !polishes.some(ex =>
          ex.name.toLowerCase() === imp.name.toLowerCase() &&
          (ex.brand || "").toLowerCase() === (imp.brand || "").toLowerCase()
        )
      ),
      photoMap,
    );
    const newPolishes = [...polishes, ...toAdd];
    // Merge manicures and stickers by id (no duplicates)
    const existingManiIds = new Set(manicures.map(m => m.id));
    const newManicures = [
      ...manicures,
      ...data.manicures
        .filter(m => !existingManiIds.has(m.id))
        .map(m => ({
          ...m,
          ...(m.photo  ? { photo:  photoMap[m.photo]  ?? m.photo  } : {}),
          ...(m.photos ? { photos: m.photos.map(f => photoMap[f] ?? f) } : {}),
        })),
    ];
    const existingStickerIds = new Set(stickers.map(s => s.id ?? s.name));
    const newStickers = [
      ...stickers,
      ...remapPhotos(
        data.stickers.filter(s => !existingStickerIds.has(s.id ?? s.name)),
        photoMap,
      ),
    ];
    setPolishes(newPolishes);
    setManicures(newManicures);
    setStickers(newStickers);
    saveToBackend(newPolishes, customCats, newManicures, newStickers);
    setImportModal(null);
    setImportError(null);
    if (toAdd.length === 0) showToast("Keine neuen Lacke gefunden — alle bereits vorhanden.");
    else showToast(`${toAdd.length} neue Lack${toAdd.length !== 1 ? "e" : ""} hinzugefügt.`);
  };

  const getPolishLabel = (p) => p.finish || "Classic";
  const statusObj = (p) => STATUS_OPTIONS.find(s => s.value === (p.status || "ok")) || STATUS_OPTIONS[0];

  const effectiveTheme = theme === "system" ? (systemPrefersDark ? "darkLuxury" : "cleanWhite") : theme;
  const t = THEMES[effectiveTheme] || THEMES.darkLuxury;

  // UX-1: Error state with retry button
  if (loadError) return (
    <div style={{ minHeight: "100vh", background: t.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "16px", padding: "20px" }}>
      <div style={{ fontFamily: t.fontBody, color: "rgba(255,120,120,0.8)", fontSize: "14px", letterSpacing: "2px", textAlign: "center" }}>
        ✕ Fehler beim Laden der Kollektion
      </div>
      <div style={{ fontFamily: t.fontBody, color: t.textVeryMuted, fontSize: "11px", letterSpacing: "1px" }}>{loadError}</div>
      <button
        onClick={() => { setLoadError(null); setLoadTrigger(t => t + 1); }}
        style={{ background: t.btnPrimaryBg, border: `1px solid ${t.btnPrimaryBorder || t.accent}`, color: t.btnPrimaryColor, padding: "10px 28px", borderRadius: t.btnPrimaryRadius, cursor: "pointer", fontFamily: t.fontBody, fontSize: "12px", letterSpacing: "3px", textTransform: "uppercase" }}>
        ↺ Erneut versuchen
      </button>
    </div>
  );

  // UX-2: Animated loading spinner
  if (loading) return (
    <div style={{ minHeight: "100vh", background: t.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
        <div style={{ width: 32, height: 32, border: `3px solid ${t.textFaint}`, borderTopColor: t.textMuted, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <div style={{ fontFamily: t.fontBody, color: t.textVeryMuted, fontSize: "11px", letterSpacing: "4px", textTransform: "uppercase" }}>Lade Kollektion…</div>
      </div>
    </div>
  );

  const batchSmallBtn = { background: "transparent", border: `1px solid ${t.filterBorder}`, color: t.textMuted, padding: "6px 14px", borderRadius: t.filterRadius, cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", transition: "all 0.2s" };

  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text }} lang="de">
      {/* A11Y-10: Visually-hidden live region for batch mode state */}
      <div aria-live="polite" aria-atomic="true"
           style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}>
        {batchMode ? `Auswahlmodus aktiv — ${batchSel.size} ausgewählt` : ""}
      </div>

      <style>{`
        @import url('${t.fontImport}');
        *{box-sizing:border-box;}
        .bottle-card{cursor:pointer;transition:transform 0.35s cubic-bezier(0.34,1.56,0.64,1),box-shadow 0.35s,border-color 0.2s,background 0.2s;display:flex;flex-direction:column;align-items:center;gap:10px;padding:20px 10px 16px;border-radius:${t.cardRadius};background:${t.cardBg};border:1px solid ${t.cardBorder};box-shadow:${t.cardShadow};position:relative;overflow:visible;}
        ${t.cardStyle==="row"
          ? `.bottle-card:hover{transform:none;background:${t.cardBgHover};border-color:${t.cardBorderHover};box-shadow:${t.cardShadowHover};}.bottle-card.active{transform:none;border-color:${t.cardBorderActive};background:${t.cardBgHover};}`
          : t.cardStyle==="stripe"
          ? `.bottle-card:hover{transform:scale(1.01);background:${t.cardBgHover};border-color:${t.cardBorderHover};box-shadow:${t.cardShadowHover};}.bottle-card.active{transform:scale(1.02);border-color:${t.cardBorderActive};}`
          : `.bottle-card:hover{transform:translateY(-10px) scale(1.03);background:${t.cardBgHover};border-color:${t.cardBorderHover};box-shadow:${t.cardShadowHover};}.bottle-card.active{transform:translateY(-14px) scale(1.06);border-color:${t.cardBorderActive};}`}
        .bottle-card.batch-selected{border-color:${t.cardBorderActive};background:${t.cardBgHover};}
        ${t.filterLayout==="underline"
          ? `.filter-btn{background:transparent;border:none;border-bottom:2px solid transparent;color:${t.filterColor};padding:6px 14px;border-radius:0;cursor:pointer;font-family:${t.fontBody};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;transition:all 0.2s;white-space:nowrap;}.filter-btn.active,.filter-btn:hover{background:transparent;color:${t.filterColorActive};border-bottom-color:${t.filterBorderActive};}.filter-btn.custom-cat{opacity:0.6;}`
          : t.filterLayout==="block"
          ? `.filter-btn{background:${t.filterBg};border:1px solid ${t.filterBorder};color:${t.filterColor};padding:5px 14px;border-radius:${t.filterRadius};cursor:pointer;font-family:${t.fontBody};font-size:10px;letter-spacing:3px;text-transform:uppercase;transition:all 0.1s;white-space:nowrap;}.filter-btn.active,.filter-btn:hover{background:${t.filterBgActive};color:${t.filterColorActive};border-color:${t.filterBorderActive};box-shadow:0 0 10px ${t.filterBorderActive}55;}.filter-btn.custom-cat{border-style:dashed;}`
          : `.filter-btn{background:${t.filterBg};border:1px solid ${t.filterBorder};color:${t.filterColor};padding:6px 16px;border-radius:${t.filterRadius};cursor:pointer;font-family:${t.fontBody};font-weight:300;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;transition:all 0.2s;white-space:nowrap;}.filter-btn.active,.filter-btn:hover{background:${t.filterBgActive};color:${t.filterColorActive};border-color:${t.filterBorderActive};}.filter-btn.custom-cat{border-style:dashed;}`}
        .count-badge{position:absolute;top:10px;right:10px;background:${t.filterBgActive};border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-family:${t.fontBody};color:${t.filterColorActive};}
        .status-dot{position:absolute;top:10px;left:10px;width:8px;height:8px;border-radius:50%;}
        .batch-check{position:absolute;top:8px;left:8px;width:20px;height:20px;border-radius:50%;border:1.5px solid ${t.cardBorderActive};background:transparent;display:flex;align-items:center;justify-content:center;font-size:11px;transition:all 0.15s;}
        .batch-check.on{background:${t.filterBgActive};border-color:${t.cardBorderActive};color:${t.filterColorActive};}
        @keyframes slideUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
        .slide-up{animation:slideUp 0.3s ease forwards;}
        .form-input{background:${t.inputBg};border:1px solid ${t.inputBorder};border-radius:${t.inputRadius};color:${t.inputColor};padding:10px 14px;font-family:${t.fontBody};font-size:14px;font-weight:300;outline:none;width:100%;transition:border-color 0.2s,background 0.2s,box-shadow 0.2s;}
        .form-input:focus{border-color:${t.inputBorderFocus};background:${t.inputBgFocus};}
        .form-input:focus-visible{border-color:${t.inputBorderFocus};background:${t.inputBgFocus};box-shadow:0 0 0 3px ${t.inputBorderFocus}88;}
        .form-input::placeholder{color:${t.inputPlaceholder};}
        :focus-visible{outline:3px solid ${t.inputBorderFocus};outline-offset:2px;}
        button:focus-visible,select:focus-visible{outline:3px solid ${t.inputBorderFocus};outline-offset:2px;border-radius:${t.filterRadius};}
        .form-label{font-family:${t.fontBody};font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${t.textVeryMuted};margin-bottom:6px;display:block;}
        .cat-chip{padding:5px 12px;border-radius:${t.chipRadius};cursor:pointer;font-family:${t.fontBody};font-size:11px;letter-spacing:1px;border:1px solid ${t.chipBorder};background:${t.chipBg};color:${t.chipColor};transition:all 0.18s;}
        .cat-chip.on{background:${t.chipBgOn};color:${t.chipColorOn};border-color:${t.chipBorderOn};}
        .add-btn{background:${t.btnPrimaryBg};border:1px solid ${t.btnPrimaryBorder};color:${t.btnPrimaryColor};padding:11px 28px;border-radius:${t.btnPrimaryRadius};cursor:pointer;font-family:${t.fontBody};font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:300;transition:all 0.22s;}
        .add-btn:hover{background:${t.btnPrimaryHoverBg};}
        .add-btn:disabled{opacity:0.28;cursor:not-allowed;}
        .edit-btn{background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.textMuted};padding:8px 20px;border-radius:${t.chipRadius};cursor:pointer;font-family:${t.fontBody};font-size:11px;letter-spacing:2px;text-transform:uppercase;transition:all 0.2s;}
        .edit-btn:hover{background:${t.inputBgFocus};color:${t.text};}
        .delete-btn{background:rgba(255,60,60,0.1);border:1px solid rgba(255,80,80,0.3);color:rgba(255,120,120,0.8);padding:8px 20px;border-radius:${t.chipRadius};cursor:pointer;font-family:${t.fontBody};font-size:11px;letter-spacing:2px;text-transform:uppercase;transition:all 0.2s;}
        .delete-btn:hover{background:rgba(255,60,60,0.22);color:rgb(255,160,160);}
        .delete-confirm-btn{background:rgba(255,40,40,0.3);border:1px solid rgba(255,80,80,0.6);color:white;padding:8px 20px;border-radius:${t.chipRadius};cursor:pointer;font-family:${t.fontBody};font-size:11px;letter-spacing:2px;text-transform:uppercase;}
        .add-trigger{background:transparent;border:1px dashed ${t.inputBorder};color:${t.textVeryMuted};padding:6px 16px;border-radius:${t.chipRadius};cursor:pointer;font-family:${t.fontBody};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;transition:all 0.2s;}
        .add-trigger:hover,.add-trigger.open{border-color:${t.inputBorderFocus};color:${t.text};background:${t.inputBg};}
        .search-wrap{position:relative;display:flex;align-items:center;}
        .search-icon{position:absolute;left:14px;color:${t.textVeryMuted};font-size:14px;pointer-events:none;}
        .search-input{background:${t.inputBg};border:1px solid ${t.inputBorder};border-radius:${t.btnPrimaryRadius};color:${t.inputColor};padding:8px 36px 8px 38px;font-family:${t.fontBody};font-size:13px;font-weight:300;outline:none;width:200px;transition:all 0.2s;}
        .search-input:focus{border-color:${t.inputBorderFocus};background:${t.inputBgFocus};width:240px;}
        .search-input:focus-visible{outline:3px solid ${t.inputBorderFocus};outline-offset:2px;}
        .search-input::placeholder{color:${t.inputPlaceholder};}
        .sort-select{background:${t.inputBg};border:1px solid ${t.inputBorder};border-radius:${t.chipRadius};color:${t.textMuted};padding:8px 14px;font-family:${t.fontBody};font-size:11px;letter-spacing:1px;outline:none;cursor:pointer;transition:border-color 0.2s;}
        .sort-select:focus{border-color:${t.inputBorderFocus};}
        .sort-select option{background:${t.sortOptionBg};color:${t.inputColor};}
        @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
        .success-msg{animation:fadeIn 0.3s ease;color:${t.dark ? "rgba(150,255,180,0.85)" : "#2a7a2a"};font-family:${t.fontBody};font-size:12px;letter-spacing:2px;}
        .save-indicator{font-family:${t.fontBody};font-size:10px;letter-spacing:2px;transition:opacity 0.3s;}
        .empty-state{grid-column:1/-1;text-align:center;padding:60px 20px;color:${t.textVeryMuted};font-family:${t.fontDisplay};font-style:italic;font-size:22px;}
        input[type="color"]{-webkit-appearance:none;border:none;cursor:pointer;background:transparent;padding:0;}
        input[type="color"]::-webkit-color-swatch-wrapper{padding:0;}
        input[type="color"]::-webkit-color-swatch{border:none;border-radius:6px;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-thumb{background:${t.scrollbarThumb};border-radius:2px;}
        .nav-btn{padding:7px 16px;font-size:11px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;transition:all 0.2s;white-space:nowrap;font-family:${t.fontBody};border-radius:${t.filterRadius};}
        .header-nav{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-left:auto;}
        @media(max-width:600px){
          .bottle-card{padding:14px 6px 12px;}
          .filter-btn{padding:5px 10px;font-size:10px;}
          .search-input{width:160px;}
          .search-input:focus{width:190px;}
          .nav-btn{padding:5px 9px;font-size:10px;letter-spacing:1px;}
          .header-nav{margin-left:0;width:100%;justify-content:flex-start;}
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{ textAlign: "center", padding: "0 24px 24px", borderBottom: `1px solid ${t.textFaint}` }}>

        {/* Controls row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "12px 0 0", gap: "8px", flexWrap: "wrap" }}>

        {/* Theme Switcher */}
        <div style={{ position: "relative", zIndex: 50, flexShrink: 0 }}>
          <button onClick={() => setShowThemePicker(v => !v)}
            aria-expanded={showThemePicker}
            aria-label="Theme auswählen"
            style={{ background: showThemePicker ? t.filterBgActive : t.filterBg, border: `1px solid ${t.filterBorder}`, color: showThemePicker ? t.filterColorActive : t.filterColor, padding: "7px 16px", borderRadius: t.filterRadius, fontFamily: t.fontBody, fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer", transition: "all 0.2s" }}>
            {t.icon} Theme
          </button>
          {showThemePicker && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, background: t.dark ? "rgba(10,5,20,0.97)" : t.cardBgHover, border: `1px solid ${t.cardBorder}`, borderRadius: t.cardRadius, padding: "8px", zIndex: 300, backdropFilter: "blur(12px)", display: "flex", flexDirection: "column", gap: "2px", minWidth: "170px", boxShadow: "0 8px 32px rgba(0,0,0,0.35)" }}>
              {Object.values(THEMES).map(th => (
                <button key={th.id}
                  onClick={() => { setTheme(th.id); localStorage.setItem("nagellacke_theme", th.id); setShowThemePicker(false); }}
                  style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", border: "none", borderRadius: "6px", cursor: "pointer", background: theme === th.id ? t.filterBgActive : "transparent", color: theme === th.id ? t.filterColorActive : t.textMuted, fontFamily: t.fontBody, fontSize: "12px", textAlign: "left", width: "100%", transition: "background 0.15s" }}>
                  <span style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                    {th.previewColors.map((c, i) => (
                      <span key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: c, border: "1px solid rgba(128,128,128,0.3)", display: "inline-block" }} />
                    ))}
                  </span>
                  {th.icon} {th.name}{theme === th.id ? " ✓" : ""}
                </button>
              ))}
              <button
                onClick={() => { setTheme("system"); localStorage.setItem("nagellacke_theme", "system"); setShowThemePicker(false); }}
                style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", border: "none", borderRadius: "6px", cursor: "pointer", background: theme === "system" ? t.filterBgActive : "transparent", color: theme === "system" ? t.filterColorActive : t.textMuted, fontFamily: t.fontBody, fontSize: "12px", textAlign: "left", width: "100%", transition: "background 0.15s" }}>
                <span style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#0a080f", border: "1px solid rgba(128,128,128,0.3)", display: "inline-block" }} />
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f4f4f4", border: "1px solid rgba(128,128,128,0.3)", display: "inline-block" }} />
                </span>
                ◑ System{theme === "system" ? " ✓" : ""}
              </button>
            </div>
          )}
        </div>

        {/* Nav */}
        <div className="header-nav">
          {[
            { id: "collection", label: "◈ Nagellack" },
            { id: "stickers",   label: "◈ Sticker" },
            { id: "stats",      label: "◈ Statistiken" },
            { id: "diary",      label: "◈ Tagebuch" },
          ].map(({ id, label }) => (
            <button key={id} className="nav-btn" onClick={() => setView(id)}
              aria-current={view === id ? "page" : undefined}
              style={{ background: view === id ? t.filterBgActive : t.filterBg, border: `1px solid ${t.filterBorder}`, color: view === id ? t.filterColorActive : t.filterColor, opacity: view === id ? 1 : 0.6 }}>
              {label}
            </button>
          ))}
        </div>

        </div>

        <div style={{ fontSize: "10px", letterSpacing: "6px", color: t.textVeryMuted, fontFamily: t.fontBody, textTransform: "uppercase", marginBottom: "12px", marginTop: "18px" }}>meine kollektion</div>
        <h1 style={t.id === "neonNightclub"
          ? { fontFamily: t.fontDisplay, fontSize: "clamp(44px,8vw,88px)", fontWeight: 400, letterSpacing: "10px", margin: 0, color: "#ff00e6", textShadow: "0 0 24px #ff00e660,0 0 48px #ff00e625", lineHeight: 1.1 }
          : t.dark
            ? { fontFamily: t.fontDisplay, fontSize: "clamp(34px,6vw,62px)", fontWeight: 300, letterSpacing: "4px", margin: 0, background: "linear-gradient(135deg,#fff 0%,rgba(255,255,255,0.55) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.1 }
            : { fontFamily: t.fontDisplay, fontSize: "clamp(34px,6vw,62px)", fontWeight: t.id === "cleanWhite" ? 600 : 400, letterSpacing: "3px", margin: 0, color: t.text, lineHeight: 1.1 }
        }>Nail Lacquer</h1>
        <div style={{ fontFamily: t.fontDisplay, fontStyle: "italic", color: t.textVeryMuted, fontSize: "15px", marginTop: "7px", letterSpacing: "2px" }}>
          {polishes.filter(p => p.status === "ok").length} vorhanden · {polishes.reduce((a, p) => a + (p.count || 1), 0)} Flaschen gesamt
          {search && ` · ${filtered.length} Treffer`}
        </div>

        {/* Save indicator */}
        <div role="status" aria-live="polite" aria-atomic="true" style={{ height: "20px", marginTop: "6px" }}>
          {saveStatus === "saving" && <span className="save-indicator" style={{ color: t.textVeryMuted }}>● Speichert…</span>}
          {saveStatus === "saved"  && <span className="save-indicator" style={{ color: t.dark ? "rgba(150,255,180,0.6)" : "#2a7a2a" }}>✓ Gespeichert</span>}
          {saveStatus === "error"  && <span className="save-indicator" style={{ color: "rgba(255,120,120,0.7)" }}>✕ Fehler beim Speichern</span>}
          {/* A11Y-13: Make "unauth" state a proper button */}
          {saveStatus === "unauth" && (
            <button className="save-indicator"
              onClick={() => { setShowSettings(true); setSettingsInput(apiKey); }}
              style={{ background: "none", border: "none", color: "rgba(255,180,80,0.9)", cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", padding: 0 }}>
              ⚙ API-Schlüssel fehlt — hier eintragen
            </button>
          )}
        </div>

        {view === "collection" && <>
          {/* Search + Sort */}
          <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginTop: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <div className="search-wrap">
              <span className="search-icon" aria-hidden="true">⌕</span>
              {/* BUG-9: Debounced search — searchInput drives display, search drives filter */}
              <input ref={searchRef} className="search-input" aria-label="Kollektion durchsuchen" placeholder="Suchen… (/)"
                value={searchInput}
                onChange={e => {
                  setSearchInput(e.target.value);
                  clearTimeout(searchDebounceRef.current);
                  searchDebounceRef.current = setTimeout(() => setSearch(e.target.value), 220);
                }} />
              {searchInput && (
                <button aria-label="Suche löschen" onClick={() => { setSearchInput(""); setSearch(""); clearTimeout(searchDebounceRef.current); }}
                  style={{ position: "absolute", right: "12px", background: "transparent", border: "none", color: t.textVeryMuted, cursor: "pointer", fontSize: "14px", lineHeight: 1 }}>×</button>
              )}
            </div>
            <select className="sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              {SORT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          {/* Filters */}
          <div style={{ display: "flex", gap: "6px", justifyContent: "center", marginTop: "14px", flexWrap: "wrap", padding: "0 12px" }}>
            <button aria-pressed={activeFilter === "all"} className={`filter-btn ${activeFilter === "all" ? "active" : ""}`} onClick={() => setActiveFilter("all")}>◈ Alle</button>
            {usedFinishes.map(f => (
              <button key={f.value} aria-pressed={activeFilter === f.value} className={`filter-btn ${activeFilter === f.value ? "active" : ""}`} onClick={() => setActiveFilter(f.value)}>
                {f.icon} {f.label}
              </button>
            ))}
            {polishes.some(p => p.status === "wish") && (
              <button aria-pressed={activeFilter === "wish"} className={`filter-btn ${activeFilter === "wish" ? "active" : ""}`} onClick={() => setActiveFilter("wish")}>☆ Wunsch</button>
            )}
            {polishes.some(p => p.status === "empty" || p.status === "gone") && (
              <button aria-pressed={activeFilter === "empty"} className={`filter-btn ${activeFilter === "empty" ? "active" : ""}`} onClick={() => setActiveFilter("empty")}>○ Leer / Weg</button>
            )}
            {polishes.some(p => (p.rating || 0) > 0) && (
              <button aria-pressed={activeFilter === "rated"} className={`filter-btn ${activeFilter === "rated" ? "active" : ""}`} onClick={() => setActiveFilter("rated")}>★ Bewertet</button>
            )}
            {usedCustomCats.map(c => (
              <button key={c.id} aria-pressed={activeFilter === c.id} className={`filter-btn custom-cat ${activeFilter === c.id ? "active" : ""}`} onClick={() => setActiveFilter(c.id)}>◆ {c.label}</button>
            ))}
          </div>

          {/* Brand filter */}
          {allBrands.length > 1 && (
            <div style={{ display: "flex", gap: "6px", justifyContent: "center", marginTop: "8px", flexWrap: "wrap", padding: "0 12px" }}>
              <span style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", color: t.textFaint, textTransform: "uppercase", alignSelf: "center", paddingRight: "4px" }}>Marke</span>
              <button aria-pressed={activeBrand === null} className={`filter-btn ${activeBrand === null ? "active" : ""}`} onClick={() => setActiveBrand(null)}>◈ Alle</button>
              {allBrands.map(b => (
                <button key={b} aria-pressed={activeBrand === b} className={`filter-btn ${activeBrand === b ? "active" : ""}`} onClick={() => setActiveBrand(activeBrand === b ? null : b)}>{b}</button>
              ))}
            </div>
          )}
        </>}
      </div>

      {/* ── Stats Page ── */}
      {view === "stats" && <main id="main-content"><StatsPage t={t} polishes={polishes} customCats={customCats}
        stickers={stickers} manicures={manicures}
        onSelectPolish={(idx) => { setView("collection"); setSelected(idx); }}
        onSelectStickers={() => setView("stickers")}
        onSelectDiary={() => setView("diary")} /></main>}

      {/* ── Diary Page ── */}
      {view === "diary" && <main id="main-content"><DiaryPage t={t} manicures={manicures} polishes={polishes} stickers={stickers}
        onAdd={handleAddManicure} onSave={handleSaveManicure} onDelete={handleDeleteManicure} apiKey={apiKey} /></main>}

      {/* ── Sticker Page ── */}
      {view === "stickers" && <main id="main-content"><StickerPage t={t} stickers={stickers}
        onAdd={handleAddSticker} onSave={handleSaveSticker} onDelete={handleDeleteSticker}
        apiKey={apiKey} /></main>}

      {/* ── Collection View ── */}
      {view === "collection" && <main id="main-content">

      {editIdx === null && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "12px", padding: "28px 0 8px", flexWrap: "wrap" }}>
          <button
            onClick={() => { if (showAdd) setForm(EMPTY_FORM); setShowAdd(v => !v); setSelected(null); setBatchMode(false); setBatchSel(new Set()); setShowBatchMore(false); }}
            style={{
              background: showAdd ? t.cardBg : t.btnPrimaryBg,
              border: `1px solid ${showAdd ? t.cardBorder : t.btnPrimaryBorder || t.accent}`,
              color: showAdd ? t.textMuted : t.btnPrimaryColor,
              padding: "13px 46px", borderRadius: t.btnPrimaryRadius, cursor: "pointer",
              fontFamily: t.fontBody, fontSize: "13px", letterSpacing: "4px", textTransform: "uppercase", transition: "all 0.25s",
            }}>
            {showAdd ? "✕ Schließen" : "+ Neuer Lack"}
          </button>
          {!showAdd && polishes.length > 0 && (
            <button
              onClick={() => { setBatchMode(v => !v); setBatchSel(new Set()); setSelected(null); setShowBatchMore(false); }}
              style={{
                background: batchMode ? t.filterBgActive : t.filterBg,
                border: `1px solid ${batchMode ? t.filterBorderActive : t.filterBorder}`,
                color: batchMode ? t.filterColorActive : t.filterColor,
                padding: "8px 20px", borderRadius: t.filterRadius, cursor: "pointer",
                fontFamily: t.fontBody, fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s",
              }}>
              {batchMode ? "✕ Abbrechen" : "◻ Auswählen"}
            </button>
          )}
        </div>
      )}

      {/* ── Add Form ── */}
      {showAdd && (
        <div className="slide-up" style={{ margin: "16px auto 28px", maxWidth: "560px", padding: "0 16px" }}>
          <div style={{ fontFamily: t.fontDisplay, fontSize: "21px", fontWeight: 300, letterSpacing: "3px", marginBottom: "16px", color: t.textMuted, paddingLeft: "4px" }}>Neuen Lack hinzufügen</div>

          {/* BUG-12: Inline dupe warning replaces window.confirm */}
          {dupeWarning && (
            <div style={{ marginBottom: "12px", background: "rgba(255,180,50,0.1)", border: "1px solid rgba(255,180,50,0.4)", borderRadius: t.cardRadius, padding: "12px 16px" }}>
              <div style={{ fontFamily: t.fontBody, fontSize: "12px", color: "rgba(255,200,80,0.9)", marginBottom: "8px" }}>
                Ähnlicher Lack vorhanden: „{[dupeWarning.dupe.brand, dupeWarning.dupe.name].filter(Boolean).join(" · ")}" (gleicher Finish, ähnliche Farbe)
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="add-btn" style={{ padding: "7px 18px", fontSize: "11px" }}
                  onClick={() => commitAdd(dupeWarning.formData)}>Trotzdem hinzufügen</button>
                <button className="add-trigger" onClick={() => setDupeWarning(null)}>Abbrechen</button>
              </div>
            </div>
          )}

          <PolishForm key="add" t={t} form={form} setForm={setForm} customCats={customCats} allBrands={allBrands} allColors={allColors}
            onSubmit={() => handleAdd(form)} submitLabel="+ Hinzufügen" onAddCategory={addCategory} onDeleteCategory={deleteCategory} success={addSuccess} apiKey={apiKey} />
        </div>
      )}

      {/* ── Edit Form ── */}
      {editIdx !== null && editForm && !showAdd && (
        <div className="slide-up" style={{ margin: "28px auto", maxWidth: "560px", padding: "0 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", paddingLeft: "4px", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ fontFamily: t.fontDisplay, fontSize: "21px", fontWeight: 300, letterSpacing: "3px", color: t.textMuted }}>Lack bearbeiten</div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {!confirmDelete ? (
                <button className="delete-btn" onClick={() => setConfirmDelete(true)}>✕ Löschen</button>
              ) : (
                <>
                  <span style={{ fontFamily: t.fontBody, fontSize: "11px", color: "rgba(255,150,150,0.8)" }}>Wirklich löschen?</span>
                  <button className="delete-confirm-btn" onClick={handleDelete}>Ja, löschen</button>
                  <button className="add-trigger" onClick={() => setConfirmDelete(false)}>Nein</button>
                </>
              )}
            </div>
          </div>
          <PolishForm key={`edit-${editIdx}`} t={t} form={editForm} setForm={setEditForm} customCats={customCats} allBrands={allBrands} allColors={allColors}
            onSubmit={handleSave} submitLabel="✓ Speichern"
            onCancel={() => { setEditIdx(null); setEditForm(null); setConfirmDelete(false); }}
            onAddCategory={addCategory} onDeleteCategory={deleteCategory} success={editSuccess} apiKey={apiKey} />
        </div>
      )}

      {/* ── Detail panel ── */}
      {sel && !showAdd && editIdx === null && !batchMode && (
        <div className="slide-up" style={{ margin: "24px auto", maxWidth: "520px", padding: "0 16px" }}>
          <div style={{ background: `linear-gradient(135deg,${sel.color}20 0%,${sel.color}07 100%)`, border: `1px solid ${sel.color}40`, borderRadius: t.cardRadius, padding: "22px 26px", position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
              <NailBottle color={sel.color} finish={sel.finish} selected={true} status={sel.status} brand={sel.brand} />
              <div style={{ flex: 1 }}>
                {sel.brand && <div style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "3px", color: t.textVeryMuted, marginBottom: "2px", textTransform: "uppercase" }}>{sel.brand}</div>}
                {sel.num   && <div style={{ fontFamily: t.fontBody, fontSize: "11px", letterSpacing: "4px", color: t.textMuted, marginBottom: "5px" }}>№ {sel.num}</div>}
                <div style={{ fontFamily: t.fontDisplay, fontSize: "25px", fontWeight: 400, lineHeight: 1.2, marginBottom: "7px", color: t.text }}>{sel.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "9px", marginTop: "8px", flexWrap: "wrap" }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: sel.color, boxShadow: `0 0 12px ${sel.color}88`, border: `2px solid ${t.cardBorderHover}`, flexShrink: 0 }}
                    title={sel.color.toUpperCase()} aria-label={`Farbe: ${sel.color.toUpperCase()}`} />
                  <span style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.textMuted, letterSpacing: "1px" }}>
                    {sel.color.toUpperCase()} · {getPolishLabel(sel)}{sel.count ? ` · ×${sel.count}` : ""}
                  </span>
                </div>
                <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: t.fontBody, fontSize: "11px", letterSpacing: "1.5px", color: statusTextColor(sel.status, t.dark), background: t.cardBg, border: `1px solid ${statusTextColor(sel.status, t.dark)}55`, borderRadius: t.chipRadius, padding: "3px 12px" }}>
                    {statusObj(sel).label}
                  </span>
                  {sel.rating > 0 && (
                    <span style={{ fontSize: "15px", color: t.accentText, letterSpacing: "2px" }} aria-label={`Bewertung: ${sel.rating} von 5`}>
                      {"★".repeat(sel.rating)}{"☆".repeat(5-sel.rating)}
                    </span>
                  )}
                </div>
                {(sel.categories || []).length > 0 && (
                  <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "10px" }}>
                    {(sel.categories || []).map(cid => {
                      const cat = customCats.find(c => c.id === cid);
                      return cat ? <span key={cid} style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.textVeryMuted, background: t.cardBg, borderRadius: t.chipRadius, padding: "3px 10px", border: `1px solid ${t.cardBorder}` }}>◆ {cat.label}</span> : null;
                    })}
                  </div>
                )}
                {sel.notes && (
                  <div style={{ marginTop: "12px", fontFamily: t.fontBody, fontSize: "12px", color: t.textMuted, lineHeight: "1.6", fontStyle: "italic", borderTop: `1px solid ${t.textFaint}`, paddingTop: "10px" }}>
                    {sel.notes}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "18px", paddingTop: "16px", borderTop: `1px solid ${t.textFaint}` }}>
              <button className="edit-btn" onClick={() => openEdit(selected)}>✎ Bearbeiten</button>
            </div>
            <button aria-label="Detail schließen" onClick={() => setSelected(null)} style={{ position: "absolute", top: "14px", right: "18px", background: "transparent", border: "none", color: t.textVeryMuted, cursor: "pointer", fontSize: "20px", lineHeight: 1 }}>×</button>
          </div>
        </div>
      )}

      {/* ── Grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: t.gridCols, gap: t.cardStyle === "row" ? "4px" : "14px", maxWidth: "1100px", margin: "0 auto", padding: "22px 18px 80px" }}>
        {filtered.length === 0 && polishes.length === 0 ? (
          /* UX-6: Empty state CTA when collection is empty */
          <div className="empty-state" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
            <div>Noch keine Lacke in der Kollektion</div>
            <button className="add-btn" style={{ fontSize: "12px", padding: "10px 24px" }}
              onClick={() => { setShowAdd(true); setSelected(null); setBatchMode(false); }}>
              + Ersten Lack hinzufügen
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">Keine Treffer{search ? ` für „${search}"` : ""}</div>
        ) : filtered.map((p) => {
          const globalIdx = polishes.indexOf(p);
          const pKey = photoKey(p);   // BUG-4: stable key
          const st = statusObj(p);
          const isBatchSel = batchSel.has(globalIdx);
          const cardKey = `${p.name}-${globalIdx}`;
          const cardClass = `bottle-card ${!batchMode && selected === globalIdx ? "active" : ""} ${batchMode && isBatchSel ? "batch-selected" : ""}`;
          const fadedStyle = p.status !== "ok" && p.status !== "wish" ? { borderColor: t.textFaint } : {};
          const cardClick = () => {
            if (batchMode) { toggleBatch(globalIdx); return; }
            setShowAdd(false); setEditIdx(null); setEditForm(null);
            setSelected(selected === globalIdx ? null : globalIdx);
          };
          // A11Y-1: Descriptive label for photo toggle button
          const photoToggleLabel = photoViewSet.has(pKey) ? "Farbkreis anzeigen" : "Foto anzeigen";

          if (t.cardStyle === "blob") return (
            <div key={cardKey} className={cardClass} style={fadedStyle} onClick={cardClick}>
              {batchMode
                ? <div className={`batch-check ${isBatchSel ? "on" : ""}`}>{isBatchSel ? "✓" : ""}</div>
                : (p.count ? <div className="count-badge">×{p.count}</div> : null)}
              {!batchMode && p.status !== "ok" && p.status !== "wish" && <div className="status-dot" style={{ background: st.color }} />}
              {!batchMode && p.photo && (
                <button aria-label={photoToggleLabel} onClick={e => { e.stopPropagation(); togglePhotoView(pKey); }}
                  style={{ position: "absolute", top: 4, right: p.count ? 30 : 4, background: "rgba(0,0,0,0.45)", border: "none", borderRadius: "50%", width: 20, height: 20, cursor: "pointer", fontSize: "10px", lineHeight: 1, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
                  {photoViewSet.has(pKey) ? "🎨" : "📷"}
                </button>
              )}
              {photoViewSet.has(pKey) && p.photo ? (
                <div style={{ width: 76, height: 76, borderRadius: "50%", overflow: "hidden", flexShrink: 0, boxShadow: `0 4px 24px ${p.color}88` }}>
                  <img src={`/photos/${p.photo}`} alt={`Foto von ${p.name}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              ) : (
                <div style={{ width: 76, height: 76, borderRadius: "50%", background: p.color, boxShadow: `0 4px 24px ${p.color}88`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", fontWeight: 800, color: "rgba(255,255,255,0.85)", fontFamily: t.fontDisplay, flexShrink: 0 }}>
                  {(p.brand || p.name || "?")[0].toUpperCase()}
                </div>
              )}
              <div style={{ textAlign: "center" }}>
                {p.brand && allBrands.length > 1 && <div style={{ fontFamily: t.fontBody, fontSize: "9px", letterSpacing: "2px", color: t.textFaint, marginBottom: "2px", textTransform: "uppercase" }}>{p.brand}</div>}
                <div style={{ fontFamily: t.fontDisplay, fontSize: "13px", fontWeight: 400, lineHeight: 1.3, color: p.status !== "ok" && p.status !== "wish" ? t.textVeryMuted : t.text, maxWidth: "105px" }}>{p.name}</div>
                {p.finish && p.finish !== "Classic" && <div style={{ fontSize: "11px", color: t.accentText, marginTop: "3px" }}>{FINISH_OPTIONS.find(f => f.value === p.finish)?.icon}</div>}
                {p.rating > 0 && <div style={{ fontSize: "9px", color: t.accentText, marginTop: "2px", letterSpacing: "1px" }}>{"★".repeat(p.rating)}{"☆".repeat(5-p.rating)}</div>}
              </div>
            </div>
          );

          if (t.cardStyle === "stripe") return (
            <div key={cardKey} className={cardClass}
              style={{ ...fadedStyle, flexDirection: "row", padding: 0, overflow: "hidden", gap: 0, alignItems: "stretch" }}
              onClick={cardClick}>
              <div style={{ width: 48, background: photoViewSet.has(pKey) && p.photo ? "transparent" : p.color, flexShrink: 0, position: "relative", minHeight: 76, overflow: "hidden" }}>
                {photoViewSet.has(pKey) && p.photo && (
                  <img src={`/photos/${p.photo}`} alt={`Foto von ${p.name}`} style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }} />
                )}
                {batchMode
                  ? <div className={`batch-check ${isBatchSel ? "on" : ""}`} style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}>{isBatchSel ? "✓" : ""}</div>
                  : (p.count ? <div style={{ position: "absolute", bottom: 6, left: 0, right: 0, textAlign: "center", fontSize: "9px", color: "rgba(255,255,255,0.8)", fontFamily: t.fontBody }}>×{p.count}</div> : null)}
                {!batchMode && p.status !== "ok" && p.status !== "wish" && <div style={{ position: "absolute", top: 6, left: 6, width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,0.65)" }} />}
                {!batchMode && p.photo && (
                  <button aria-label={photoToggleLabel} onClick={e => { e.stopPropagation(); togglePhotoView(pKey); }}
                    style={{ position: "absolute", bottom: 4, right: 4, background: "rgba(0,0,0,0.45)", border: "none", borderRadius: "50%", width: 16, height: 16, cursor: "pointer", fontSize: "8px", lineHeight: 1, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
                    {photoViewSet.has(pKey) ? "🎨" : "📷"}
                  </button>
                )}
              </div>
              <div style={{ padding: "14px 14px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3, minWidth: 0 }}>
                {p.brand && <div style={{ fontFamily: t.fontBody, fontSize: "9px", letterSpacing: "2px", color: t.textVeryMuted, textTransform: "uppercase" }}>{p.brand}</div>}
                {p.num && <div style={{ fontFamily: t.fontBody, fontSize: "9px", letterSpacing: "3px", color: t.textVeryMuted }}>№ {p.num}</div>}
                <div style={{ fontFamily: t.fontDisplay, fontSize: "15px", lineHeight: 1.3, color: p.status !== "ok" && p.status !== "wish" ? t.textVeryMuted : t.text }}>{p.name}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
                  {p.finish && p.finish !== "Classic" && <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.accentText }}>{FINISH_OPTIONS.find(f => f.value === p.finish)?.icon} {p.finish}</span>}
                  <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: statusTextColor(p.status, t.dark) }}>{st.label}</span>
                  {p.rating > 0 && <span style={{ fontSize: "9px", color: t.accentText, letterSpacing: "1px" }}>{"★".repeat(p.rating)}</span>}
                </div>
              </div>
            </div>
          );

          if (t.cardStyle === "row") return (
            <div key={cardKey} className={cardClass}
              style={{ ...fadedStyle, flexDirection: "row", padding: "11px 18px", alignItems: "center", gap: 14 }}
              onClick={cardClick}>
              {batchMode && <div className={`batch-check ${isBatchSel ? "on" : ""}`} style={{ position: "static" }}>{isBatchSel ? "✓" : ""}</div>}
              {photoViewSet.has(pKey) && p.photo ? (
                <div style={{ width: 20, height: 20, borderRadius: "50%", overflow: "hidden", flexShrink: 0, border: `1px solid ${t.cardBorderHover}` }}>
                  <img src={`/photos/${p.photo}`} alt={`Foto von ${p.name}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              ) : (
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: p.color, flexShrink: 0, border: `1px solid ${t.cardBorderHover}` }}
                  title={p.color.toUpperCase()} aria-label={`Farbe: ${p.color.toUpperCase()}`} />
              )}
              {!batchMode && p.photo && (
                <button aria-label={photoToggleLabel} onClick={e => { e.stopPropagation(); togglePhotoView(pKey); }}
                  style={{ background: "rgba(0,0,0,0.3)", border: "none", borderRadius: "50%", width: 16, height: 16, cursor: "pointer", fontSize: "8px", lineHeight: 1, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {photoViewSet.has(pKey) ? "🎨" : "📷"}
                </button>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: t.fontDisplay, fontSize: "14px", color: p.status !== "ok" && p.status !== "wish" ? t.textVeryMuted : t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                {(p.brand || p.num) && <div style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.textMuted }}>{[p.brand, p.num && `№ ${p.num}`].filter(Boolean).join(" · ")}</div>}
              </div>
              {p.finish && p.finish !== "Classic" && <span style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.accentText, flexShrink: 0, whiteSpace: "nowrap" }}>{FINISH_OPTIONS.find(f => f.value === p.finish)?.icon} {p.finish}</span>}
              {p.rating > 0 && <span style={{ fontSize: "10px", color: t.accentText, flexShrink: 0, letterSpacing: "1px" }}>{"★".repeat(p.rating)}</span>}
              <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: statusTextColor(p.status, t.dark), flexShrink: 0 }}>{st.label.replace(/^[✓☆○✕] /, "")}</span>
              {p.count && <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.textVeryMuted, flexShrink: 0 }}>×{p.count}</span>}
            </div>
          );

          return (
            <div key={cardKey} className={cardClass} style={fadedStyle} onClick={cardClick}>
              {batchMode
                ? <div className={`batch-check ${isBatchSel ? "on" : ""}`}>{isBatchSel ? "✓" : ""}</div>
                : (p.count ? <div className="count-badge">×{p.count}</div> : null)}
              {!batchMode && p.status !== "ok" && p.status !== "wish" && <div className="status-dot" style={{ background: st.color }} />}
              {!batchMode && p.photo && (
                <button aria-label={photoToggleLabel} onClick={e => { e.stopPropagation(); togglePhotoView(pKey); }}
                  style={{ position: "absolute", top: 4, right: p.count ? 30 : 4, background: "rgba(0,0,0,0.45)", border: "none", borderRadius: "50%", width: 20, height: 20, cursor: "pointer", fontSize: "10px", lineHeight: 1, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
                  {photoViewSet.has(pKey) ? "🎨" : "📷"}
                </button>
              )}
              <NailBottle color={p.color} finish={p.finish} selected={!batchMode && selected === globalIdx} status={p.status} brand={p.brand}
                photoUrl={photoViewSet.has(pKey) && p.photo ? `/photos/${p.photo}` : undefined} />
              <div style={{ textAlign: "center" }}>
                {p.brand && allBrands.length > 1 && <div style={{ fontFamily: t.fontBody, fontSize: "9px", letterSpacing: "2px", color: t.textFaint, marginBottom: "2px", textTransform: "uppercase" }}>{p.brand}</div>}
                {p.num && <div style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "3px", color: t.textVeryMuted, marginBottom: "3px" }}>{p.num}</div>}
                <div style={{ fontFamily: t.fontDisplay, fontSize: "13px", fontWeight: 400, lineHeight: 1.3, color: p.status !== "ok" && p.status !== "wish" ? t.textVeryMuted : t.text, maxWidth: "110px" }}>{p.name}</div>
                {p.finish && p.finish !== "Classic" && <div style={{ fontSize: "10px", color: t.accentText, marginTop: "3px" }}>{FINISH_OPTIONS.find(f => f.value === p.finish)?.icon} {p.finish}</div>}
                {p.rating > 0 && <div style={{ fontSize: "9px", color: t.accentText, marginTop: "2px", letterSpacing: "1px" }}>{"★".repeat(p.rating)}{"☆".repeat(5-p.rating)}</div>}
              </div>
            </div>
          );
        })}
      </div>

      </main>}

      {/* ── Settings Panel ── */}
      {showSettings && (
        <div style={{ maxWidth: "480px", margin: "0 auto 20px", padding: "0 16px" }}>
          <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: t.cardRadius, padding: "18px 20px" }}>
            <div style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "3px", textTransform: "uppercase", color: t.textVeryMuted, marginBottom: "12px" }}>⚙ Einstellungen · API-Schlüssel</div>
            <div style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.textVeryMuted, marginBottom: "10px", lineHeight: "1.6" }}>
              Den Schlüssel aus der Server-Konsole (Startausgabe des Dienstes) hier eintragen. Er wird lokal gespeichert.
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input type="password" className="form-input" placeholder="48-stelliger Hex-Schlüssel"
                aria-label="API-Schlüssel"
                value={settingsInput} onChange={e => setSettingsInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && saveApiKey()}
                style={{ flex: 1 }} />
              <button className="add-btn" onClick={saveApiKey} style={{ padding: "10px 18px", fontSize: "11px", whiteSpace: "nowrap" }}>Speichern</button>
              <button className="add-trigger" aria-label="Einstellungen schließen" onClick={() => setShowSettings(false)}>✕</button>
            </div>
            {apiKey && <div style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.dark ? "rgba(150,255,180,0.55)" : "#2a7a2a", marginTop: "10px", letterSpacing: "1px" }}>✓ Schlüssel gesetzt</div>}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{ textAlign: "center", padding: "0 0 20px", display: "flex", justifyContent: "center", gap: "14px", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "4px", color: t.textFaint, textTransform: "uppercase" }}>Nail Lacquer Kollektion</span>
        <button aria-label="Kollektion als JSON exportieren" onClick={exportData} disabled={exporting}
          style={{ background: "transparent", border: `1px solid ${t.cardBorder}`, color: t.textFaint, borderRadius: t.chipRadius, padding: "3px 12px", cursor: exporting ? "default" : "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s", opacity: exporting ? 0.5 : 1 }}
          onMouseEnter={e => { if (!exporting) { e.currentTarget.style.color = t.textMuted; e.currentTarget.style.borderColor = t.cardBorderHover; } }}
          onMouseLeave={e => { e.currentTarget.style.color = t.textFaint; e.currentTarget.style.borderColor = t.cardBorder; }}>
          {exporting ? "⟳ Exportiere…" : "↓ Export"}
        </button>
        <button aria-label="Kollektion aus JSON importieren" onClick={() => importRef.current?.click()}
          style={{ background: "transparent", border: `1px solid ${t.cardBorder}`, color: t.textFaint, borderRadius: t.chipRadius, padding: "3px 12px", cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" }}
          onMouseEnter={e => { e.currentTarget.style.color = t.textMuted; e.currentTarget.style.borderColor = t.cardBorderHover; }}
          onMouseLeave={e => { e.currentTarget.style.color = t.textFaint; e.currentTarget.style.borderColor = t.cardBorder; }}>
          ↑ Import
        </button>
        <input ref={importRef} type="file" accept=".json" onChange={importData} style={{ display: "none" }} tabIndex={-1} />
        <button
          aria-label={apiKey ? "Einstellungen öffnen" : "Einstellungen öffnen — API-Schlüssel fehlt"}
          aria-expanded={showSettings}
          onClick={() => { setShowSettings(v => !v); if (!showSettings) setSettingsInput(apiKey); }}
          style={{ background: showSettings ? t.cardBg : "transparent", border: `1px solid ${showSettings ? t.cardBorderHover : t.cardBorder}`, color: showSettings ? t.textMuted : t.textFaint, borderRadius: t.chipRadius, padding: "3px 12px", cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" }}
          onMouseEnter={e => { e.currentTarget.style.color = t.textMuted; e.currentTarget.style.borderColor = t.cardBorderHover; }}
          onMouseLeave={e => { if (!showSettings) { e.currentTarget.style.color = t.textFaint; e.currentTarget.style.borderColor = t.cardBorder; } }}>
          {apiKey ? "⚙" : "⚙ Schlüssel fehlt"}
        </button>
      </div>

      <SyncPanel
        t={t}
        polishes={polishes}
        customCats={customCats}
        manicures={manicures}
        stickers={stickers}
        onSyncComplete={handleSyncComplete}
      />
      <LogPanel t={t} apiKey={apiKey} />
      <UpdatePanel t={t} apiKey={apiKey} />

      {/* ── Toast (replaces window.alert) ── */}
      {toast && (
        <div role="status" aria-live="polite"
          style={{ position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)", background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: t.btnPrimaryRadius, padding: "10px 20px", zIndex: 250, boxShadow: "0 8px 32px rgba(0,0,0,0.45)", whiteSpace: "nowrap", fontFamily: t.fontBody, fontSize: "12px", color: t.textMuted, letterSpacing: "1px" }}>
          {toast}
        </div>
      )}

      {/* ── Undo Snackbar ── */}
      {undoEntry && (
        <div role="alert" aria-live="assertive" style={{ position: "fixed", bottom: batchMode && batchSel.size > 0 ? "80px" : "20px", left: "50%", transform: "translateX(-50%)", background: t.undoBg, border: `1px solid ${t.undoBorder}`, borderRadius: t.btnPrimaryRadius, padding: "11px 20px", display: "flex", alignItems: "center", gap: "14px", zIndex: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.55)", whiteSpace: "nowrap" }}>
          <span style={{ fontFamily: t.fontBody, fontSize: "12px", color: t.textMuted, letterSpacing: "1px" }}>„{undoEntry.label}" gelöscht</span>
          <button aria-label="Löschung rückgängig machen" onClick={undoDelete} style={{ background: t.filterBgActive, border: `1px solid ${t.filterBorderActive}`, color: t.filterColorActive, borderRadius: t.filterRadius, padding: "5px 16px", cursor: "pointer", fontFamily: t.fontBody, fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase" }}>↩ Rückgängig</button>
        </div>
      )}

      {/* ── Import Modal ── */}
      {/* A11Y-2: Proper dialog role, aria-modal, focus management */}
      {importModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
          onClick={e => { if (e.target === e.currentTarget) { setImportModal(null); setImportError(null); } }}>
          <div role="dialog" aria-modal="true" aria-labelledby="import-dialog-title"
            ref={importModalRef} tabIndex={-1}
            style={{ background: t.dark ? "rgba(16,10,28,0.98)" : t.cardBgHover, border: `1px solid ${t.cardBorder}`, borderRadius: t.cardRadius, padding: "28px 28px 24px", maxWidth: "380px", width: "100%", boxShadow: "0 16px 48px rgba(0,0,0,0.5)", outline: "none" }}>
            <div id="import-dialog-title" style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "3px", textTransform: "uppercase", color: t.textVeryMuted, marginBottom: "10px" }}>↑ Import</div>

            {importError ? (
              <>
                <div style={{ fontFamily: t.fontBody, fontSize: "13px", color: "rgba(255,120,120,0.9)", marginBottom: "16px", lineHeight: "1.5" }}>
                  ✕ {importError}
                </div>
                <button onClick={() => { setImportModal(null); setImportError(null); }}
                  style={{ background: "transparent", border: `1px solid ${t.cardBorder}`, color: t.textVeryMuted, padding: "9px 20px", borderRadius: t.btnPrimaryRadius, cursor: "pointer", fontFamily: t.fontBody, fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase" }}>
                  Schließen
                </button>
              </>
            ) : (
              <>
                <div style={{ fontFamily: t.fontDisplay, fontSize: "20px", color: t.text, marginBottom: "8px" }}>
                  {importModal.polishes?.length} Lack{importModal.polishes?.length !== 1 ? "e" : ""} in der Datei
                </div>
                <div style={{ fontFamily: t.fontBody, fontSize: "12px", color: t.textMuted, lineHeight: "1.6", marginBottom: "22px" }}>
                  Wie soll importiert werden?
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <button onClick={() => doImportMerge(importModal)}
                    style={{ background: t.btnPrimaryBg, border: `1px solid ${t.btnPrimaryBorder || t.accent}`, color: t.btnPrimaryColor, padding: "12px 20px", borderRadius: t.btnPrimaryRadius, cursor: "pointer", fontFamily: t.fontBody, fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", textAlign: "left", transition: "all 0.2s" }}>
                    ＋ Zusammenführen
                    <div style={{ fontSize: "10px", letterSpacing: "1px", opacity: 0.7, marginTop: "3px", textTransform: "none" }}>Neue Lacke hinzufügen, Duplikate überspringen</div>
                  </button>
                  <button onClick={() => doImportReplace(importModal)}
                    style={{ background: "transparent", border: `1px solid rgba(255,80,80,0.35)`, color: "rgba(255,120,120,0.85)", padding: "12px 20px", borderRadius: t.btnPrimaryRadius, cursor: "pointer", fontFamily: t.fontBody, fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", textAlign: "left", transition: "all 0.2s" }}>
                    ↺ Ersetzen
                    <div style={{ fontSize: "10px", letterSpacing: "1px", opacity: 0.7, marginTop: "3px", textTransform: "none" }}>Aktuelle Kollektion vollständig überschreiben</div>
                  </button>
                  <button onClick={() => { setImportModal(null); setImportError(null); }}
                    style={{ background: "transparent", border: `1px solid ${t.cardBorder}`, color: t.textVeryMuted, padding: "9px 20px", borderRadius: t.btnPrimaryRadius, cursor: "pointer", fontFamily: t.fontBody, fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" }}>
                    Abbrechen
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Batch Action Bar ── */}
      {batchMode && batchSel.size > 0 && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100, backdropFilter: "blur(10px)" }}>
          {/* Expanded "Mehr" section */}
          {showBatchMore && (
            <div style={{ background: t.batchBarBg, borderTop: `1px solid ${t.batchBarBorder}`, padding: "10px 20px", display: "flex", justifyContent: "center", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <input
                  className="form-input"
                  aria-label="Neue Marke für Auswahl"
                  placeholder="Marke setzen…"
                  value={batchBrandInput}
                  onChange={e => setBatchBrandInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && batchSetBrand(batchBrandInput)}
                  style={{ width: "150px", padding: "5px 10px", fontSize: "12px" }}
                />
                <button aria-label="Marke bestätigen" onClick={() => batchSetBrand(batchBrandInput)} style={{ ...batchSmallBtn, padding: "5px 12px" }}>✓</button>
              </div>
              <select className="sort-select" aria-label="Finish für Auswahl setzen"
                defaultValue=""
                onChange={e => { if (e.target.value) batchSetFinish(e.target.value); e.target.value = ""; }}>
                <option value="">Finish setzen…</option>
                {FINISH_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.icon} {f.label}</option>)}
              </select>
              {customCats.length > 0 && (
                <select className="sort-select" aria-label="Kategorie zur Auswahl hinzufügen"
                  defaultValue=""
                  onChange={e => { if (e.target.value) batchAddCategory(e.target.value); e.target.value = ""; }}>
                  <option value="">Kategorie hinzufügen…</option>
                  {customCats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              )}
            </div>
          )}
          {/* Main bar */}
          <div style={{ background: t.batchBarBg, borderTop: `1px solid ${t.batchBarBorder}`, padding: "14px 20px", display: "flex", justifyContent: "center", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ fontFamily: t.fontBody, fontSize: "12px", color: t.textMuted, letterSpacing: "2px", marginRight: "4px" }}>{batchSel.size} ausgewählt</span>
            {STATUS_OPTIONS.map(s => (
              <button key={s.value} onClick={() => batchSetStatus(s.value)}
                style={{ ...batchSmallBtn, borderColor: s.color.replace("0.7)", "0.35)"), color: s.color }}>
                {s.label}
              </button>
            ))}
            {/* UX-3: Batch delete confirmation replaces single-click delete */}
            {!batchDeleteConfirm ? (
              <button onClick={() => setBatchDeleteConfirm(true)}
                style={{ ...batchSmallBtn, borderColor: "rgba(255,80,80,0.45)", color: "rgba(255,120,120,0.85)" }}>
                ✕ Löschen
              </button>
            ) : (
              <>
                <span style={{ fontFamily: t.fontBody, fontSize: "11px", color: "rgba(255,150,150,0.9)", letterSpacing: "1px" }}>
                  Wirklich {batchSel.size} Lack{batchSel.size !== 1 ? "e" : ""} löschen?
                </span>
                <button onClick={batchDelete}
                  style={{ ...batchSmallBtn, background: "rgba(255,40,40,0.25)", borderColor: "rgba(255,80,80,0.6)", color: "rgba(255,160,160,0.95)" }}>
                  Ja, löschen
                </button>
                <button onClick={() => setBatchDeleteConfirm(false)} style={batchSmallBtn}>
                  Abbrechen
                </button>
              </>
            )}
            <button onClick={() => setShowBatchMore(v => !v)}
              style={{ ...batchSmallBtn, opacity: showBatchMore ? 1 : 0.65 }}>
              {showBatchMore ? "▲ Weniger" : "▼ Mehr"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
