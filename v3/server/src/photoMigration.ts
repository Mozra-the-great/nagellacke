import * as fs from 'node:fs';
import * as path from 'node:path';
import { stripImageMetadata } from './imageMeta';

/**
 * One-time startup migration for #451: photos stored before uploads were scrubbed
 * still carry their EXIF/XMP (GPS, device, timestamps) and are served back as they
 * are. This rewrites them through the same stripImageMetadata() as new uploads.
 *
 * It rewrites user files, so it is built to be boring and to be undoable only by
 * the operator's own backup:
 *  - metadata only: pixel data is never decoded or re-encoded (see imageMeta.ts), and
 *    the orientation tag is kept, so a photo looks exactly as before;
 *  - idempotent: a file whose scrubbed form equals its current bytes is not touched, so
 *    running it again, or after a crash halfway, changes nothing that is already done;
 *  - crash safe: each file is written to a temp name and renamed over the original, so
 *    a file is always either the old or the new complete version;
 *  - never fatal: a file that cannot be scrubbed (unreadable, not a well-formed image) is
 *    left exactly as it was and listed in the state file and the log; the server still starts;
 *  - runs once: when the state file exists the pass is skipped. Deleting
 *    `photo_metadata.json` makes the next start do it again (e.g. to retry failures).
 *
 * Files are processed one at a time, so memory is bounded by the largest photo.
 */

export interface PhotoMigrationState {
  v: 1;
  doneAt: string;
  /** Image files looked at. */
  scanned: number;
  /** Files that carried metadata and were rewritten. */
  rewritten: number;
  /** Files that were already clean. */
  unchanged: number;
  /** Names of files left as they were because they could not be processed. */
  failed: string[];
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

interface Logger {
  log(message: string): void;
  warn(message: string): void;
}

/** @returns the state it recorded, or null when the migration had already run. */
export function stripStoredPhotos(photosDir: string, stateFile: string, logger: Logger = console): PhotoMigrationState | null {
  if (fs.existsSync(stateFile)) return null;

  const state: PhotoMigrationState = { v: 1, doneAt: '', scanned: 0, rewritten: 0, unchanged: 0, failed: [] };
  for (const name of fs.readdirSync(photosDir).sort()) {
    if (!IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
    const file = path.join(photosDir, name);
    try {
      // lstat: a symlink in the photo directory is not ours to rewrite (it could point anywhere).
      if (!fs.lstatSync(file).isFile()) continue;
      state.scanned += 1;
      const current = fs.readFileSync(file);
      const clean = stripImageMetadata(current);
      if (clean.equals(current)) {
        state.unchanged += 1;
        continue;
      }
      const tmp = `${file}.migrating`;
      fs.writeFileSync(tmp, clean);
      fs.renameSync(tmp, file);
      state.rewritten += 1;
    } catch (e) {
      state.failed.push(name);
      logger.warn(`[migration] Photo ${name} left unchanged (#451): ${e instanceof Error ? e.message : String(e)}`);
      fs.rmSync(`${file}.migrating`, { force: true });
    }
  }

  state.doneAt = new Date().toISOString();
  const tmpState = `${stateFile}.tmp`;
  fs.writeFileSync(tmpState, JSON.stringify(state, null, 2));
  fs.renameSync(tmpState, stateFile);
  if (state.scanned > 0) {
    logger.log(
      `[migration] Removed metadata from ${state.rewritten} of ${state.scanned} stored photo(s), `
      + `${state.unchanged} already clean, ${state.failed.length} left unchanged (#451).`,
    );
  }
  return state;
}
