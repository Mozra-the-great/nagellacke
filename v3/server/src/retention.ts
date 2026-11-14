import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { purgeExpiredTombstones, type AppData } from '@nagellacke/core';
import {
  DATA_DIR, PHOTOS_DIR, USER_DATA_DIR, userDirName, deleteUser, deleteAiJobsOf, photosOwnedBy, photoOwner, getUser,
} from './db';

/**
 * Retention of what an account deletion leaves behind (#463) and of old deletion markers
 * in the collections (#464). Everything here is a periodic, idempotent job: it runs at
 * server start and then hourly (index.ts main()), every state it needs is on disk, and a
 * second run right after the first changes nothing.
 *
 * Logs name counts, entry ids and error codes only - never a username, a file path or a
 * photo name (an fs error message embeds the path, and the path embeds the username).
 */

/** How long an admin deletion's leftovers (renamed collection, photo files) are kept (F101.4). */
export const ADMIN_DELETION_RETENTION_DAYS = 30;
export const ADMIN_DELETION_RETENTION_MS = ADMIN_DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const PENDING_FILE = path.join(DATA_DIR, 'pending_deletions.json');
/** The name deleteUser() gives the renamed collection: `data.json.deleted-<unix ms>`. */
const DELETED_COLLECTION = /^data\.json\.deleted-(\d+)$/;

/** One admin deletion that still has data to remove. */
export interface PendingDeletion {
  /** Random; the only thing the log says about an entry. */
  id: string;
  /** Directory name under users/ (escaped canonical username), so no later account can be mistaken for it. */
  dir: string;
  deletedAt: number;
  /** Basenames of the renamed collection files inside users/<dir>/. */
  files: string[];
  /** Photo filenames the account had uploaded, captured before deleteUser() drops the ownership rows. */
  photos: string[];
}

interface PendingFile { v: 1; entries: PendingDeletion[] }

interface Logger {
  log(message: string): void;
  warn(message: string): void;
}

function errCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'error';
}

// ── pending_deletions.json ───────────────────────────────────────────────────

function isEntry(v: unknown): v is PendingDeletion {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  const strings = (x: unknown): boolean => Array.isArray(x) && x.every((s) => typeof s === 'string');
  return typeof e.id === 'string' && typeof e.dir === 'string' && e.dir !== '' &&
    typeof e.deletedAt === 'number' && Number.isFinite(e.deletedAt) &&
    strings(e.files) && strings(e.photos);
}

/**
 * The recorded entries. A file that cannot be parsed is moved aside (never overwritten
 * with an empty list) and the run goes on with none: the renamed collections are still
 * caught by the age-based sweep, only the photo list is lost, and the moved-aside file
 * stays for the operator.
 */
function readPending(now: number, logger: Logger): PendingDeletion[] {
  if (!fs.existsSync(PENDING_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf-8')) as Partial<PendingFile> | null;
    const list = Array.isArray(raw?.entries) ? raw.entries : [];
    const valid = list.filter(isEntry);
    if (valid.length !== list.length) logger.warn(`[retention] ${list.length - valid.length} malformed pending deletion(s) ignored.`);
    return valid;
  } catch (e) {
    const aside = `${PENDING_FILE}.corrupt-${now}`;
    try { fs.renameSync(PENDING_FILE, aside); } catch { /* leave it where it is */ }
    logger.warn(`[retention] pending_deletions.json could not be parsed (${errCode(e)}); moved aside, continuing without it.`);
    return [];
  }
}

function writePending(entries: PendingDeletion[]): void {
  const tmp = `${PENDING_FILE}.tmp`;
  const body: PendingFile = { v: 1, entries };
  fs.writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 });
  fs.renameSync(tmp, PENDING_FILE);
}

// ── Recording an admin deletion ──────────────────────────────────────────────

/**
 * What the admin route calls instead of a bare deleteUser(): removes the login, renames
 * the collection, drops the account's AI jobs, and records what is left (collection
 * file, photo files) with the deletion time so purgePendingDeletions() can remove it
 * 30 days later.
 *
 * Order matters. The photo list is read first because deleteUser() drops the ownership
 * rows, and the entry is written before the account is touched: a crash in between
 * leaves an entry for an account that still exists, which the purge ignores (see
 * photoStillNeeded()), instead of leaving unattributable files nobody will ever remove.
 *
 * The AI jobs are removed at once rather than after the period: they are keyed by the
 * account name, so an account registered under the same name would otherwise see them.
 * The schedule is the caller's (deleteScheduleConfig).
 */
export function adminDeleteAccount(username: string, now: number = Date.now()): void {
  const photos = photosOwnedBy(username);
  const entry: PendingDeletion = {
    id: crypto.randomBytes(8).toString('hex'),
    dir: userDirName(username),
    deletedAt: now,
    files: [`data.json.deleted-${now}`],
    photos,
  };
  writePending([...readPending(now, console), entry]);
  deleteUser(username, now);
  deleteAiJobsOf(username);
}

