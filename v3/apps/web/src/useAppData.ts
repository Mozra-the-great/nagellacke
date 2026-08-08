import { useState, useCallback, useEffect, useRef } from 'react';
import type { AppData, Polish, Manicure, Sticker, Category } from '@nagellacke/core';
import { generateId, now, mergeData } from '@nagellacke/core';
import type { SyncConfig } from '@nagellacke/sync';
import { createAdapter } from '@nagellacke/sync';

async function deletePhotoFromServer(filename: string): Promise<void> {
  const config = loadSyncConfig();
  if (!config) return;
  try {
    const adapter = createAdapter(config, persistRefreshedTokens);
    await adapter.deletePhoto(filename);
  } catch { /* best-effort: local deletion still proceeds */ }
}

const STORAGE_KEY = 'nagellacke_v3_data';
const SYNC_CONFIG_KEY = 'nagellacke_v3_sync';

function loadLocal(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppData;
  } catch { /* empty */ }
  return { polishes: [], customCats: [], manicures: [], stickers: [] };
}

function saveLocal(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

const PHOTO_DEFAULT_KEY = 'nagellacke_v3_photo_default';

export function loadPhotoDefault(): boolean {
  return localStorage.getItem(PHOTO_DEFAULT_KEY) !== 'false';
}

export function savePhotoDefault(value: boolean): void {
  localStorage.setItem(PHOTO_DEFAULT_KEY, String(value));
}

const AI_ENABLED_KEY = 'nagellacke_v3_ai_enabled';

/**
 * Master switch for every AI/KI feature (#99). When off, all AI UI — the
 * Auto-Fill toggle, the Smart-Cart prompt, and the KI-Assistenz settings
 * section — is not rendered at all rather than disabled, so the app reads as
 * if the features had never been built.
 *
 * Defaults to on: the AI surfaces already hide themselves when no server sync
 * or provider is configured, so a default of off would hide the feature from
 * everyone who never finds this setting.
 */
export function loadAiEnabled(): boolean {
  return localStorage.getItem(AI_ENABLED_KEY) !== 'false';
}

export function saveAiEnabled(value: boolean): void {
  localStorage.setItem(AI_ENABLED_KEY, String(value));
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    if (raw) return JSON.parse(raw) as SyncConfig;
  } catch { /* empty */ }
  return null;
}

export function saveSyncConfig(config: SyncConfig | null): void {
  if (config) localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
  else localStorage.removeItem(SYNC_CONFIG_KEY);
}

/**
 * Writes a renewed access/refresh pair back into the stored sync config, so a
 * silent refresh survives a page reload (#109). Re-reads the config rather than
 * closing over one, since a refresh can land long after the adapter was built.
 */
export function persistRefreshedTokens(token: string, refreshToken: string): void {
  const current = loadSyncConfig();
  if (!current || current.provider !== 'server') return;
  saveSyncConfig({ ...current, serverToken: token, serverRefreshToken: refreshToken });
}

