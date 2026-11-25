import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { purgeExpiredTombstones, type AppData } from '@nagellacke/core';
import {
  DATA_DIR, PHOTOS_DIR, USER_DATA_DIR, userDirName, deleteUser, deleteAiJobsOf, photosOwnedBy, photoOwner, getUser,
  forgetPhotoOwner, readScheduleStoreStrict, writeScheduleStoreStrict, readUsersStrict, sameUsername,
  type ScheduleConfig,
} from './db';
import { RECIPIENT_CONFIRM_TTL_MS, normalizeEmail, recipientStatus } from './reportRecipient';
import { isAddressBlocked } from './reportUnsubscribe';

/**
 * Retention of what an account deletion leaves behind (#463), of old deletion markers
 * in the collections (#464), of photo files no record references any more (#465) and of report
 * recipients that never confirmed (#470). Everything here is a periodic, idempotent job: it runs at
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
  // Stryker disable next-line OptionalChaining: equivalent mutant - errCode() is only called with something that was thrown, which is never null or undefined here
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'error';
}

// ── pending_deletions.json ───────────────────────────────────────────────────

function isEntry(v: unknown): v is PendingDeletion {
  // Stryker disable next-line ConditionalExpression: equivalent mutant (typeof check) - a primitive has no id, so the field checks below refuse it with the same result
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  const strings = (x: unknown): boolean => Array.isArray(x) && x.every((s) => typeof s === 'string');
  // Stryker disable ConditionalExpression: equivalent mutant in the typeof check of deletedAt - Number.isFinite() does not coerce, so it already refuses every non-number (every other check in this statement is pinned by the tests)
  return typeof e.id === 'string' && typeof e.dir === 'string' && e.dir !== '' &&
    typeof e.deletedAt === 'number' && Number.isFinite(e.deletedAt) &&
    strings(e.files) && strings(e.photos);
  // Stryker restore ConditionalExpression
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
  // Stryker disable next-line StringLiteral: equivalent mutant - the caller only compares the result with the string removed, so any other value reads the same
  if (!target.startsWith(base + path.sep)) return 'unsafe';
  try {
    fs.lstatSync(target);
  } catch (e) {
    // Stryker disable next-line StringLiteral: equivalent mutant - the caller only compares the result with the string removed, so any other value reads the same
    if ((e as { code?: unknown }).code === 'ENOENT') return 'absent';
    throw e;
  }
  // Stryker disable next-line ObjectLiteral,BooleanLiteral: equivalent mutants - force only matters when the file vanishes between the lstat above and this call, and a directory fails either way
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
 * anything". `includeDeletedCollections` also reads the renamed `data.json.deleted-*`
 * files an admin deletion left: the orphan sweep must not take their photos away before
 * the deletion period is over, while the admin-deletion purge must not let them vouch
 * for their own photos. null when any collection could not be parsed: then nothing may
 * be judged unused and the caller must not delete photos in this run.
 */
function scanReferences(includeDeletedCollections: boolean): { refs: Set<string>; collections: number } | null {
  const refs = new Set<string>();
  let collections = 0;
  // Stryker disable next-line ConditionalExpression,LogicalOperator: equivalent mutants - a non-string or empty value added to the set can never equal a photo file name
  const add = (v: unknown): void => { if (typeof v === 'string' && v) refs.add(v); };
  for (const dir of userDirs()) {
    const names: string[] = [];
    if (fs.existsSync(path.join(USER_DATA_DIR, dir, 'data.json'))) names.push('data.json');
    if (includeDeletedCollections) {
      try {
        for (const n of fs.readdirSync(path.join(USER_DATA_DIR, dir))) if (DELETED_COLLECTION.test(n)) names.push(n);
      } catch {
        return null;
      }
    }
    for (const name of names) {
      let data: Record<string, unknown>;
      try {
        // Stryker disable next-line StringLiteral: equivalent mutant - without an encoding readFileSync returns a Buffer, which JSON.parse() stringifies to the same text
        const raw: unknown = JSON.parse(fs.readFileSync(path.join(USER_DATA_DIR, dir, name), 'utf-8'));
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        data = raw as Record<string, unknown>;
      } catch {
        return null;
      }
      // Stryker disable next-line UpdateOperator: equivalent mutant - the caller only asks whether the count is zero, and a count that only ever moves one way from zero is non-zero either way
      collections++;
      // Stryker disable next-line ArrayDeclaration: equivalent mutant - a stand-in string entry has no photo field, so it contributes nothing
      const list = (k: string): Record<string, unknown>[] => (Array.isArray(data[k]) ? data[k] as Record<string, unknown>[] : []);
      for (const p of list('polishes')) add(p?.photo);
      for (const s of list('stickers')) add(s?.photo);
      for (const m of list('manicures')) {
        add(m?.photo);
        const slots = m?.photos;
        // Stryker disable next-line ConditionalExpression: equivalent mutant (typeof check) - Object.values() of a non-object primitive gives characters or nothing, none of which is a photo file name
        if (slots && typeof slots === 'object') for (const f of Object.values(slots)) add(f);
      }
    }
  }
  return { refs, collections };
}

