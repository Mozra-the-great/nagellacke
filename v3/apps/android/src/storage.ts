import * as FileSystem from 'expo-file-system';
import type { AppData } from '@nagellacke/core';

const DATA_PATH = `${FileSystem.documentDirectory}nagellacke-data.json`;

const EMPTY: AppData = { polishes: [], customCats: [], manicures: [], stickers: [] };

export async function loadData(): Promise<AppData> {
  try {
    const info = await FileSystem.getInfoAsync(DATA_PATH);
    if (!info.exists) return EMPTY;
    const raw = await FileSystem.readAsStringAsync(DATA_PATH);
    return JSON.parse(raw) as AppData;
  } catch {
    return EMPTY;
  }
}

export async function saveData(data: AppData): Promise<void> {
  await FileSystem.writeAsStringAsync(DATA_PATH, JSON.stringify(data));
}
