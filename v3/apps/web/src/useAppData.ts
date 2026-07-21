import { useState, useCallback, useEffect } from 'react';
import type { AppData, Polish, Manicure, Sticker, Category } from '@nagellacke/core';
import { generateId, now, mergeData } from '@nagellacke/core';
import type { SyncConfig } from '@nagellacke/sync';
import { createAdapter } from '@nagellacke/sync';

async function deletePhotoFromServer(filename: string): Promise<void> {
  const config = loadSyncConfig();
  if (!config) return;
  try {
    const adapter = createAdapter(config);
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

export function useAppData() {
  const [data, setDataState] = useState<AppData>(loadLocal);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  // Takes an updater rather than a plain value so long-running async callers
  // (e.g. an AI background job that resolves a minute later) always apply
  // their change on top of the latest state instead of clobbering whatever
  // else happened in the meantime with a stale snapshot.
  const commit = useCallback((updater: (prev: AppData) => AppData) => {
    setDataState((prev) => {
      const next = updater(prev);
      saveLocal(next);
      return next;
    });
  }, []);

  // Polishes
  const addPolish = useCallback((p: Omit<Polish, 'id' | 'createdAt' | 'updatedAt'>): Polish => {
    const item: Polish = { ...p, id: generateId(), createdAt: now(), updatedAt: now() };
    commit((prev) => ({ ...prev, polishes: [...prev.polishes, item] }));
    return item;
  }, [commit]);

  const updatePolish = useCallback((id: string, changes: Partial<Polish>) => {
    commit((prev) => ({
      ...prev,
      polishes: prev.polishes.map((p) => p.id === id ? { ...p, ...changes, updatedAt: now() } : p),
    }));
  }, [commit]);

  const deletePolish = useCallback((id: string): (() => void) => {
    const p = data.polishes.find((p) => p.id === id);
    commit((prev) => ({
      ...prev,
      polishes: prev.polishes.map((p) => p.id === id ? { ...p, deletedAt: now(), updatedAt: now() } : p),
    }));
    return () => { if (p?.photo) void deletePhotoFromServer(p.photo); };
  }, [data, commit]);

  const restorePolish = useCallback((id: string) => {
    commit((prev) => ({
      ...prev,
      polishes: prev.polishes.map((p) => p.id === id ? { ...p, deletedAt: undefined, updatedAt: now() } : p),
    }));
  }, [commit]);

  // Stickers
  const addSticker = useCallback((s: Omit<Sticker, 'id' | 'createdAt' | 'updatedAt'>) => {
    const item: Sticker = { ...s, id: generateId(), createdAt: now(), updatedAt: now() };
    commit((prev) => ({ ...prev, stickers: [...prev.stickers, item] }));
  }, [commit]);

  const updateSticker = useCallback((id: string, changes: Partial<Sticker>) => {
    commit((prev) => ({
      ...prev,
      stickers: prev.stickers.map((s) => s.id === id ? { ...s, ...changes, updatedAt: now() } : s),
    }));
  }, [commit]);

  const deleteSticker = useCallback((id: string): (() => void) => {
    const s = data.stickers.find((s) => s.id === id);
    commit((prev) => ({
      ...prev,
      stickers: prev.stickers.map((s) => s.id === id ? { ...s, deletedAt: now(), updatedAt: now() } : s),
    }));
    return () => { if (s?.photo) void deletePhotoFromServer(s.photo); };
  }, [data, commit]);

  const restoreSticker = useCallback((id: string) => {
    commit((prev) => ({
      ...prev,
      stickers: prev.stickers.map((s) => s.id === id ? { ...s, deletedAt: undefined, updatedAt: now() } : s),
    }));
  }, [commit]);

  // Manicures
  const addManicure = useCallback((m: Omit<Manicure, 'id' | 'createdAt' | 'updatedAt'>) => {
    const item: Manicure = { ...m, id: generateId(), createdAt: now(), updatedAt: now() };
    commit((prev) => ({ ...prev, manicures: [...prev.manicures, item] }));
  }, [commit]);

  const updateManicure = useCallback((id: string, changes: Partial<Manicure>) => {
    commit((prev) => ({
      ...prev,
      manicures: prev.manicures.map((m) => m.id === id ? { ...m, ...changes, updatedAt: now() } : m),
    }));
  }, [commit]);

  const deleteManicure = useCallback((id: string): (() => void) => {
    const m = data.manicures.find((m) => m.id === id);
    commit((prev) => ({
      ...prev,
      manicures: prev.manicures.map((m) => m.id === id ? { ...m, deletedAt: now(), updatedAt: now() } : m),
    }));
    return () => {
      if (m?.photo) void deletePhotoFromServer(m.photo);
      if (m?.photos) void Promise.all(Object.values(m.photos).filter((f): f is string => !!f).map(deletePhotoFromServer));
    };
  }, [data, commit]);

  const restoreManicure = useCallback((id: string) => {
    commit((prev) => ({
      ...prev,
      manicures: prev.manicures.map((m) => m.id === id ? { ...m, deletedAt: undefined, updatedAt: now() } : m),
    }));
  }, [commit]);

  // Categories
  const addCategory = useCallback((label: string) => {
    const item: Category = { id: generateId(), label, updatedAt: now() };
    commit((prev) => ({ ...prev, customCats: [...prev.customCats, item] }));
  }, [commit]);

  const deleteCategory = useCallback((id: string) => {
    commit((prev) => ({
      ...prev,
      customCats: prev.customCats.map((c) => c.id === id ? { ...c, deletedAt: now(), updatedAt: now() } : c),
    }));
  }, [commit]);

  // Direct import (merge imported JSON into local data)
  const importMerge = useCallback((merged: AppData) => {
    commit((prev) => mergeData(prev, merged));
  }, [commit]);

  // Sync
  const sync = useCallback(async () => {
    const config = loadSyncConfig();
    if (!config) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const adapter = createAdapter(config);
      const result = await adapter.sync(data);
      if (result.success) {
        // Merge against whatever's latest (not the `data` snapshot this
        // closure started with) so edits made while this sync was in flight
        // aren't discarded.
        commit((prev) => mergeData(prev, result.merged));
        setLastSyncAt(result.lastSyncAt);
      } else {
        setSyncError(result.error ?? 'Sync fehlgeschlagen');
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setSyncing(false);
    }
  }, [data, commit]);

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