export function useAppData() {
  const [data, setDataState] = useState<AppData>(loadLocal);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  // Authoritative latest value, updated synchronously by every commit()
  // (setDataState only applies on the next render, so relying on the `data`
  // state variable here would race whenever sync() runs in the same tick as
  // the commit that triggered it - see commit() below). Every mutator calls
  // sync() right after commit() (#206), so sync() reads dataRef, not `data`.
  const dataRef = useRef(data);

  // Takes an updater rather than a plain value so long-running async callers
  // (e.g. an AI background job that resolves a minute later) always apply
  // their change on top of the latest state instead of clobbering whatever
  // else happened in the meantime with a stale snapshot. Computed against
  // dataRef.current (not via the setDataState updater) so dataRef is
  // guaranteed current before this function returns, even across multiple
  // commits in the same tick - setDataState's updater form only eagerly
  // re-runs when React's queue happens to be empty, which isn't guaranteed.
  const commit = useCallback((updater: (prev: AppData) => AppData) => {
    const next = updater(dataRef.current);
    dataRef.current = next;
    saveLocal(next);
    setDataState(next);
  }, []);

  // Sync - defined ahead of the mutators below so each of them can trigger a
  // push right after committing locally (#206). Uses `commit` directly for
  // its own merge-back rather than going through the mutators, so it doesn't
  // re-trigger itself. Coalesces overlapping calls: a sync already in flight
  // finishes with dataRef's *current* value, but a mutator committing while
  // that request is on the wire wouldn't otherwise get pushed until the next
  // unrelated sync - syncPendingRef ensures one more run happens right after.
  const syncingRef = useRef(false);
  const syncPendingRef = useRef(false);
  const sync = useCallback(async () => {
    const config = loadSyncConfig();
    if (!config) return;
    if (syncingRef.current) { syncPendingRef.current = true; return; }
    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);
    try {
      const adapter = createAdapter(config, persistRefreshedTokens);
      const result = await adapter.sync(dataRef.current);
      if (result.success) {
        // Merge against whatever's latest (not the snapshot sync started
        // with) so edits made while this sync was in flight aren't discarded.
        commit((prev) => mergeData(prev, result.merged));
        setLastSyncAt(result.lastSyncAt);
      } else {
        setSyncError(result.error ?? 'Sync fehlgeschlagen');
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      if (syncPendingRef.current) {
        syncPendingRef.current = false;
        void sync();
      }
    }
  }, [commit]);

  // Polishes
  const addPolish = useCallback((p: Omit<Polish, 'id' | 'createdAt' | 'updatedAt'>): Polish => {
    const item: Polish = { ...p, id: generateId(), createdAt: now(), updatedAt: now() };
    commit((prev) => ({ ...prev, polishes: [...prev.polishes, item] }));
    void sync();
    return item;
  }, [commit, sync]);

  const updatePolish = useCallback((id: string, changes: Partial<Polish>) => {
    commit((prev) => ({
      ...prev,
      polishes: prev.polishes.map((p) => p.id === id ? { ...p, ...changes, updatedAt: now() } : p),
    }));
    void sync();
  }, [commit, sync]);

  const deletePolish = useCallback((id: string): (() => void) => {
    const p = data.polishes.find((p) => p.id === id);
    commit((prev) => ({
      ...prev,
      polishes: prev.polishes.map((p) => p.id === id ? { ...p, deletedAt: now(), updatedAt: now() } : p),
    }));
    void sync();
    return () => { if (p?.photo) void deletePhotoFromServer(p.photo); };
  }, [data, commit, sync]);

  const restorePolish = useCallback((id: string) => {
    commit((prev) => ({
      ...prev,
      polishes: prev.polishes.map((p) => p.id === id ? { ...p, deletedAt: undefined, updatedAt: now() } : p),
    }));
    void sync();
  }, [commit, sync]);

  // Stickers
  const addSticker = useCallback((s: Omit<Sticker, 'id' | 'createdAt' | 'updatedAt'>) => {
    const item: Sticker = { ...s, id: generateId(), createdAt: now(), updatedAt: now() };
    commit((prev) => ({ ...prev, stickers: [...prev.stickers, item] }));
    void sync();
  }, [commit, sync]);

  const updateSticker = useCallback((id: string, changes: Partial<Sticker>) => {
    commit((prev) => ({
      ...prev,
      stickers: prev.stickers.map((s) => s.id === id ? { ...s, ...changes, updatedAt: now() } : s),
    }));
    void sync();
  }, [commit, sync]);

  const deleteSticker = useCallback((id: string): (() => void) => {
    const s = data.stickers.find((s) => s.id === id);
    commit((prev) => ({
      ...prev,
      stickers: prev.stickers.map((s) => s.id === id ? { ...s, deletedAt: now(), updatedAt: now() } : s),
    }));
    void sync();
    return () => { if (s?.photo) void deletePhotoFromServer(s.photo); };
  }, [data, commit, sync]);

  const restoreSticker = useCallback((id: string) => {
    commit((prev) => ({
      ...prev,
      stickers: prev.stickers.map((s) => s.id === id ? { ...s, deletedAt: undefined, updatedAt: now() } : s),
    }));
    void sync();
  }, [commit, sync]);

  // Manicures
  const addManicure = useCallback((m: Omit<Manicure, 'id' | 'createdAt' | 'updatedAt'>) => {
    const item: Manicure = { ...m, id: generateId(), createdAt: now(), updatedAt: now() };
    commit((prev) => ({ ...prev, manicures: [...prev.manicures, item] }));
    void sync();
  }, [commit, sync]);

  const updateManicure = useCallback((id: string, changes: Partial<Manicure>) => {
    commit((prev) => ({
      ...prev,
      manicures: prev.manicures.map((m) => m.id === id ? { ...m, ...changes, updatedAt: now() } : m),
    }));
    void sync();
  }, [commit, sync]);

  const deleteManicure = useCallback((id: string): (() => void) => {
    const m = data.manicures.find((m) => m.id === id);
    commit((prev) => ({
      ...prev,
      manicures: prev.manicures.map((m) => m.id === id ? { ...m, deletedAt: now(), updatedAt: now() } : m),
    }));
    void sync();
    return () => {
      if (m?.photo) void deletePhotoFromServer(m.photo);
      if (m?.photos) void Promise.all(Object.values(m.photos).filter((f): f is string => !!f).map(deletePhotoFromServer));
    };
  }, [data, commit, sync]);

  const restoreManicure = useCallback((id: string) => {
    commit((prev) => ({
      ...prev,
      manicures: prev.manicures.map((m) => m.id === id ? { ...m, deletedAt: undefined, updatedAt: now() } : m),
    }));
    void sync();
  }, [commit, sync]);

  // Categories
  const addCategory = useCallback((label: string) => {
    const item: Category = { id: generateId(), label, updatedAt: now() };
    commit((prev) => ({ ...prev, customCats: [...prev.customCats, item] }));
    void sync();
  }, [commit, sync]);

  const deleteCategory = useCallback((id: string) => {
    commit((prev) => ({
      ...prev,
      customCats: prev.customCats.map((c) => c.id === id ? { ...c, deletedAt: now(), updatedAt: now() } : c),
    }));
    void sync();
  }, [commit, sync]);

  // Direct import (merge imported JSON into local data)
  const importMerge = useCallback((merged: AppData) => {
    commit((prev) => mergeData(prev, merged));
    void sync();
  }, [commit, sync]);

  // Auto-sync on load
  useEffect(() => { void sync(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data,
    syncing,
    syncError,
    lastSyncAt,
    sync,
    importMerge,
    addPolish, updatePolish, deletePolish, restorePolish,
    addSticker, updateSticker, deleteSticker, restoreSticker,
    addManicure, updateManicure, deleteManicure, restoreManicure,
    addCategory, deleteCategory,
  };
}