/** The photo references of the live collections only (see scanReferences()). */
function referencedByAnyAccount(): Set<string> | null {
  return scanReferences(false)?.refs ?? null;
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
  // Stryker disable next-line ConditionalExpression: equivalent mutant - with nothing due the loop and the writes below do nothing either
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
        // Stryker disable next-line ConditionalExpression: equivalent mutant - the scan of the live collections gives the same set every time, so scanning again per entry only costs time
        if (refs === undefined) refs = referencedByAnyAccount();
        // Stryker disable next-line StringLiteral: equivalent mutant for the message - only the code is ever logged; the code string is pinned by a test
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
      // Stryker disable next-line StringLiteral: equivalent mutant - without an encoding readFileSync returns a Buffer, which JSON.parse() stringifies to the same text
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

// ── Orphaned photo files (#465) ──────────────────────────────────────────────

/**
 * How old a photo file must be before the sweep may remove it. An upload comes first and
 * the record that references it follows with the next sync, which an offline-first client
 * can hold back for a while (no connection, a sync that keeps failing); a younger file is
 * never judged. A week covers that comfortably, and since an orphan is only the leftover
 * of a failed delete, keeping it a few days longer costs nothing.
 */
export const ORPHAN_PHOTO_GRACE_DAYS = 7;
export const ORPHAN_PHOTO_GRACE_MS = ORPHAN_PHOTO_GRACE_DAYS * 24 * 60 * 60 * 1000;

/**
 * What the sweep looks at: files named like the server names its own (`<uuid>.<ext>`,
 * image extensions only, plus the `.tmp` an interrupted upload leaves). Anything else an
 * operator put into the photo directory is not ours to judge.
 */
const SWEEPABLE_PHOTO = /^[\w-]+\.(?:jpe?g|png|webp|gif)(?:\.tmp)?$/i;

export interface OrphanPhotoSummary {
  removed: number;
  /** Could not be removed; retried next run. */
  failed: number;
  /** Old enough, but a collection (live, or awaiting its deletion period) references it. */
  referenced: number;
  /** Not old enough yet. */
  withinGrace: number;
  /** True when nothing was judged (unparsable or no collections). */
  skipped: boolean;
}

/**
 * Removes photo files that no record references any more. The web app deletes a photo
 * when its entry is deleted (after the undo window), but a failed `DELETE /api/photos/...`
 * leaves the file behind, and purging an old deletion marker (#464) does not touch it.
 *
 * What keeps a file:
 * - Some collection on disk references it, deleted records included. That covers a record
 *   inside its 90-day marker window and an admin-deleted account inside its 30 days (the
 *   renamed `data.json.deleted-*`, plus the photo list in pending_deletions.json). A
 *   recorded uploader is irrelevant here: it decides access, not retention.
 * - It is younger than ORPHAN_PHOTO_GRACE_DAYS (by mtime; a file dated in the future is
 *   young).
 * - It is not a regular file (symlinks and directories are never followed or removed) or
 *   not named like an upload.
 *
 * Photos without a recorded uploader (X-Api-Key uploads) are judged like all others:
 * nothing says whose they are, so the references decide.
 *
 * Nothing is judged when a collection cannot be parsed, or when no collection could be
 * read at all (an empty or wrongly mounted data directory must not read as "nothing is
 * used"). The run is synchronous like the upload and sync handlers, so no request can add
 * a reference between the scan and the removal. Idempotent; logs carry counts and error
 * codes only.
 */
export function sweepOrphanPhotos(now: number = Date.now(), logger: Logger = console): OrphanPhotoSummary {
  const summary: OrphanPhotoSummary = { removed: 0, failed: 0, referenced: 0, withinGrace: 0, skipped: false };
  let names: string[];
  try {
    names = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && SWEEPABLE_PHOTO.test(d.name))
      .map((d) => d.name);
  } catch (e) {
    if ((e as { code?: unknown }).code !== 'ENOENT') logger.warn(`[retention] photo directory could not be read (${errCode(e)}).`);
    return summary;
  }
  if (names.length === 0) return summary;

  const scan = scanReferences(true);
  if (scan === null || scan.collections === 0) {
    summary.skipped = true;
    logger.warn(scan === null
      ? '[retention] a collection could not be parsed; orphaned photos were not judged this run.'
      : '[retention] no collection could be read; orphaned photos were not judged this run.');
    return summary;
  }
  const pendingPhotos = new Set<string>();
  for (const entry of readPending(now, logger)) for (const name of entry.photos) pendingPhotos.add(name);

  for (const name of names) {
    try {
      const st = fs.lstatSync(path.join(PHOTOS_DIR, name));
      // Stryker disable next-line ConditionalExpression: equivalent mutant - the listing above already kept regular files only; this guards the moment between listing and lstat
      if (!st.isFile()) continue;
      if (now - st.mtimeMs < ORPHAN_PHOTO_GRACE_MS) { summary.withinGrace++; continue; }
      if (scan.refs.has(name) || pendingPhotos.has(name)) { summary.referenced++; continue; }
      if (removeInside(PHOTOS_DIR, name) === 'removed') {
        summary.removed++;
        forgetPhotoOwner(name);
      }
    } catch (e) {
      if ((e as { code?: unknown }).code === 'ENOENT') continue; // gone since the listing
      summary.failed++;
      logger.warn(`[retention] an orphaned photo could not be removed (${errCode(e)}); will retry.`);
    }
  }
  return summary;
}

