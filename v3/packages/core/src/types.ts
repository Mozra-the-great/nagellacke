export type FinishType =
  | 'Classic' | 'Shimmer' | 'Glitter' | 'Metallic' | 'Chrome'
  | 'Matte' | 'Satin' | 'Duochrome' | 'Holographic' | 'Jelly'
  | 'Neon' | 'Magnetic' | 'Gel Look' | 'Top Coat' | 'Base Coat';

export type PolishStatus = 'ok' | 'wish' | 'empty' | 'gone';
export type StickerType = 'full' | 'accent' | 'wrap' | '3d' | 'foil' | 'slider';
export type SortOption = 'newest' | 'oldest' | 'name' | 'brand' | 'hue' | 'rating';

export interface Category {
  id: string;
  label: string;
  deletedAt?: number;
  updatedAt: number;
}

export interface Polish {
  id: string;
  name: string;
  brand: string;
  num: string;
  color: string;
  finish: FinishType;
  status: PolishStatus;
  count?: number;
  categories?: string[];
  notes?: string;
  rating?: number;
  photo?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface PolishRef {
  name: string;
  brand?: string;
  color?: string;
}

export interface StickerRef {
  id: string;
  name: string;
  colors?: string[];
}

export interface ManicurePhotos {
  fingerRight?: string | null;
  fingerLeft?: string | null;
  thumbRight?: string | null;
  thumbLeft?: string | null;
}

export interface Manicure {
  id: string;
  date: string;
  polishes?: string[];        // v3 legacy: array of polish names
  polishRefs?: PolishRef[];   // v2 + v3 preferred: inline color for display
  stickers?: string[];        // legacy: array of sticker names or ids
  stickerRefs?: StickerRef[]; // preferred: inline sticker data
  notes?: string;
  photos?: ManicurePhotos;    // keyed by finger slot (v2 format)
  photo?: string;             // v2 legacy: single photo filename
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface Sticker {
  id: string;
  name: string;
  brand?: string;
  style?: string;
  type: StickerType;
  colors?: string[];
  status: PolishStatus;
  rating?: number;
  notes?: string;
  photo?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface AppData {
  polishes: Polish[];
  customCats: Category[];
  manicures: Manicure[];
  stickers: Sticker[];
}

export interface FilterState {
  search: string;
  finish: FinishType | '';
  category: string;
  status: PolishStatus | '';
  brand: string;
  sort: SortOption;
}