// ── Purging ──────────────────────────────────────────────────────────────────

export interface PurgeSummary {
  entriesPurged: number;
  entriesFailed: number;
  collectionsRemoved: number;
  photosRemoved: number;
  photosKept: number;
}

/** Removes `root/segments...` if it stays inside `root`; 'unsafe' when it would not. */
function removeInside(root: string, ...segments: string[]): 'removed' | 'absent' | 'unsafe' {
  const base = path.resolve(root);
  const target = path.resolve(base, ...segments);
  if (!target.startsWith(base + path.sep)) return 'unsafe';
  try {
    fs.lstatSync(target);
  } catch (e) {
    if ((e as { code?: unknown }).code === 'ENOENT') return 'absent';
    throw e;
  }
  fs.rmSync(target, { force: true });
  return 'removed';
}

function userDirs(): string[] {
  try {
    return fs.readdirSync(USER_DATA_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Every photo filename that some account's records still mention (deleted records
 * included, like userOwnsPhoto()), read from the collection files on disk rather than
 * from users.json so that an unreadable users.json can never read as "nobody uses
 * anything". null when any collection could not be parsed: then nothing may be judged
 * unused and the caller must not delete photos in this run.
 */
function referencedByAnyAccount(): Set<string> | null {
  const refs = new Set<string>();
  const add = (v: unknown): void => { if (typeof v === 'string' && v) refs.add(v); };
  for (const dir of userDirs()) {
    const file = path.join(USER_DATA_DIR, dir, 'data.json');
    if (!fs.existsSync(file)) continue;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
    } catch {
      return null;
    }
    const list = (k: string): Record<string, unknown>[] => (Array.isArray(data[k]) ? data[k] as Record<string, unknown>[] : []);
    for (const p of list('polishes')) add(p?.photo);
    for (const s of list('stickers')) add(s?.photo);
    for (const m of list('manicures')) {
      add(m?.photo);
      const slots = m?.photos;
      if (slots && typeof slots === 'object') for (const f of Object.values(slots)) add(f);
    }
  }
  return refs;
}

/**
 * Whether a recorded photo must stay: some account's records reference it (also a
 * reference that appeared after the deletion, and a same-name account's own), or it is
 * recorded as an existing account's upload (which is what an entry written for an
 * account that was never actually deleted looks like).
 */
function photoStillNeeded(filename: string, refs: Set<string>): boolean {
  if (refs.has(filename)) return true;
  const owner = photoOwner(filename);
  return owner !== undefined && getUser(owner) !== undefined;
}

/**
 * Removes everything an admin deletion left behind once it is ADMIN_DELETION_RETENTION_DAYS
 * old, then drops the entry. Younger entries are not touched. Idempotent (what is gone
 * is not an error); an entry that fails stays for the next run and does not stop the
 * others. Only the recorded collection files and photo files are removed - never the
 * account directory, its current data.json or anything of an account registered later
 * under the same name.
 */
export function purgePendingDeletions(now: number = Date.now(), logger: Logger = console): PurgeSummary {
  const summary: PurgeSummary = { entriesPurged: 0, entriesFailed: 0, collectionsRemoved: 0, photosRemoved: 0, photosKept: 0 };
  const entries = readPending(now, logger);
  const due = entries.filter((e) => now - e.deletedAt >= ADMIN_DELETION_RETENTION_MS);
  if (due.length === 0) return summary;

  const dirsToTidy = new Set<string>();
  const done = new Set<string>();
  let refs: Set<string> | null | undefined;
  for (const entry of due) {
    try {
      for (const name of entry.files) {
        if (!DELETED_COLLECTION.test(name)) { logger.warn(`[retention] entry ${entry.id}: unexpected collection file name skipped.`); continue; }
        if (removeInside(USER_DATA_DIR, entry.dir, name) === 'removed') summary.collectionsRemoved++;
      }
      dirsToTidy.add(entry.dir);
      if (entry.photos.length > 0) {
        if (refs === undefined) refs = referencedByAnyAccount();
        if (refs === null) throw Object.assign(new Error('collections unreadable'), { code: 'EUNREADABLE' });
        for (const name of entry.photos) {
          if (name === '' || name !== path.basename(name)) { logger.warn(`[retention] entry ${entry.id}: unexpected photo name skipped.`); continue; }
          if (photoStillNeeded(name, refs)) { summary.photosKept++; continue; }
          if (removeInside(PHOTOS_DIR, name) === 'removed') summary.photosRemoved++;
        }
      }
      done.add(entry.id);
      summary.entriesPurged++;
    } catch (e) {
      summary.entriesFailed++;
      logger.warn(`[retention] entry ${entry.id} not fully purged (${errCode(e)}); will retry.`);
    }
  }
  if (done.size > 0) writePending(entries.filter((e) => !done.has(e.id)));
  for (const dir of dirsToTidy) tidyEmptyDir(dir);
  return summary;
}

/** A user directory emptied by a purge goes too; a non-empty one (a current account's) never does. */
function tidyEmptyDir(dir: string): void {
  const base = path.resolve(USER_DATA_DIR);
  const target = path.resolve(base, dir);
  if (!target.startsWith(base + path.sep)) return;
  try { fs.rmdirSync(target); } catch { /* not empty, or already gone */ }
}

/**
 * Deletions from before pending_deletions.json existed left `data.json.deleted-<ts>`
 * behind with no record. The timestamp in the name is the deletion time, so they are
 * removed the same 30 days after it. Files an entry already covers are left to it. Photos
 * of such accounts cannot be attributed and are not touched (CHANGELOG: manual step).
 */
export function purgeLegacyDeletedCollections(now: number = Date.now(), logger: Logger = console): number {
  const claimed = new Set<string>();
  for (const e of readPending(now, logger)) for (const f of e.files) claimed.add(`${e.dir}\0${f}`);
  let removed = 0;
  for (const dir of userDirs()) {
    let names: string[];
    try { names = fs.readdirSync(path.join(USER_DATA_DIR, dir)); } catch { continue; }
    const before = removed;
    for (const name of names) {
      const m = DELETED_COLLECTION.exec(name);
      if (!m || claimed.has(`${dir}\0${name}`)) continue;
      const ts = Number(m[1]);
      if (!Number.isSafeInteger(ts) || now - ts < ADMIN_DELETION_RETENTION_MS) continue;
      try {
        if (removeInside(USER_DATA_DIR, dir, name) === 'removed') removed++;
      } catch (e) {
        logger.warn(`[retention] a leftover collection file could not be removed (${errCode(e)}); will retry.`);
      }
    }
    if (removed > before) tidyEmptyDir(dir);
  }
  return removed;
}

/**
 * Drops expired deletion markers (#464) from every collection file on disk, so accounts
 * that never sync again are cleaned too. The raw JSON is edited, not the normalised
 * AppData, and a file is only rewritten (temp file + rename) when something expired. A
 * file that cannot be parsed stays untouched. The sync routes apply the same
 * purgeExpiredTombstones() whenever they write.
 * @returns the number of collections rewritten.
 */
export function purgeStoredTombstones(now: number = Date.now(), logger: Logger = console): number {
  let rewritten = 0;
  let unreadable = 0;
  for (const dir of userDirs()) {
    const file = path.join(USER_DATA_DIR, dir, 'data.json');
    try {
      if (!fs.existsSync(file)) continue;
      const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { unreadable++; continue; }
      const purged = purgeExpiredTombstones(raw as Partial<AppData>, now);
      if (purged === raw) continue;
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(purged), { mode: 0o600 });
      fs.renameSync(tmp, file);
      rewritten++;
    } catch (e) {
      if (e instanceof SyntaxError) unreadable++;
      else logger.warn(`[retention] a collection could not be cleaned (${errCode(e)}); will retry.`);
    }
  }
  if (unreadable > 0) logger.warn(`[retention] ${unreadable} collection file(s) could not be parsed and were left untouched.`);
  return rewritten;
}

