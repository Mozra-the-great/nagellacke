import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AppData } from '@nagellacke/core';

export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
// Pre-multi-account layout (single global collection). Kept around only so the
// first-ever user on an existing install can be migrated into their own directory.
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'data.json');
const LEGACY_SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
export const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PHOTOS_DIR, { recursive: true });
fs.mkdirSync(USERS_DIR, { recursive: true });

// Usernames become filesystem path segments below, so they're restricted to a
// safe charset (also enforced at registration) to rule out path traversal.
export function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_-]{1,32}$/.test(username);
}

function userDir(username: string): string {
  if (!isValidUsername(username)) throw new Error(`Invalid username: ${username}`);
  const dir = path.join(USERS_DIR, username);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// True if `username` is the earliest-registered account — used to decide who
// inherits data from a pre-multi-account (single global file) install.
function isFirstUser(username: string): boolean {
  const users = readUsers();
  if (users.length === 0) return false;
  const first = users.reduce((a, b) => (a.created_at <= b.created_at ? a : b));
  return first.username === username;
}

// ── App data ──────────────────────────────────────────────────────────────────

const EMPTY_DATA: AppData = { polishes: [], customCats: [], manicures: [], stickers: [] };

export function getData(username: string): AppData {
  const dataFile = path.join(userDir(username), 'data.json');
  try {
    if (!fs.existsSync(dataFile)) {
      if (isFirstUser(username) && fs.existsSync(LEGACY_DATA_FILE)) {
        fs.copyFileSync(LEGACY_DATA_FILE, dataFile);
      } else {
        return EMPTY_DATA;
      }
    }
    const raw = JSON.parse(fs.readFileSync(dataFile, 'utf-8')) as Partial<AppData>;
    return {
      polishes:   (raw.polishes   ?? []).map((p) => p.count == null ? { ...p, count: 1 } : p),
      customCats: raw.customCats  ?? [],
      manicures:  raw.manicures   ?? [],
      stickers:   raw.stickers    ?? [],
    };
  } catch (e) {
    console.error('data.json corrupt — returning empty:', e);
    return EMPTY_DATA;
  }
}

export function setData(username: string, data: AppData): void {
  const dataFile = path.join(userDir(username), 'data.json');
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, dataFile);
}

// ── Users ─────────────────────────────────────────────────────────────────────

interface User {
  username: string;
  password_hash: string;
  created_at: number;
  email?: string;
}

function readUsers(): User[] {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')) as User[];
  } catch (e) {
    console.error('users.json corrupt — returning empty:', e);
    return [];
  }
}

function writeUsers(users: User[]): void {
  const tmp = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(users));
  fs.renameSync(tmp, USERS_FILE);
}

export function getUser(username: string): User | undefined {
  return readUsers().find((u) => u.username === username);
}

export function getUserCount(): number {
  return readUsers().length;
}

export function listUsernames(): string[] {
  return readUsers().map((u) => u.username);
}

export function createUser(username: string, passwordHash: string): void {
  const users = readUsers();
  users.push({ username, password_hash: passwordHash, created_at: Date.now() });
  writeUsers(users);
}

export function updateUserEmail(username: string, email: string): void {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx >= 0) {
    users[idx] = { ...users[idx], email };
    writeUsers(users);
  }
}

// ── Report schedule config ────────────────────────────────────────────────────

export interface ScheduleConfig {
  enabled: boolean;
  frequency: 'weekly' | 'monthly';
  toEmail: string;
  lastSentAt?: number;
}

export function getScheduleConfig(username: string): ScheduleConfig | null {
  const file = path.join(userDir(username), 'schedule.json');
  try {
    if (!fs.existsSync(file)) {
      if (isFirstUser(username) && fs.existsSync(LEGACY_SCHEDULE_FILE)) {
        fs.copyFileSync(LEGACY_SCHEDULE_FILE, file);
      } else {
        return null;
      }
    }
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ScheduleConfig;
  } catch {
    return null;
  }
}

export function setScheduleConfig(username: string, config: ScheduleConfig): void {
  const file = path.join(userDir(username), 'schedule.json');
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config));
  fs.renameSync(tmp, file);
}