// ── Unconfirmed report recipients (#470) ─────────────────────────────────────

/**
 * How long an unconfirmed recipient address is kept (F116.5 a): exactly as long as the
 * newest confirmation link is valid. Once it has expired nothing the recipient could still
 * click needs the address.
 */
export const UNCONFIRMED_RECIPIENT_TTL_MS = RECIPIENT_CONFIRM_TTL_MS;

export interface RecipientPurgeSummary {
  removed: number;
  /** Unconfirmed, but the last confirmation mail or change is younger than the TTL. */
  waiting: number;
  /** True when nothing was judged (schedule.json or users.json unreadable). */
  skipped: boolean;
}

/**
 * Since when the current recipient has been waiting: the newest of the last confirmation
 * mail and the last recipient change. Null for a schedule with neither, which only a
 * schedule saved before #449 can be (every change since records its time); such an address
 * has been unconfirmed for far longer than the TTL.
 */
function pendingSince(cfg: ScheduleConfig): number | null {
  // Stryker disable ArrayDeclaration,ConditionalExpression: equivalent mutants - a stand-in entry that is not a number is filtered out like a missing list, and Number.isFinite() does not coerce, so the typeof check in the filter changes nothing
  const stamps = [cfg.confirmSentAt, ...(cfg.confirmMailsAt ?? []), ...(cfg.recipientChangesAt ?? [])]
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  // Stryker restore ArrayDeclaration,ConditionalExpression
  // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent mutants - with no timestamps Math.max() is -Infinity, which reads as long ago exactly like null
  return stamps.length > 0 ? Math.max(...stamps) : null;
}

/**
 * Removes report recipients that never confirmed (double opt-in, #449) once
 * UNCONFIRMED_RECIPIENT_TTL_MS has passed since the last confirmation mail or recipient
 * change. The address of a third party who never agreed is not kept beyond the life of
 * its link (Art. 5(1)(c), (e) GDPR).
 *
 * Left alone:
 * - a confirmed recipient (by link, or as the account's own verified address);
 * - nothing else: the account's own address counts only once it is verified (#483), since an
 *   unverified account address may just as well be a third party's that nobody confirmed;
 * - an address that opted out via the unsubscribe link (#457): it is on the suppression
 *   list regardless, and the owner's "unsubscribed" notice needs it.
 *
 * A removed recipient leaves the schedule paused with no address, the confirmation fields
 * cleared and `confirmSeq` bumped (no older link can match), and `recipientExpiredAt` set
 * so Settings can say why. The rate-limit timestamps stay, so the purge cannot be used to
 * reset them.
 *
 * Fail-closed: nothing is changed when schedule.json or users.json cannot be parsed. The
 * run is synchronous like the schedule routes, so no request writes in between.
 * Idempotent; logs carry counts only.
 */
