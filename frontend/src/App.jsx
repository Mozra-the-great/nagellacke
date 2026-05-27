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
  { value: "rating", label: "Bewertung" },
];

const THEMES = {
  darkLuxury: {
    id: "darkLuxury", name: "Dark Luxury", icon: "🖤", dark: true,
    fontImport: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Jost:wght@200;300;400&display=swap",
    fontDisplay: "'Cormorant Garamond', serif", fontBody: "'Jost', sans-serif",
    bg: "linear-gradient(135deg,#0a080f 0%,#12091a 50%,#080c18 100%)",
    text: "#ffffff", textMuted: "rgba(255,255,255,0.55)",
    textVeryMuted: "rgba(255,255,255,0.28)", textFaint: "rgba(255,255,255,0.14)",
    cardBg: "rgba(255,255,255,0.03)", cardBorder: "rgba(255,255,255,0.06)",
    cardBgHover: "rgba(255,255,255,0.06)", cardBorderHover: "rgba(255,255,255,0.15)",
    cardBorderActive: "rgba(255,255,255,0.3)", cardRadius: "16px",
    cardShadow: "none", cardShadowHover: "none",
    filterBg: "transparent", filterBorder: "rgba(255,255,255,0.18)",
    filterColor: "rgba(255,255,255,0.45)", filterBgActive: "rgba(255,255,255,0.1)",
    filterBorderActive: "rgba(255,255,255,0.4)", filterColorActive: "white", filterRadius: "20px",
    inputBg: "rgba(255,255,255,0.07)", inputBorder: "rgba(255,255,255,0.14)",
    inputBorderFocus: "rgba(255,255,255,0.38)", inputBgFocus: "rgba(255,255,255,0.1)",
    inputColor: "white", inputPlaceholder: "rgba(255,255,255,0.22)", inputRadius: "10px",
    chipBg: "rgba(255,255,255,0.04)", chipBorder: "rgba(255,255,255,0.14)",
    chipColor: "rgba(255,255,255,0.4)", chipBgOn: "rgba(255,255,255,0.14)",
    chipBorderOn: "rgba(255,255,255,0.35)", chipColorOn: "white", chipRadius: "14px",
    btnPrimaryBg: "linear-gradient(135deg,rgba(255,255,255,0.15),rgba(255,255,255,0.05))",
    btnPrimaryBorder: "rgba(255,255,255,0.22)", btnPrimaryColor: "white",
    btnPrimaryRadius: "24px", btnPrimaryHoverBg: "rgba(255,255,255,0.2)",
    accent: "rgba(255,130,200,0.45)", accentText: "rgba(255,200,230,0.9)",
    scrollbarThumb: "rgba(255,255,255,0.12)",
    batchBarBg: "rgba(12,8,22,0.97)", batchBarBorder: "rgba(255,255,255,0.1)",
    undoBg: "rgba(16,10,28,0.97)", undoBorder: "rgba(255,255,255,0.14)",
    sortOptionBg: "#16101f",
    cardStyle: "bottle", gridCols: "repeat(auto-fill,minmax(130px,1fr))", filterLayout: "pills",
    previewColors: ["#0a080f", "#ff6699", "rgba(255,200,230,0.9)"],
  },
  candyPop: {
    id: "candyPop", name: "Candy Pop", icon: "🍬", dark: false,
    fontImport: "https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap",
    fontDisplay: "'Nunito', sans-serif", fontBody: "'Nunito', sans-serif",
    bg: "linear-gradient(135deg,#ffe0ef 0%,#f3cfff 50%,#ffd6f0 100%)",
    text: "#2a0040", textMuted: "rgba(42,0,64,0.65)",
    textVeryMuted: "rgba(42,0,64,0.4)", textFaint: "rgba(42,0,64,0.2)",
    cardBg: "rgba(255,255,255,0.72)", cardBorder: "rgba(220,130,210,0.25)",
    cardBgHover: "rgba(255,255,255,0.92)", cardBorderHover: "rgba(220,130,210,0.6)",
    cardBorderActive: "#e040ab", cardRadius: "22px",
    cardShadow: "0 4px 20px rgba(220,100,200,0.12)", cardShadowHover: "0 8px 28px rgba(220,100,200,0.25)",
    filterBg: "rgba(255,255,255,0.6)", filterBorder: "rgba(220,130,210,0.35)",
    filterColor: "rgba(42,0,64,0.5)", filterBgActive: "#e040ab",
    filterBorderActive: "#e040ab", filterColorActive: "white", filterRadius: "22px",
    inputBg: "rgba(255,255,255,0.8)", inputBorder: "rgba(220,130,210,0.4)",
    inputBorderFocus: "#e040ab", inputBgFocus: "rgba(255,255,255,0.95)",
    inputColor: "#2a0040", inputPlaceholder: "rgba(42,0,64,0.3)", inputRadius: "14px",
    chipBg: "rgba(255,255,255,0.6)", chipBorder: "rgba(220,130,210,0.3)",
    chipColor: "rgba(42,0,64,0.5)", chipBgOn: "#e040ab",
    chipBorderOn: "#e040ab", chipColorOn: "white", chipRadius: "20px",
    btnPrimaryBg: "linear-gradient(135deg,#e040ab,#b040e0)",
    btnPrimaryBorder: "transparent", btnPrimaryColor: "white",
    btnPrimaryRadius: "28px", btnPrimaryHoverBg: "linear-gradient(135deg,#cc2090,#9020c0)",
    accent: "rgba(220,80,180,0.5)", accentText: "#e040ab",
    scrollbarThumb: "rgba(220,130,210,0.35)",
    batchBarBg: "rgba(255,230,245,0.97)", batchBarBorder: "rgba(220,130,210,0.4)",
    undoBg: "rgba(255,240,250,0.97)", undoBorder: "rgba(220,130,210,0.35)",
    sortOptionBg: "#fff0fa",
    cardStyle: "blob", gridCols: "repeat(auto-fill,minmax(110px,1fr))", filterLayout: "pills",
    previewColors: ["#ffe0ef", "#e040ab", "#2a0040"],
  },
  vintageWarm: {
    id: "vintageWarm", name: "Warm Vintage", icon: "📜", dark: false,
    fontImport: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Lato:wght@300;400&display=swap",
    fontDisplay: "'Playfair Display', serif", fontBody: "'Lato', sans-serif",
    bg: "linear-gradient(160deg,#f7f1e6 0%,#f0e8d5 60%,#ede0c8 100%)",
    text: "#3b2507", textMuted: "rgba(59,37,7,0.65)",
    textVeryMuted: "rgba(59,37,7,0.4)", textFaint: "rgba(59,37,7,0.18)",
    cardBg: "rgba(255,252,242,0.85)", cardBorder: "rgba(139,69,19,0.18)",
    cardBgHover: "#fffcf2", cardBorderHover: "rgba(139,69,19,0.42)",
    cardBorderActive: "#c8a040", cardRadius: "8px",
    cardShadow: "0 2px 12px rgba(139,69,19,0.1)", cardShadowHover: "0 6px 24px rgba(139,69,19,0.18)",
    filterBg: "rgba(255,252,242,0.7)", filterBorder: "rgba(139,69,19,0.25)",
    filterColor: "rgba(59,37,7,0.55)", filterBgActive: "#8b4513",
    filterBorderActive: "#8b4513", filterColorActive: "#f7f1e6", filterRadius: "6px",
    inputBg: "rgba(255,252,242,0.9)", inputBorder: "rgba(139,69,19,0.25)",
    inputBorderFocus: "#8b4513", inputBgFocus: "#fffcf2",
    inputColor: "#3b2507", inputPlaceholder: "rgba(59,37,7,0.3)", inputRadius: "6px",
    chipBg: "rgba(255,252,242,0.7)", chipBorder: "rgba(139,69,19,0.2)",
    chipColor: "rgba(59,37,7,0.5)", chipBgOn: "#8b4513",
    chipBorderOn: "#8b4513", chipColorOn: "#f7f1e6", chipRadius: "6px",
    btnPrimaryBg: "linear-gradient(135deg,#8b4513,#6b3510)",
    btnPrimaryBorder: "transparent", btnPrimaryColor: "#f7f1e6",
    btnPrimaryRadius: "6px", btnPrimaryHoverBg: "#6b3510",
    accent: "rgba(139,69,19,0.35)", accentText: "#8b4513",
    scrollbarThumb: "rgba(139,69,19,0.2)",
    batchBarBg: "rgba(247,241,230,0.97)", batchBarBorder: "rgba(139,69,19,0.2)",
    undoBg: "rgba(250,246,238,0.97)", undoBorder: "rgba(139,69,19,0.2)",
    sortOptionBg: "#f7f1e6",
    cardStyle: "stripe", gridCols: "repeat(auto-fill,minmax(260px,1fr))", filterLayout: "underline",
    previewColors: ["#f7f1e6", "#8b4513", "#c8a040"],
  },
  neonNightclub: {
    id: "neonNightclub", name: "Neon Nightclub", icon: "⚡", dark: true,
    fontImport: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@300;400;500&display=swap",
    fontDisplay: "'Bebas Neue', sans-serif", fontBody: "'Rajdhani', sans-serif",
    bg: "linear-gradient(135deg,#030009 0%,#06000f 50%,#00040f 100%)",
    text: "#ffffff", textMuted: "rgba(255,255,255,0.7)",
    textVeryMuted: "rgba(255,255,255,0.4)", textFaint: "rgba(255,255,255,0.15)",
    cardBg: "rgba(255,0,255,0.04)", cardBorder: "rgba(255,0,230,0.25)",
    cardBgHover: "rgba(255,0,255,0.08)", cardBorderHover: "rgba(255,0,230,0.7)",
    cardBorderActive: "#ff00e6", cardRadius: "4px",
    cardShadow: "0 0 12px rgba(255,0,230,0.15)", cardShadowHover: "0 0 28px rgba(255,0,230,0.4)",
    filterBg: "transparent", filterBorder: "rgba(0,240,255,0.35)",
    filterColor: "rgba(0,240,255,0.7)", filterBgActive: "rgba(0,240,255,0.15)",
    filterBorderActive: "#00f0ff", filterColorActive: "#00f0ff", filterRadius: "2px",
    inputBg: "rgba(0,240,255,0.05)", inputBorder: "rgba(0,240,255,0.3)",
    inputBorderFocus: "#00f0ff", inputBgFocus: "rgba(0,240,255,0.09)",
    inputColor: "white", inputPlaceholder: "rgba(0,240,255,0.3)", inputRadius: "2px",
    chipBg: "transparent", chipBorder: "rgba(255,0,230,0.35)",
    chipColor: "rgba(255,0,230,0.7)", chipBgOn: "rgba(255,0,230,0.18)",
    chipBorderOn: "#ff00e6", chipColorOn: "#ff00e6", chipRadius: "2px",
    btnPrimaryBg: "transparent",
    btnPrimaryBorder: "#ff00e6", btnPrimaryColor: "#ff00e6",
    btnPrimaryRadius: "2px", btnPrimaryHoverBg: "rgba(255,0,230,0.12)",
    accent: "rgba(255,0,230,0.5)", accentText: "#ff00e6",
    scrollbarThumb: "rgba(255,0,230,0.25)",
    batchBarBg: "rgba(3,0,12,0.97)", batchBarBorder: "rgba(255,0,230,0.3)",
    undoBg: "rgba(3,0,12,0.97)", undoBorder: "rgba(0,240,255,0.3)",
    sortOptionBg: "#06000f",
    cardStyle: "bottle", gridCols: "repeat(auto-fill,minmax(120px,1fr))", filterLayout: "block",
    previewColors: ["#030009", "#ff00e6", "#00f0ff"],
  },
  cleanWhite: {
    id: "cleanWhite", name: "Clean White", icon: "◻", dark: false,
    fontImport: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap",
    fontDisplay: "'Inter', sans-serif", fontBody: "'Inter', sans-serif",
    bg: "#f4f4f4",
    text: "#111111", textMuted: "rgba(17,17,17,0.6)",
    textVeryMuted: "rgba(17,17,17,0.38)", textFaint: "rgba(17,17,17,0.15)",
    cardBg: "#ffffff", cardBorder: "rgba(17,17,17,0.1)",
    cardBgHover: "#ffffff", cardBorderHover: "rgba(17,17,17,0.28)",
    cardBorderActive: "#111111", cardRadius: "12px",
    cardShadow: "0 1px 4px rgba(0,0,0,0.08)", cardShadowHover: "0 4px 16px rgba(0,0,0,0.12)",
    filterBg: "#ffffff", filterBorder: "rgba(17,17,17,0.15)",
    filterColor: "rgba(17,17,17,0.5)", filterBgActive: "#111111",
    filterBorderActive: "#111111", filterColorActive: "white", filterRadius: "8px",
    inputBg: "#ffffff", inputBorder: "rgba(17,17,17,0.15)",
    inputBorderFocus: "#111111", inputBgFocus: "#ffffff",
    inputColor: "#111111", inputPlaceholder: "rgba(17,17,17,0.3)", inputRadius: "8px",
    chipBg: "#ffffff", chipBorder: "rgba(17,17,17,0.15)",
    chipColor: "rgba(17,17,17,0.5)", chipBgOn: "#111111",
    chipBorderOn: "#111111", chipColorOn: "white", chipRadius: "8px",
    btnPrimaryBg: "#111111",
    btnPrimaryBorder: "transparent", btnPrimaryColor: "white",
    btnPrimaryRadius: "8px", btnPrimaryHoverBg: "#333333",
    accent: "rgba(17,17,17,0.2)", accentText: "#111111",
    scrollbarThumb: "rgba(17,17,17,0.15)",
    batchBarBg: "rgba(244,244,244,0.97)", batchBarBorder: "rgba(17,17,17,0.1)",
    undoBg: "rgba(255,255,255,0.97)", undoBorder: "rgba(17,17,17,0.12)",
    sortOptionBg: "#ffffff",
    cardStyle: "row", gridCols: "1fr", filterLayout: "pills",
    previewColors: ["#f4f4f4", "#111111", "#e8196c"],
  },
  forestGreen: {
    id: "forestGreen", name: "Forest Dark", icon: "🌿", dark: true,
    fontImport: "https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;1,400&family=Raleway:wght@200;300;400&display=swap",
    fontDisplay: "'Crimson Text', serif", fontBody: "'Raleway', sans-serif",
    bg: "linear-gradient(135deg,#050d06 0%,#091510 50%,#050d08 100%)",
    text: "#e8f5e4", textMuted: "rgba(232,245,228,0.6)",
    textVeryMuted: "rgba(232,245,228,0.35)", textFaint: "rgba(232,245,228,0.15)",
    cardBg: "rgba(232,245,228,0.03)", cardBorder: "rgba(201,168,60,0.2)",
    cardBgHover: "rgba(232,245,228,0.06)", cardBorderHover: "rgba(201,168,60,0.5)",
    cardBorderActive: "#c9a83c", cardRadius: "12px",
    cardShadow: "none", cardShadowHover: "0 4px 20px rgba(201,168,60,0.1)",
    filterBg: "transparent", filterBorder: "rgba(201,168,60,0.3)",
    filterColor: "rgba(232,245,228,0.45)", filterBgActive: "rgba(201,168,60,0.15)",
    filterBorderActive: "#c9a83c", filterColorActive: "#c9a83c", filterRadius: "20px",
    inputBg: "rgba(232,245,228,0.05)", inputBorder: "rgba(201,168,60,0.2)",
    inputBorderFocus: "#c9a83c", inputBgFocus: "rgba(232,245,228,0.08)",
    inputColor: "#e8f5e4", inputPlaceholder: "rgba(232,245,228,0.25)", inputRadius: "10px",
    chipBg: "rgba(232,245,228,0.04)", chipBorder: "rgba(201,168,60,0.2)",
    chipColor: "rgba(232,245,228,0.4)", chipBgOn: "rgba(201,168,60,0.18)",
    chipBorderOn: "#c9a83c", chipColorOn: "#c9a83c", chipRadius: "14px",
    btnPrimaryBg: "linear-gradient(135deg,rgba(201,168,60,0.2),rgba(201,168,60,0.08))",
    btnPrimaryBorder: "rgba(201,168,60,0.45)", btnPrimaryColor: "#c9a83c",
    btnPrimaryRadius: "24px", btnPrimaryHoverBg: "rgba(201,168,60,0.25)",
    accent: "rgba(201,168,60,0.4)", accentText: "#c9a83c",
    scrollbarThumb: "rgba(201,168,60,0.15)",
    batchBarBg: "rgba(5,13,6,0.97)", batchBarBorder: "rgba(201,168,60,0.2)",
    undoBg: "rgba(5,13,6,0.97)", undoBorder: "rgba(201,168,60,0.2)",
    sortOptionBg: "#091510",
    cardStyle: "blob", gridCols: "repeat(auto-fill,minmax(140px,1fr))", filterLayout: "pills",
    previewColors: ["#050d06", "#c9a83c", "#3dba5e"],
  },
};

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

