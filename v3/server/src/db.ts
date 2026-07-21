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

// ── AI config (global — LLM provider key/model for Auto-Fill & Smart-Cart) ────
// Stored the same way as the JWT secret / admin API key: plaintext on local
// disk, single-household trust model (see index.ts DATA_DIR comments).

export interface AiConfig {
  provider: 'openrouter';
  apiKey: string;
  model: string;
}

const AI_CONFIG_FILE = path.join(DATA_DIR, 'ai_config.json');

export function getAiConfig(): AiConfig | null {
  try {
    if (!fs.existsSync(AI_CONFIG_FILE)) return null;
    return JSON.parse(fs.readFileSync(AI_CONFIG_FILE, 'utf-8')) as AiConfig;
  } catch {
    return null;
  }
}

export function setAiConfig(config: AiConfig | null): void {
  if (!config) {
    if (fs.existsSync(AI_CONFIG_FILE)) fs.unlinkSync(AI_CONFIG_FILE);
    return;
  }
  const tmp = `${AI_CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config), { mode: 0o600 });
  fs.renameSync(tmp, AI_CONFIG_FILE);
}

// ── AI jobs (background queue for Auto-Fill & Smart-Cart) ────────────────────

export type AiJobType = 'autofill' | 'smart-cart';
export type AiJobStatus = 'pending' | 'running' | 'done' | 'error';

export interface AiJob {
  id: string;
  type: AiJobType;
  status: AiJobStatus;
  input: unknown;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const AI_JOBS_FILE = path.join(DATA_DIR, 'ai_jobs.json');
const AI_JOBS_MAX = 50; // trim history — this is a personal-scale queue, not an audit log

function readAiJobs(): AiJob[] {
  try {
    if (!fs.existsSync(AI_JOBS_FILE)) return [];
    return JSON.parse(fs.readFileSync(AI_JOBS_FILE, 'utf-8')) as AiJob[];
  } catch {
    return [];
  }
}

function writeAiJobs(jobs: AiJob[]): void {
  const trimmed = jobs.slice(-AI_JOBS_MAX);
  const tmp = `${AI_JOBS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(trimmed));
  fs.renameSync(tmp, AI_JOBS_FILE);
}

export function createAiJob(id: string, type: AiJobType, input: unknown): AiJob {
  const jobs = readAiJobs();
  const job: AiJob = { id, type, status: 'pending', input, createdAt: Date.now(), updatedAt: Date.now() };
  jobs.push(job);
  writeAiJobs(jobs);
  return job;
}

export function getAiJob(id: string): AiJob | undefined {
  return readAiJobs().find((j) => j.id === id);
}

export function getNextPendingAiJob(): AiJob | undefined {
  return readAiJobs().find((j) => j.status === 'pending');
}

export function updateAiJob(id: string, changes: Partial<AiJob>): void {
  const jobs = readAiJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return;
  jobs[idx] = { ...jobs[idx], ...changes, updatedAt: Date.now() };
  writeAiJobs(jobs);
}

// Called once at startup: jobs left 'running' from before a crash/restart
// can never finish, so requeue them rather than leaving them stuck forever.
export function requeueStaleAiJobs(): void {
  const jobs = readAiJobs();
  let changed = false;
  for (const job of jobs) {
    if (job.status === 'running') {
      job.status = 'pending';
      job.updatedAt = Date.now();
      changed = true;
    }
  }
  if (changed) writeAiJobs(jobs);
}