export interface RetentionSummary extends PurgeSummary {
  legacyCollectionsRemoved: number;
  tombstoneCollectionsRewritten: number;
}

/**
 * The periodic job: pending admin deletions, old leftovers, expired markers. Each part
 * is isolated so one failing does not stop the others. `now` is injectable for tests.
 */
export function runRetentionJobs(now: number = Date.now(), logger: Logger = console): RetentionSummary {
  const out: RetentionSummary = {
    entriesPurged: 0, entriesFailed: 0, collectionsRemoved: 0, photosRemoved: 0, photosKept: 0,
    legacyCollectionsRemoved: 0, tombstoneCollectionsRewritten: 0,
  };
  const guard = (what: string, fn: () => void): void => {
    try { fn(); } catch (e) { logger.warn(`[retention] ${what} failed (${errCode(e)}).`); }
  };
  guard('pending deletions', () => Object.assign(out, purgePendingDeletions(now, logger)));
  guard('legacy leftovers', () => { out.legacyCollectionsRemoved = purgeLegacyDeletedCollections(now, logger); });
  guard('deletion markers', () => { out.tombstoneCollectionsRewritten = purgeStoredTombstones(now, logger); });
  const did = out.entriesPurged + out.collectionsRemoved + out.photosRemoved + out.legacyCollectionsRemoved + out.tombstoneCollectionsRewritten;
  if (did > 0) {
    logger.log(
      `[retention] purged ${out.entriesPurged} admin deletion(s) (${out.collectionsRemoved} collection file(s), ` +
      `${out.photosRemoved} photo(s) removed, ${out.photosKept} kept), ${out.legacyCollectionsRemoved} legacy leftover(s), ` +
      `${out.tombstoneCollectionsRewritten} collection(s) cleaned of old deletion markers.`,
    );
  }
  return out;
}
