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

export interface Manicure {
  id: string;
  date: string;
  polishes: string[];
  notes?: string;
  photos?: string[];
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
