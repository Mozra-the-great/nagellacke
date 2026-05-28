export const FINISH_OPTIONS = [
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

export const SHIMMER_FINISHES = new Set(["Shimmer", "Glitter", "Metallic", "Chrome", "Holographic", "Duochrome"]);

export const BRAND_SUGGESTIONS = [
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

export const STATUS_OPTIONS = [
  { value: "ok",    label: "✓ Vorhanden",      color: "rgba(150,255,180,0.7)" },
  { value: "wish",  label: "☆ Wunschliste",    color: "rgba(180,160,255,0.7)" },
  { value: "empty", label: "○ Leer",           color: "rgba(255,200,80,0.7)"  },
  { value: "gone",  label: "✕ Nicht mehr da",  color: "rgba(255,100,100,0.7)" },
];

export const SORT_OPTIONS = [
  { value: "newest", label: "Neu" },
  { value: "oldest", label: "Älteste" },
  { value: "name",   label: "Name" },
  { value: "brand",  label: "Marke" },
  { value: "hue",    label: "Farbe" },
  { value: "rating", label: "Bewertung" },
];

export const EMPTY_FORM = {
  num: "", name: "", brand: "", color: "#ff6699", finish: "Classic",
  count: 1, categories: [], status: "ok", notes: "", rating: 0,
};

export const STICKER_TYPE_OPTIONS = [
  { value: "full",   label: "Full Cover", icon: "▬" },
  { value: "accent", label: "Akzent",     icon: "◆" },
  { value: "wrap",   label: "Nail Wrap",  icon: "◌" },
  { value: "3d",     label: "3D",         icon: "●" },
  { value: "foil",   label: "Folie",      icon: "✦" },
  { value: "slider", label: "Slider",     icon: "◎" },
];

export const STICKER_STYLE_SUGGESTIONS = [
  "Blumen", "Geometrisch", "Abstrakt", "Glitzer", "Französisch",
  "Weihnachten", "Halloween", "Sommer", "Herzen", "Sterne",
  "Tiere", "Früchte", "Botanisch", "Marble", "Japanisch",
];

export const EMPTY_STICKER = {
  name: "", brand: "", style: "", type: "accent",
  colors: ["#ff6699"], status: "ok", notes: "", rating: 0, photo: null,
};
