/**
 * Which layout the collection page uses: the original bottle cards, or the colour-family
 * swatch grid (#328). Stored per device in `localStorage`, like the other display
 * preferences, and cards stay the default for anyone who never touched the toggle.
 */
export type CollectionView = 'cards' | 'grid';

export const COLLECTION_VIEW_KEY = 'nagellacke_v3_collection_view';

export const DEFAULT_COLLECTION_VIEW: CollectionView = 'cards';

/** Anything that is not exactly a known view (unset, hand-edited, from a newer build) means the default. */
export function parseCollectionView(raw: string | null | undefined): CollectionView {
  return raw === 'grid' || raw === 'cards' ? raw : DEFAULT_COLLECTION_VIEW;
}

export function loadCollectionView(): CollectionView {
  try {
    return parseCollectionView(localStorage.getItem(COLLECTION_VIEW_KEY));
  } catch {
    return DEFAULT_COLLECTION_VIEW; // storage blocked
  }
}

export function saveCollectionView(view: CollectionView): void {
  try {
    localStorage.setItem(COLLECTION_VIEW_KEY, view);
  } catch { /* storage blocked: the choice simply is not remembered */ }
}