const EMPTY_FORM = { num: "", name: "", brand: "", color: "#ff6699", finish: "Classic", count: 1, categories: [], status: "ok", notes: "", rating: 0 };

function PolishForm({ t, form, setForm, customCats, allBrands, allColors, onSubmit, submitLabel, onCancel, onAddCategory, onDeleteCategory, success }) {
  const [newCatName, setNewCatName]     = useState("");
  const [showNewCat, setShowNewCat]     = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const photoCameraRef  = useRef(null);
  const photoGalleryRef = useRef(null);
  const photoCanvasRef  = useRef(null);

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
          <div style={{ display: "flex", alignItems: "center", gap: "9px", background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: t.inputRadius, padding: "8px 12px", height: "42px" }}>
            <div style={{ width: 22, height: 22, borderRadius: "5px", background: form.color, boxShadow: `0 0 8px ${form.color}88`, flexShrink: 0 }} />
            <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={{ width: "100%", height: "22px" }} />
            <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
              <button type="button" title="Foto aufnehmen" onClick={() => photoCameraRef.current?.click()}
                style={{ background: "transparent", border: `1px solid ${t.inputBorder}`, borderRadius: "7px", padding: "3px 7px", cursor: "pointer", fontSize: "14px", lineHeight: 1, transition: "border-color 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = t.inputBorderFocus}
                onMouseLeave={e => e.currentTarget.style.borderColor = t.inputBorder}>
                📷
              </button>
              <button type="button" title="Bild aus Galerie wählen" onClick={() => photoGalleryRef.current?.click()}
                style={{ background: "transparent", border: `1px solid ${t.inputBorder}`, borderRadius: "7px", padding: "3px 7px", cursor: "pointer", fontSize: "14px", lineHeight: 1, transition: "border-color 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = t.inputBorderFocus}
                onMouseLeave={e => e.currentTarget.style.borderColor = t.inputBorder}>
                🖼
              </button>
            </div>
          </div>
          <input ref={photoCameraRef}  type="file" accept="image/*" capture="environment" onChange={handlePhotoSelect} style={{ display: "none" }} />
          <input ref={photoGalleryRef} type="file" accept="image/*" onChange={handlePhotoSelect} style={{ display: "none" }} />
          {photoPreview && (
            <div style={{ marginTop: "10px", position: "relative", display: "inline-block" }}>
              <div style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", color: t.textVeryMuted, textTransform: "uppercase", marginBottom: "6px" }}>
                Auf die gewünschte Farbe tippen
              </div>
              <canvas ref={photoCanvasRef} onClick={handleCanvasClick}
                style={{ display: "block", cursor: "crosshair", borderRadius: t.inputRadius, border: `1px solid ${t.cardBorder}`, maxWidth: "100%" }} />
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
                  style={{ width: 18, height: 18, borderRadius: "50%", background: c, border: `1px solid ${t.inputBorder}`, cursor: "pointer", padding: 0, transition: "transform 0.15s", flexShrink: 0 }}
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
              style={form.status === s.value ? { borderColor: s.color, color: s.color, background: t.inputBg } : {}}
              onClick={() => setForm(f => ({ ...f, status: s.value }))}>{s.label}</button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: "14px" }}>
        <label className="form-label">Bewertung</label>
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          {[1,2,3,4,5].map(n => (
            <button key={n} type="button"
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

function Bar({ t, value, max, color }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <div style={{ flex: 1, height: "6px", background: t.dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "3px", transition: "width 0.6s ease" }} />
      </div>
      <span style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.textVeryMuted, minWidth: "28px", textAlign: "right" }}>{value}</span>
    </div>
  );
}

function StatCard({ t, children, style }) {
  return (
    <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: t.cardRadius, padding: "22px 24px", ...style }}>
      {children}
    </div>
  );
}

function CardLabel({ t, children }) {
  return <div style={{ fontFamily: t.fontBody, fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: t.textVeryMuted, marginBottom: "14px" }}>{children}</div>;
}

function StatsPage({ t, polishes, customCats, onSelectPolish }) {
  const [clickedColor, setClickedColor] = useState(null);
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

  const bigNum = { fontFamily: t.fontDisplay, fontSize: "42px", fontWeight: 300, lineHeight: 1, color: t.text };
  const bigLabel = { fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: t.textVeryMuted, marginTop: "6px" };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 18px 60px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: "14px", marginBottom: "20px" }}>
        {[
          { value: total,        label: "Lacke gesamt",   color: t.text },
          { value: totalBottles, label: "Flaschen",       color: t.dark ? "rgba(200,230,255,0.9)"  : "#1a4080" },
          { value: available,    label: "Verfügbar",      color: t.dark ? "rgba(150,255,180,0.85)" : "#1a6b2a" },
          { value: wish,         label: "Wunschliste",    color: t.dark ? "rgba(180,160,255,0.85)" : "#5040a0" },
          { value: empty + gone, label: "Leer / Weg",     color: t.dark ? "rgba(255,180,80,0.85)"  : "#804000" },
        ].map(({ value, label, color }) => (
          <StatCard t={t} key={label}>
            <div style={{ ...bigNum, color }}>{value}</div>
            <div style={bigLabel}>{label}</div>
          </StatCard>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "20px" }}>
        <StatCard t={t}>
          <CardLabel t={t}>Marken</CardLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {byBrand.map(([brand, count]) => (
              <div key={brand}>
                <div style={{ marginBottom: "4px" }}>
                  <span style={{ fontFamily: t.fontBody, fontSize: "12px", color: t.textMuted, letterSpacing: "1px" }}>{brand}</span>
                </div>
                <Bar t={t} value={count} max={total} color="rgba(180,180,255,0.55)" />
              </div>
            ))}
            {byBrand.length === 0 && <span style={{ fontFamily: t.fontBody, fontSize: "12px", color: t.textVeryMuted }}>Keine Marken eingetragen</span>}
          </div>
        </StatCard>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <StatCard t={t}>
            <CardLabel t={t}>Finish</CardLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {finishCounts.map(({ icon, label, count }) => (
                <div key={label}>
                  <div style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.textMuted, marginBottom: "3px" }}>{icon} {label}</div>
                  <Bar t={t} value={count} max={total} color="rgba(200,200,255,0.55)" />
                </div>
              ))}
            </div>
          </StatCard>

          <StatCard t={t}>
            <CardLabel t={t}>Status</CardLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                { label: "✓ Vorhanden",      value: available, color: "rgba(150,255,180,0.55)" },
                { label: "☆ Wunschliste",    value: wish,      color: "rgba(180,160,255,0.55)" },
                { label: "○ Leer",           value: empty,     color: "rgba(255,200,80,0.55)"  },
                { label: "✕ Nicht mehr da",  value: gone,      color: "rgba(255,100,100,0.55)" },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.textMuted, marginBottom: "3px" }}>{label}</div>
                  <Bar t={t} value={value} max={total} color={color} />
                </div>
              ))}
            </div>
          </StatCard>
        </div>
      </div>

      {byCat.length > 0 && (
        <StatCard t={t} style={{ marginBottom: "20px" }}>
          <CardLabel t={t}>Eigene Kategorien</CardLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {byCat.map(({ label, count }) => (
              <div key={label}>
                <div style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.textMuted, marginBottom: "3px" }}>◆ {label}</div>
                <Bar t={t} value={count} max={total} color="rgba(220,160,255,0.55)" />
              </div>
            ))}
          </div>
        </StatCard>
      )}

      <StatCard t={t}>
        <CardLabel t={t}>Farb-Palette · {colorPalette.length} Farben</CardLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {colorPalette.map(c => (
            <div key={c} title={c}
              style={{ width: "28px", height: "28px", borderRadius: "50%", background: c,
                       boxShadow: `0 0 8px ${c}66`,
                       border: `1.5px solid ${clickedColor === c ? t.cardBorderActive : (t.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.15)")}`,
                       flexShrink: 0, transition: "transform 0.2s, border-color 0.15s",
                       cursor: "pointer",
                       transform: clickedColor === c ? "scale(1.35)" : "scale(1)" }}
              onClick={() => setClickedColor(clickedColor === c ? null : c)}
              onMouseEnter={e => { if (clickedColor !== c) e.currentTarget.style.transform = "scale(1.3)"; }}
              onMouseLeave={e => { if (clickedColor !== c) e.currentTarget.style.transform = "scale(1)"; }} />
          ))}
        </div>
        {clickedColor && (() => {
          const matches = polishes.map((p, i) => ({ p, i })).filter(({ p }) => p.color === clickedColor);
          return (
            <div style={{ marginTop: "14px", borderTop: `1px solid ${t.textFaint}`, paddingTop: "12px" }}>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: clickedColor, boxShadow: `0 0 14px ${clickedColor}88`, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", color: t.textVeryMuted, textTransform: "uppercase", marginBottom: "8px" }}>
                    {clickedColor.toUpperCase()} · {matches.length} Lack{matches.length !== 1 ? "e" : ""}
                  </div>
                  {matches.map(({ p, i }) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
                      <span style={{ fontFamily: t.fontDisplay, fontSize: "13px", color: t.text }}>{p.name}</span>
                      {p.brand && <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.textVeryMuted }}>{p.brand}</span>}
                      {p.num && <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.textVeryMuted }}>№ {p.num}</span>}
                      {onSelectPolish && (
                        <button onClick={() => onSelectPolish(i)}
                          style={{ background: "transparent", border: `1px solid ${t.filterBorder}`, color: t.filterColor,
                                   borderRadius: t.filterRadius, padding: "2px 10px", cursor: "pointer",
                                   fontFamily: t.fontBody, fontSize: "9px", letterSpacing: "1.5px",
                                   textTransform: "uppercase", marginLeft: "auto", whiteSpace: "nowrap" }}>
                          → Kollektion
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={() => setClickedColor(null)}
                  style={{ background: "transparent", border: "none", color: t.textVeryMuted, cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: "2px", flexShrink: 0 }}>×</button>
              </div>
            </div>
          );
        })()}
      </StatCard>

      {(() => {
        const topRated = [...polishes].filter(p => (p.rating || 0) > 0).sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 5);
        if (!topRated.length) return null;
        return (
          <StatCard t={t} style={{ marginTop: "20px" }}>
            <CardLabel t={t}>Top Bewertet</CardLabel>
            {topRated.map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0", borderBottom: i < topRated.length - 1 ? `1px solid ${t.textFaint}` : "none" }}>
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
                <div style={{ flex: 1, fontFamily: t.fontBody, fontSize: "12px", color: t.textMuted }}>{p.name}{p.brand ? ` · ${p.brand}` : ""}</div>
                <span style={{ fontFamily: t.fontBody, fontSize: "12px", color: t.accentText, letterSpacing: "1px" }}>{"★".repeat(p.rating)}</span>
              </div>
            ))}
          </StatCard>
        );
      })()}
    </div>
  );
}