export function purgeUnconfirmedRecipients(now: number = Date.now(), logger: Logger = console): RecipientPurgeSummary {
  const summary: RecipientPurgeSummary = { removed: 0, waiting: 0, skipped: false };
  const store = readScheduleStoreStrict();
  if (store === null) {
    summary.skipped = true;
    logger.warn('[retention] schedule.json could not be parsed; unconfirmed report recipients were not judged this run.');
    return summary;
  }
  if (store.size === 0) return summary;
  const users = readUsersStrict();
  if (users === null) {
    summary.skipped = true;
    logger.warn('[retention] users.json could not be parsed; unconfirmed report recipients were not judged this run.');
    return summary;
  }
  let changed = false;
  for (const [key, cfg] of store) {
    const to = normalizeEmail(typeof cfg.toEmail === 'string' ? cfg.toEmail : '');
    if (!to) continue;
    const user = users.find((u) => typeof u?.username === 'string' && sameUsername(u.username, key));
    if (recipientStatus(cfg, user).status !== 'pending') continue;
    // A verified own address is confirmed already (recipientStatus); an unverified one is judged
    // like any other pending recipient (#483).
    // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent mutants - recipientStatus() above already answers confirmed for a verified own address, so this line is never reached for one
    if (user?.email && user.email_verified && normalizeEmail(user.email) === to) continue;
    if (isAddressBlocked(cfg, user, cfg.toEmail)) continue;
    const since = pendingSince(cfg);
    // Stryker disable next-line ConditionalExpression: equivalent mutant - for a null `since` the subtraction gives the current time, which is never inside the TTL
    if (since !== null && now - since < UNCONFIRMED_RECIPIENT_TTL_MS) { summary.waiting++; continue; }
    store.set(key, {
      ...cfg,
      enabled: false,
      toEmail: '',
      confirmedEmail: undefined,
      confirmedAt: undefined,
      confirmSentAt: undefined,
      confirmSeq: (cfg.confirmSeq ?? 0) + 1,
      recipientExpiredAt: now,
    });
    summary.removed++;
    changed = true;
  }
  if (changed) writeScheduleStoreStrict(store);
  return summary;
}

export interface RetentionSummary extends PurgeSummary {
  legacyCollectionsRemoved: number;
  tombstoneCollectionsRewritten: number;
  orphanPhotosRemoved: number;
  unconfirmedRecipientsRemoved: number;
}

/**
 * The periodic job: pending admin deletions, old leftovers, expired markers, orphaned photos,
 * unconfirmed report recipients. Each part
 * is isolated so one failing does not stop the others. `now` is injectable for tests.
 */
export function runRetentionJobs(now: number = Date.now(), logger: Logger = console): RetentionSummary {
  const out: RetentionSummary = {
    entriesPurged: 0, entriesFailed: 0, collectionsRemoved: 0, photosRemoved: 0, photosKept: 0,
    legacyCollectionsRemoved: 0, tombstoneCollectionsRewritten: 0, orphanPhotosRemoved: 0, unconfirmedRecipientsRemoved: 0,
  };
  const guard = (what: string, fn: () => void): void => {
    try { fn(); } catch (e) { logger.warn(`[retention] ${what} failed (${errCode(e)}).`); }
  };
  guard('pending deletions', () => Object.assign(out, purgePendingDeletions(now, logger)));
  guard('legacy leftovers', () => { out.legacyCollectionsRemoved = purgeLegacyDeletedCollections(now, logger); });
  guard('deletion markers', () => { out.tombstoneCollectionsRewritten = purgeStoredTombstones(now, logger); });
  guard('orphaned photos', () => { out.orphanPhotosRemoved = sweepOrphanPhotos(now, logger).removed; });
  guard('unconfirmed recipients', () => { out.unconfirmedRecipientsRemoved = purgeUnconfirmedRecipients(now, logger).removed; });
  const did = out.unconfirmedRecipientsRemoved + out.orphanPhotosRemoved + out.entriesPurged + out.collectionsRemoved + out.photosRemoved + out.legacyCollectionsRemoved + out.tombstoneCollectionsRewritten;
  if (did > 0) {
    logger.log(
      `[retention] purged ${out.entriesPurged} admin deletion(s) (${out.collectionsRemoved} collection file(s), ` +
      `${out.photosRemoved} photo(s) removed, ${out.photosKept} kept), ${out.legacyCollectionsRemoved} legacy leftover(s), ` +
      `${out.tombstoneCollectionsRewritten} collection(s) cleaned of old deletion markers, ${out.orphanPhotosRemoved} orphaned photo(s) removed, ` +
      `${out.unconfirmedRecipientsRemoved} unconfirmed report recipient(s) removed.`,
    );
  }
  return out;
}