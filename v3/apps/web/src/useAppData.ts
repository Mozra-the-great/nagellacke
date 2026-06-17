import { useState, useCallback, useEffect } from 'react';
import type { AppData, Polish, Manicure, Sticker, Category } from '@nagellacke/core';
import { generateId, now } from '@nagellacke/core';
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

  const commit = useCallback((next: AppData) => {
    saveLocal(next);
    setDataState(next);
  }, []);

  // Polishes
  const addPolish = useCallback((p: Omit<Polish, 'id' | 'createdAt' | 'updatedAt'>) => {
    const item: Polish = { ...p, id: generateId(), createdAt: now(), updatedAt: now() };
    commit({ ...data, polishes: [...data.polishes, item] });
  }, [data, commit]);

  const updatePolish = useCallback((id: string, changes: Partial<Polish>) => {
    commit({
      ...data,
      polishes: data.polishes.map((p) => p.id === id ? { ...p, ...changes, updatedAt: now() } : p),
    });
  }, [data, commit]);

  const deletePolish = useCallback((id: string) => {
    const p = data.polishes.find((p) => p.id === id);
    if (p?.photo) void deletePhotoFromServer(p.photo);
    commit({
      ...data,
      polishes: data.polishes.map((p) => p.id === id ? { ...p, deletedAt: now(), updatedAt: now() } : p),
    });
  }, [data, commit]);

  const restorePolish = useCallback((id: string) => {
    commit({
      ...data,
      polishes: data.polishes.map((p) => p.id === id ? { ...p, deletedAt: undefined, updatedAt: now() } : p),
    });
  }, [data, commit]);

  // Stickers
  const addSticker = useCallback((s: Omit<Sticker, 'id' | 'createdAt' | 'updatedAt'>) => {
    const item: Sticker = { ...s, id: generateId(), createdAt: now(), updatedAt: now() };
    commit({ ...data, stickers: [...data.stickers, item] });
  }, [data, commit]);

  const updateSticker = useCallback((id: string, changes: Partial<Sticker>) => {
    commit({
      ...data,
      stickers: data.stickers.map((s) => s.id === id ? { ...s, ...changes, updatedAt: now() } : s),
    });
  }, [data, commit]);

  const deleteSticker = useCallback((id: string) => {
    const s = data.stickers.find((s) => s.id === id);
    if (s?.photo) void deletePhotoFromServer(s.photo);
    commit({
      ...data,
      stickers: data.stickers.map((s) => s.id === id ? { ...s, deletedAt: now(), updatedAt: now() } : s),
    });
  }, [data, commit]);

  const restoreSticker = useCallback((id: string) => {
    commit({
      ...data,
      stickers: data.stickers.map((s) => s.id === id ? { ...s, deletedAt: undefined, updatedAt: now() } : s),
    });
  }, [data, commit]);

  // Manicures
  const addManicure = useCallback((m: Omit<Manicure, 'id' | 'createdAt' | 'updatedAt'>) => {
    const item: Manicure = { ...m, id: generateId(), createdAt: now(), updatedAt: now() };
    commit({ ...data, manicures: [...data.manicures, item] });
  }, [data, commit]);

  const updateManicure = useCallback((id: string, changes: Partial<Manicure>) => {
    commit({
      ...data,
      manicures: data.manicures.map((m) => m.id === id ? { ...m, ...changes, updatedAt: now() } : m),
    });
  }, [data, commit]);

  const deleteManicure = useCallback((id: string) => {
    const m = data.manicures.find((m) => m.id === id);
    if (m?.photo) void deletePhotoFromServer(m.photo);
    if (m?.photos) {
      void Promise.all(
        Object.values(m.photos).filter((f): f is string => !!f).map(deletePhotoFromServer),
      );
    }
    commit({
      ...data,
      manicures: data.manicures.map((m) => m.id === id ? { ...m, deletedAt: now(), updatedAt: now() } : m),
    });
  }, [data, commit]);

  const restoreManicure = useCallback((id: string) => {
    commit({
      ...data,
      manicures: data.manicures.map((m) => m.id === id ? { ...m, deletedAt: undefined, updatedAt: now() } : m),
    });
  }, [data, commit]);

  // Categories
  const addCategory = useCallback((label: string) => {
    const item: Category = { id: generateId(), label, updatedAt: now() };
    commit({ ...data, customCats: [...data.customCats, item] });
  }, [data, commit]);

  const deleteCategory = useCallback((id: string) => {
    commit({
      ...data,
      customCats: data.customCats.map((c) => c.id === id ? { ...c, deletedAt: now(), updatedAt: now() } : c),
    });
  }, [data, commit]);

  // Direct import (merge imported JSON into local data)
  const importMerge = useCallback((merged: AppData) => {
    commit(merged);
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
        commit(result.merged);
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