function LogPanel({ t, apiKey }) {
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
    background: "transparent", border: `1px solid ${t.filterBorder}`,
    color: t.textVeryMuted, padding: "3px 12px", borderRadius: t.filterRadius,
    cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px",
    letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s",
  };
  const btnActive = { ...btnBase, background: t.filterBgActive, color: t.filterColorActive, borderColor: t.filterBorderActive };

  if (!open) return (
    <div style={{ textAlign: "center", paddingBottom: "12px" }}>
      <button style={btnBase}
        onMouseEnter={e => Object.assign(e.currentTarget.style, { color: t.textMuted, borderColor: t.filterBorderActive })}
        onMouseLeave={e => Object.assign(e.currentTarget.style, { color: t.textVeryMuted, borderColor: t.filterBorder })}
        onClick={() => setOpen(true)}>
        ≡ System Logs
      </button>
    </div>
  );

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto 40px", padding: "0 18px" }}>
      <div style={{ background: t.dark ? "rgba(0,0,0,0.55)" : t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: t.cardRadius, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", borderBottom: `1px solid ${t.textFaint}`, flexWrap: "wrap" }}>
          <span style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "3px", color: t.textVeryMuted, textTransform: "uppercase", flexShrink: 0 }}>
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
              onMouseEnter={e => Object.assign(e.currentTarget.style, { color: t.textMuted, borderColor: t.filterBorderActive })}
              onMouseLeave={e => Object.assign(e.currentTarget.style, { color: t.textVeryMuted, borderColor: t.filterBorder })}>
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
          lineHeight: "1.6", color: hasError ? "rgba(255,140,140,0.8)" : t.dark ? "rgba(180,220,180,0.85)" : "rgba(20,80,20,0.9)",
          whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}>
          {logs || (loading ? "Lade…" : "Keine Logs verfügbar")}
        </pre>
      </div>
    </div>
  );
}

