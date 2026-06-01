import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import type { AppData, Polish, Manicure, Sticker, Category } from '@nagellacke/core';
import { generateId, now } from '@nagellacke/core';
import type { SyncConfig } from '@nagellacke/sync';
import { createAdapter } from '@nagellacke/sync';
import { loadData, saveData } from './storage';

const SYNC_CONFIG_KEY = 'sync_config';

async function loadSyncConfig(): Promise<SyncConfig | null> {
  try {
    const raw = await SecureStore.getItemAsync(SYNC_CONFIG_KEY);
    if (raw) return JSON.parse(raw) as SyncConfig;
  } catch { /* empty */ }
  return null;
}

async function saveSyncConfig(config: SyncConfig | null): Promise<void> {
  if (config) await SecureStore.setItemAsync(SYNC_CONFIG_KEY, JSON.stringify(config));
  else await SecureStore.deleteItemAsync(SYNC_CONFIG_KEY);
}

interface AppDataCtx {
  data: AppData;
  syncing: boolean;
  syncError: string | null;
  lastSyncAt: number | null;
  sync: () => Promise<void>;
  syncConfig: SyncConfig | null;
  setSyncConfig: (config: SyncConfig | null) => Promise<void>;
  addPolish: (p: Omit<Polish, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updatePolish: (id: string, changes: Partial<Polish>) => void;
  deletePolish: (id: string) => void;
  addSticker: (s: Omit<Sticker, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateSticker: (id: string, changes: Partial<Sticker>) => void;
  deleteSticker: (id: string) => void;
  addManicure: (m: Omit<Manicure, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateManicure: (id: string, changes: Partial<Manicure>) => void;
  deleteManicure: (id: string) => void;
  addCategory: (label: string) => void;
  deleteCategory: (id: string) => void;
}

const Ctx = createContext<AppDataCtx | null>(null);

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setDataState] = useState<AppData>({ polishes: [], customCats: [], manicures: [], stickers: [] });
  const [syncConfig, setSyncConfigState] = useState<SyncConfig | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const [stored, cfg] = await Promise.all([loadData(), loadSyncConfig()]);
      setDataState(stored);
      setSyncConfigState(cfg);
    })();
  }, []);

  const commit = useCallback(async (next: AppData) => {
    await saveData(next);
    setDataState(next);
  }, []);

  const addPolish = useCallback((p: Omit<Polish, 'id' | 'createdAt' | 'updatedAt'>) => {
    const item: Polish = { ...p, id: generateId(), createdAt: now(), updatedAt: now() };
    void commit({ ...data, polishes: [...data.polishes, item] });
  }, [data, commit]);

  const updatePolish = useCallback((id: string, changes: Partial<Polish>) => {
    void commit({ ...data, polishes: data.polishes.map((p) => p.id === id ? { ...p, ...changes, updatedAt: now() } : p) });
  }, [data, commit]);

  const deletePolish = useCallback((id: string) => {
    void commit({ ...data, polishes: data.polishes.map((p) => p.id === id ? { ...p, deletedAt: now(), updatedAt: now() } : p) });
  }, [data, commit]);

  const addSticker = useCallback((s: Omit<Sticker, 'id' | 'createdAt' | 'updatedAt'>) => {
    const item: Sticker = { ...s, id: generateId(), createdAt: now(), updatedAt: now() };
    void commit({ ...data, stickers: [...data.stickers, item] });
  }, [data, commit]);

  const updateSticker = useCallback((id: string, changes: Partial<Sticker>) => {
    void commit({ ...data, stickers: data.stickers.map((s) => s.id === id ? { ...s, ...changes, updatedAt: now() } : s) });
  }, [data, commit]);

  const deleteSticker = useCallback((id: string) => {
    void commit({ ...data, stickers: data.stickers.map((s) => s.id === id ? { ...s, deletedAt: now(), updatedAt: now() } : s) });
  }, [data, commit]);

  const addManicure = useCallback((m: Omit<Manicure, 'id' | 'createdAt' | 'updatedAt'>) => {
    const item: Manicure = { ...m, id: generateId(), createdAt: now(), updatedAt: now() };
    void commit({ ...data, manicures: [...data.manicures, item] });
  }, [data, commit]);

  const updateManicure = useCallback((id: string, changes: Partial<Manicure>) => {
    void commit({ ...data, manicures: data.manicures.map((m) => m.id === id ? { ...m, ...changes, updatedAt: now() } : m) });
  }, [data, commit]);

  const deleteManicure = useCallback((id: string) => {
    void commit({ ...data, manicures: data.manicures.map((m) => m.id === id ? { ...m, deletedAt: now(), updatedAt: now() } : m) });
  }, [data, commit]);

  const addCategory = useCallback((label: string) => {
    const item: Category = { id: generateId(), label, updatedAt: now() };
    void commit({ ...data, customCats: [...data.customCats, item] });
  }, [data, commit]);

  const deleteCategory = useCallback((id: string) => {
    void commit({ ...data, customCats: data.customCats.map((c) => c.id === id ? { ...c, deletedAt: now(), updatedAt: now() } : c) });
  }, [data, commit]);

  const setSyncConfig = useCallback(async (config: SyncConfig | null) => {
    await saveSyncConfig(config);
    setSyncConfigState(config);
  }, []);

  const sync = useCallback(async () => {
    if (!syncConfig) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const adapter = createAdapter(syncConfig);
      const result = await adapter.sync(data);
      if (result.success) {
        await commit(result.merged);
        setLastSyncAt(result.lastSyncAt);
      } else {
        setSyncError(result.error ?? 'Sync fehlgeschlagen');
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setSyncing(false);
    }
  }, [syncConfig, data, commit]);

  const value: AppDataCtx = {
    data, syncing, syncError, lastSyncAt, sync, syncConfig, setSyncConfig,
    addPolish, updatePolish, deletePolish,
    addSticker, updateSticker, deleteSticker,
    addManicure, updateManicure, deleteManicure,
    addCategory, deleteCategory,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppDataCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppData must be used inside AppDataProvider');
  return ctx;
}
