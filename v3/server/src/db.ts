import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AppData } from '@nagellacke/core';

export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
export const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

// ── App data ──────────────────────────────────────────────────────────────────

const EMPTY_DATA: AppData = { polishes: [], customCats: [], manicures: [], stickers: [] };

export function getData(): AppData {
  try {
    if (!fs.existsSync(DATA_FILE)) return EMPTY_DATA;
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as Partial<AppData>;
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

export function setData(data: AppData): void {
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, DATA_FILE);
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

const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');

export function getScheduleConfig(): ScheduleConfig | null {
  try {
    if (!fs.existsSync(SCHEDULE_FILE)) return null;
    return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8')) as ScheduleConfig;
  } catch {
    return null;
  }
}

export function setScheduleConfig(config: ScheduleConfig): void {
  const tmp = `${SCHEDULE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config));
  fs.renameSync(tmp, SCHEDULE_FILE);
}

// ── AI config (KI-Assistenz) ──────────────────────────────────────────────────

export type AiProvider = 'openrouter' | 'gemini';

export interface AiConfig {
  provider: AiProvider;
  openrouter: { apiKey: string; model: string; freeOnly: boolean };
  gemini: { apiKey: string; model: string };
}

const AI_CONFIG_FILE = path.join(DATA_DIR, 'ai_config.json');

const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'openrouter',
  openrouter: { apiKey: '', model: 'openrouter/auto', freeOnly: false },
  gemini: { apiKey: '', model: 'gemini-2.5-flash' },
};

export function getAiConfig(): AiConfig {
  try {
    if (!fs.existsSync(AI_CONFIG_FILE)) return DEFAULT_AI_CONFIG;
    const raw = JSON.parse(fs.readFileSync(AI_CONFIG_FILE, 'utf-8')) as Partial<AiConfig>;
    return {
      provider: raw.provider === 'gemini' ? 'gemini' : 'openrouter',
      openrouter: { ...DEFAULT_AI_CONFIG.openrouter, ...raw.openrouter },
      gemini: { ...DEFAULT_AI_CONFIG.gemini, ...raw.gemini },
    };
  } catch {
    return DEFAULT_AI_CONFIG;
  }
}

export function setAiConfig(config: AiConfig): void {
  const tmp = `${AI_CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config), { mode: 0o600 });
  fs.renameSync(tmp, AI_CONFIG_FILE);
}

// ── AI background jobs (Auto-Fill / Smart-Cart) ───────────────────────────────

export type AiJobType = 'autofill' | 'smart-cart';
export type AiJobStatus = 'pending' | 'running' | 'done' | 'error';

export interface AiJob {
  id: string;
  type: AiJobType;
  status: AiJobStatus;
  input: {
    // Auto-Fill only needs name/brand/num to research — no dependency on the
    // polish already existing server-side, so the client doesn't need to sync
    // before kicking off the job.
    polish?: { name: string; brand: string; num: string };
    prompt?: string;
  };
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const AI_JOBS_FILE = path.join(DATA_DIR, 'ai_jobs.json');
const MAX_STORED_AI_JOBS = 200;

function readAiJobs(): AiJob[] {
  try {
    if (!fs.existsSync(AI_JOBS_FILE)) return [];
    return JSON.parse(fs.readFileSync(AI_JOBS_FILE, 'utf-8')) as AiJob[];
  } catch {
    return [];
  }
}

function writeAiJobs(jobs: AiJob[]): void {
  const tmp = `${AI_JOBS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(jobs));
  fs.renameSync(tmp, AI_JOBS_FILE);
}

export function getAiJob(id: string): AiJob | undefined {
  return readAiJobs().find((j) => j.id === id);
}

export function getNextPendingAiJob(): AiJob | undefined {
  return readAiJobs().find((j) => j.status === 'pending');
}

export function addAiJob(job: AiJob): void {
  const jobs = readAiJobs();
  jobs.push(job);
  // Keep the job log bounded — it's a processing queue/history, not primary data.
  writeAiJobs(jobs.slice(-MAX_STORED_AI_JOBS));
}

export function updateAiJob(id: string, changes: Partial<Omit<AiJob, 'id'>>): void {
  const jobs = readAiJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx >= 0) {
    jobs[idx] = { ...jobs[idx], ...changes, updatedAt: Date.now() };
    writeAiJobs(jobs);
  }
}