function UpdatePanel({ t, apiKey }) {
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

  const btnStyle = { background: "transparent", border: `1px solid ${t.filterBorder}`, color: t.textVeryMuted, padding: "4px 14px", borderRadius: t.filterRadius, cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" };
  const updateBtnStyle = { ...btnStyle, borderColor: "rgba(255,210,60,0.45)", color: "rgba(255,210,60,0.75)" };
  const textStyle = { fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase" };

  return (
    <div style={{ textAlign: "center", padding: "0 0 36px" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
        {version && <span style={{ ...textStyle, color: t.textFaint }}>v{version}</span>}
        {status === "idle"       && <button style={btnStyle} onMouseEnter={e => { e.currentTarget.style.color = t.textMuted; e.currentTarget.style.borderColor = t.filterBorderActive; }} onMouseLeave={e => { e.currentTarget.style.color = t.textVeryMuted; e.currentTarget.style.borderColor = t.filterBorder; }} onClick={check}>Updates prüfen</button>}
        {status === "checking"   && <span style={{ ...textStyle, color: t.textVeryMuted }}>Prüfe…</span>}
        {status === "uptodate"   && <span style={{ ...textStyle, color: t.dark ? "rgba(150,255,180,0.55)" : "#2a7a2a" }}>✓ Aktuell</span>}
        {status === "available"  && <>
          <span style={{ ...textStyle, color: "rgba(255,210,60,0.75)" }}>↑ v{latestVersion} verfügbar</span>
          <button style={updateBtnStyle} onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,210,60,1)"; e.currentTarget.style.borderColor = "rgba(255,210,60,0.75)"; e.currentTarget.style.background = "rgba(255,210,60,0.07)"; }} onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,210,60,0.75)"; e.currentTarget.style.borderColor = "rgba(255,210,60,0.45)"; e.currentTarget.style.background = "transparent"; }} onClick={applyUpdate}>Jetzt updaten</button>
        </>}
        {status === "updating"   && <span style={{ ...textStyle, color: t.textVeryMuted }}>⟳ Installiere Update…</span>}
        {status === "restarting" && <span style={{ ...textStyle, color: t.dark ? "rgba(150,255,180,0.6)" : "#2a7a2a" }}>✓ Update installiert · warte auf Neustart…</span>}
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
  const [theme, setTheme]                 = useState(() => localStorage.getItem("nagellacke_theme") || "darkLuxury");
  const [showThemePicker, setShowThemePicker] = useState(false);

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

  const t = THEMES[theme] || THEMES.darkLuxury;

  if (loading) return (
    <div style={{ minHeight: "100vh", background: t.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: t.fontDisplay, color: t.textVeryMuted, fontSize: "18px", letterSpacing: "4px" }}>Lade Kollektion…</div>
    </div>
  );

  const batchSmallBtn = { background: "transparent", border: `1px solid ${t.filterBorder}`, color: t.textMuted, padding: "6px 14px", borderRadius: t.filterRadius, cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", transition: "all 0.2s" };

  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text }}>
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
        .form-input{background:${t.inputBg};border:1px solid ${t.inputBorder};border-radius:${t.inputRadius};color:${t.inputColor};padding:10px 14px;font-family:${t.fontBody};font-size:14px;font-weight:300;outline:none;width:100%;transition:border-color 0.2s,background 0.2s;}
        .form-input:focus{border-color:${t.inputBorderFocus};background:${t.inputBgFocus};}
        .form-input::placeholder{color:${t.inputPlaceholder};}
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
        @media(max-width:600px){
          .bottle-card{padding:14px 6px 12px;}
          .filter-btn{padding:5px 10px;font-size:10px;}
          .search-input{width:160px;}
          .search-input:focus{width:190px;}
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{ textAlign: "center", padding: "48px 24px 24px", borderBottom: `1px solid ${t.textFaint}`, position: "relative" }}>

        {/* Theme Switcher — left */}
        <div style={{ position: "absolute", top: "20px", left: "20px", zIndex: 50 }}>
          <button onClick={() => setShowThemePicker(v => !v)}
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
            </div>
          )}
        </div>

        {/* Stats button — right */}
        <button onClick={() => setView(v => v === "stats" ? "collection" : "stats")}
          style={{ position: "absolute", top: "20px", right: "20px", background: view === "stats" ? t.filterBgActive : t.filterBg, border: `1px solid ${t.filterBorder}`, color: view === "stats" ? t.filterColorActive : t.filterColor, padding: "7px 16px", borderRadius: t.filterRadius, cursor: "pointer", fontFamily: t.fontBody, fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" }}>
          {view === "stats" ? "◈ Kollektion" : "◈ Statistiken"}
        </button>

        <div style={{ fontSize: "10px", letterSpacing: "6px", color: t.textVeryMuted, fontFamily: t.fontBody, textTransform: "uppercase", marginBottom: "12px" }}>meine kollektion</div>
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
        <div style={{ height: "20px", marginTop: "6px" }}>
          {saveStatus === "saving" && <span className="save-indicator" style={{ color: t.textVeryMuted }}>● Speichert…</span>}
          {saveStatus === "saved"  && <span className="save-indicator" style={{ color: t.dark ? "rgba(150,255,180,0.6)" : "#2a7a2a" }}>✓ Gespeichert</span>}
          {saveStatus === "error"  && <span className="save-indicator" style={{ color: "rgba(255,120,120,0.7)" }}>✕ Fehler beim Speichern</span>}
          {saveStatus === "unauth" && <span className="save-indicator" style={{ color: "rgba(255,180,80,0.9)", cursor: "pointer" }} onClick={() => { setShowSettings(true); setSettingsInput(apiKey); }}>⚙ API-Schlüssel fehlt — hier eintragen</span>}
        </div>

        {/* Search + Sort */}
        <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginTop: "12px", flexWrap: "wrap", alignItems: "center" }}>
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input className="search-input" placeholder="Suchen…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: "12px", background: "transparent", border: "none", color: t.textVeryMuted, cursor: "pointer", fontSize: "14px", lineHeight: 1 }}>×</button>}
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
            <button className={`filter-btn ${activeFilter === "wish" ? "active" : ""}`} onClick={() => setActiveFilter("wish")}>☆ Wunsch</button>
          )}
          {polishes.some(p => p.status === "empty" || p.status === "gone") && (
            <button className={`filter-btn ${activeFilter === "empty" ? "active" : ""}`} onClick={() => setActiveFilter("empty")}>○ Leer / Weg</button>
          )}
          {polishes.some(p => (p.rating || 0) > 0) && (
            <button className={`filter-btn ${activeFilter === "rated" ? "active" : ""}`} onClick={() => setActiveFilter("rated")}>★ Bewertet</button>
          )}
          {usedCustomCats.map(c => (
            <button key={c.id} className={`filter-btn custom-cat ${activeFilter === c.id ? "active" : ""}`} onClick={() => setActiveFilter(c.id)}>◆ {c.label}</button>
          ))}
        </div>

        {/* Brand filter */}
        {allBrands.length > 1 && (
          <div style={{ display: "flex", gap: "6px", justifyContent: "center", marginTop: "8px", flexWrap: "wrap", padding: "0 12px" }}>
            <span style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", color: t.textFaint, textTransform: "uppercase", alignSelf: "center", paddingRight: "4px" }}>Marke</span>
            <button className={`filter-btn ${activeBrand === null ? "active" : ""}`} onClick={() => setActiveBrand(null)}>◈ Alle</button>
            {allBrands.map(b => (
              <button key={b} className={`filter-btn ${activeBrand === b ? "active" : ""}`} onClick={() => setActiveBrand(activeBrand === b ? null : b)}>{b}</button>
            ))}
          </div>
        )}
      </div>

      {/* ── Stats Page ── */}
      {view === "stats" && <StatsPage t={t} polishes={polishes} customCats={customCats}
        onSelectPolish={(idx) => { setView("collection"); setSelected(idx); }} />}

      {/* ── Collection View ── */}
      {view === "collection" && <>

      {/* ── Neuer Lack + Auswählen ── */}
      {editIdx === null && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "12px", padding: "28px 0 8px", flexWrap: "wrap" }}>
          <button
            onClick={() => { if (showAdd) setForm(EMPTY_FORM); setShowAdd(v => !v); setSelected(null); setBatchMode(false); setBatchSel(new Set()); }}
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
              onClick={() => { setBatchMode(v => !v); setBatchSel(new Set()); setSelected(null); }}
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
          <PolishForm t={t} form={form} setForm={setForm} customCats={customCats} allBrands={allBrands} allColors={allColors}
            onSubmit={handleAdd} submitLabel="+ Hinzufügen" onAddCategory={addCategory} onDeleteCategory={deleteCategory} success={addSuccess} />
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
          <PolishForm t={t} form={editForm} setForm={setEditForm} customCats={customCats} allBrands={allBrands} allColors={allColors}
            onSubmit={handleSave} submitLabel="✓ Speichern"
            onCancel={() => { setEditIdx(null); setEditForm(null); setConfirmDelete(false); }}
            onAddCategory={addCategory} onDeleteCategory={deleteCategory} success={editSuccess} />
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
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: sel.color, boxShadow: `0 0 12px ${sel.color}88`, border: `2px solid ${t.cardBorderHover}`, flexShrink: 0 }} />
                  <span style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.textMuted, letterSpacing: "1px" }}>
                    {sel.color.toUpperCase()} · {getPolishLabel(sel)}{sel.count ? ` · ×${sel.count}` : ""}
                  </span>
                </div>
                <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: t.fontBody, fontSize: "11px", letterSpacing: "1.5px", color: statusObj(sel).color, background: t.cardBg, border: `1px solid ${statusObj(sel).color}55`, borderRadius: t.chipRadius, padding: "3px 12px" }}>
                    {statusObj(sel).label}
                  </span>
                  {sel.rating > 0 && (
                    <span style={{ fontSize: "15px", color: t.accentText, letterSpacing: "2px" }}>
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
            <button onClick={() => setSelected(null)} style={{ position: "absolute", top: "14px", right: "18px", background: "transparent", border: "none", color: t.textVeryMuted, cursor: "pointer", fontSize: "20px", lineHeight: 1 }}>×</button>
          </div>
        </div>
      )}

      {/* ── Grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: t.gridCols, gap: t.cardStyle === "row" ? "4px" : "14px", maxWidth: "1100px", margin: "0 auto", padding: "22px 18px 80px" }}>
        {filtered.length === 0 ? (
          <div className="empty-state">Keine Treffer{search ? ` für „${search}"` : ""}</div>
        ) : filtered.map((p) => {
          const globalIdx = polishes.indexOf(p);
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

          if (t.cardStyle === "blob") return (
            <div key={cardKey} className={cardClass} style={fadedStyle} onClick={cardClick}>
              {batchMode
                ? <div className={`batch-check ${isBatchSel ? "on" : ""}`}>{isBatchSel ? "✓" : ""}</div>
                : (p.count ? <div className="count-badge">×{p.count}</div> : null)}
              {!batchMode && p.status !== "ok" && p.status !== "wish" && <div className="status-dot" style={{ background: st.color }} />}
              <div style={{ width: 76, height: 76, borderRadius: "50%", background: p.color, boxShadow: `0 4px 24px ${p.color}88`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", fontWeight: 800, color: "rgba(255,255,255,0.85)", fontFamily: t.fontDisplay, flexShrink: 0 }}>
                {(p.brand || p.name || "?")[0].toUpperCase()}
              </div>
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
              <div style={{ width: 48, background: p.color, flexShrink: 0, position: "relative", minHeight: 76 }}>
                {batchMode
                  ? <div className={`batch-check ${isBatchSel ? "on" : ""}`} style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}>{isBatchSel ? "✓" : ""}</div>
                  : (p.count ? <div style={{ position: "absolute", bottom: 6, left: 0, right: 0, textAlign: "center", fontSize: "9px", color: "rgba(255,255,255,0.8)", fontFamily: t.fontBody }}>×{p.count}</div> : null)}
                {!batchMode && p.status !== "ok" && p.status !== "wish" && <div style={{ position: "absolute", top: 6, left: 6, width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,0.65)" }} />}
              </div>
              <div style={{ padding: "14px 14px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3, minWidth: 0 }}>
                {p.brand && <div style={{ fontFamily: t.fontBody, fontSize: "9px", letterSpacing: "2px", color: t.textVeryMuted, textTransform: "uppercase" }}>{p.brand}</div>}
                {p.num && <div style={{ fontFamily: t.fontBody, fontSize: "9px", letterSpacing: "3px", color: t.textVeryMuted }}>№ {p.num}</div>}
                <div style={{ fontFamily: t.fontDisplay, fontSize: "15px", lineHeight: 1.3, color: p.status !== "ok" && p.status !== "wish" ? t.textVeryMuted : t.text }}>{p.name}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
                  {p.finish && p.finish !== "Classic" && <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.accentText }}>{FINISH_OPTIONS.find(f => f.value === p.finish)?.icon} {p.finish}</span>}
                  <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: st.color }}>{st.label}</span>
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
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: p.color, flexShrink: 0, border: `1px solid ${t.cardBorderHover}` }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: t.fontDisplay, fontSize: "14px", color: p.status !== "ok" && p.status !== "wish" ? t.textVeryMuted : t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                {(p.brand || p.num) && <div style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.textMuted }}>{[p.brand, p.num && `№ ${p.num}`].filter(Boolean).join(" · ")}</div>}
              </div>
              {p.finish && p.finish !== "Classic" && <span style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.accentText, flexShrink: 0, whiteSpace: "nowrap" }}>{FINISH_OPTIONS.find(f => f.value === p.finish)?.icon} {p.finish}</span>}
              {p.rating > 0 && <span style={{ fontSize: "10px", color: t.accentText, flexShrink: 0, letterSpacing: "1px" }}>{"★".repeat(p.rating)}</span>}
              <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: st.color, flexShrink: 0 }}>{st.label.replace(/^[✓☆○✕] /, "")}</span>
              {p.count && <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.textVeryMuted, flexShrink: 0 }}>×{p.count}</span>}
            </div>
          );

          return (
            <div key={cardKey} className={cardClass} style={fadedStyle} onClick={cardClick}>
              {batchMode
                ? <div className={`batch-check ${isBatchSel ? "on" : ""}`}>{isBatchSel ? "✓" : ""}</div>
                : (p.count ? <div className="count-badge">×{p.count}</div> : null)}
              {!batchMode && p.status !== "ok" && p.status !== "wish" && <div className="status-dot" style={{ background: st.color }} />}
              <NailBottle color={p.color} finish={p.finish} selected={!batchMode && selected === globalIdx} status={p.status} brand={p.brand} />
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

      </>}

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
                value={settingsInput} onChange={e => setSettingsInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && saveApiKey()}
                style={{ flex: 1 }} />
              <button className="add-btn" onClick={saveApiKey} style={{ padding: "10px 18px", fontSize: "11px", whiteSpace: "nowrap" }}>Speichern</button>
              <button className="add-trigger" onClick={() => setShowSettings(false)}>✕</button>
            </div>
            {apiKey && <div style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.dark ? "rgba(150,255,180,0.55)" : "#2a7a2a", marginTop: "10px", letterSpacing: "1px" }}>✓ Schlüssel gesetzt</div>}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{ textAlign: "center", padding: "0 0 20px", display: "flex", justifyContent: "center", gap: "14px", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "4px", color: t.textFaint, textTransform: "uppercase" }}>Nail Lacquer Kollektion</span>
        <button onClick={exportData}
          style={{ background: "transparent", border: `1px solid ${t.cardBorder}`, color: t.textFaint, borderRadius: t.chipRadius, padding: "3px 12px", cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" }}
          onMouseEnter={e => { e.currentTarget.style.color = t.textMuted; e.currentTarget.style.borderColor = t.cardBorderHover; }}
          onMouseLeave={e => { e.currentTarget.style.color = t.textFaint; e.currentTarget.style.borderColor = t.cardBorder; }}>
          ↓ Export
        </button>
        <button onClick={() => importRef.current?.click()}
          style={{ background: "transparent", border: `1px solid ${t.cardBorder}`, color: t.textFaint, borderRadius: t.chipRadius, padding: "3px 12px", cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" }}
          onMouseEnter={e => { e.currentTarget.style.color = t.textMuted; e.currentTarget.style.borderColor = t.cardBorderHover; }}
          onMouseLeave={e => { e.currentTarget.style.color = t.textFaint; e.currentTarget.style.borderColor = t.cardBorder; }}>
          ↑ Import
        </button>
        <input ref={importRef} type="file" accept=".json" onChange={importData} style={{ display: "none" }} />
        <button
          onClick={() => { setShowSettings(v => !v); if (!showSettings) setSettingsInput(apiKey); }}
          style={{ background: showSettings ? t.cardBg : "transparent", border: `1px solid ${showSettings ? t.cardBorderHover : t.cardBorder}`, color: showSettings ? t.textMuted : t.textFaint, borderRadius: t.chipRadius, padding: "3px 12px", cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" }}
          onMouseEnter={e => { e.currentTarget.style.color = t.textMuted; e.currentTarget.style.borderColor = t.cardBorderHover; }}
          onMouseLeave={e => { if (!showSettings) { e.currentTarget.style.color = t.textFaint; e.currentTarget.style.borderColor = t.cardBorder; } }}>
          {apiKey ? "⚙" : "⚙ Schlüssel fehlt"}
        </button>
      </div>

      <LogPanel t={t} apiKey={apiKey} />
      <UpdatePanel t={t} apiKey={apiKey} />

      {/* ── Undo Snackbar ── */}
      {undoEntry && (
        <div style={{ position: "fixed", bottom: batchMode && batchSel.size > 0 ? "80px" : "20px", left: "50%", transform: "translateX(-50%)", background: t.undoBg, border: `1px solid ${t.undoBorder}`, borderRadius: t.btnPrimaryRadius, padding: "11px 20px", display: "flex", alignItems: "center", gap: "14px", zIndex: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.55)", whiteSpace: "nowrap" }}>
          <span style={{ fontFamily: t.fontBody, fontSize: "12px", color: t.textMuted, letterSpacing: "1px" }}>„{undoEntry.label}" gelöscht</span>
          <button onClick={undoDelete} style={{ background: t.filterBgActive, border: `1px solid ${t.filterBorderActive}`, color: t.filterColorActive, borderRadius: t.filterRadius, padding: "5px 16px", cursor: "pointer", fontFamily: t.fontBody, fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase" }}>↩ Rückgängig</button>
        </div>
      )}

      {/* ── Batch Action Bar ── */}
      {batchMode && batchSel.size > 0 && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: t.batchBarBg, borderTop: `1px solid ${t.batchBarBorder}`, padding: "14px 20px", display: "flex", justifyContent: "center", alignItems: "center", gap: "10px", flexWrap: "wrap", zIndex: 100, backdropFilter: "blur(10px)" }}>
          <span style={{ fontFamily: t.fontBody, fontSize: "12px", color: t.textMuted, letterSpacing: "2px", marginRight: "4px" }}>{batchSel.size} ausgewählt</span>
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
