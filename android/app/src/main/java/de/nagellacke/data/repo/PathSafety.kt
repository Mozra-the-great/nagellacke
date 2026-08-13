package de.nagellacke.data.repo

import java.io.File
import java.io.IOException

/**
 * Resolves [filename] against [root] and asserts the result stays inside it, rejecting
 * `..`, embedded separators, absolute paths and symlink tricks that would otherwise
 * escape the directory. Photo filenames reach this from unvalidated sync data
 * (`Polish`/`Sticker`/`Manicure.photo`), so they are attacker-influenced input — see #222.
 *
 * Rejects rather than sanitizes: stripping `..` out of a string is easy to get wrong
 * against encoding tricks, and it silently maps two different inputs onto the same name,
 * which turns a traversal attempt into a collision. Mirrors the guard the server already
 * applies on DELETE /api/photos/:filename.
 *
 * Lives outside PhotoRepository so it can be unit-tested without an Android Context —
 * the repository itself only reachable through `context.filesDir`.
 */
fun resolveWithin(root: File, filename: String): File {
    // Canonicalization itself can fail — an IOException on a name the OS considers
    // malformed, or a filesystem error. Fail closed and report it as a rejection like
    // any other, so callers only ever have to handle one exception type from this guard
    // rather than an IOException leaking out of delete()/readBytes()/resolveUri().
    val canonicalRoot: File
    val candidate: File
    try {
        canonicalRoot = root.canonicalFile
        candidate = File(root, filename).canonicalFile
    } catch (e: IOException) {
        throw SecurityException("Unresolvable photo filename: $filename", e)
    }
    if (candidate != canonicalRoot && !candidate.path.startsWith(canonicalRoot.path + File.separator)) {
        throw SecurityException("Invalid photo filename: $filename")
    }
    return candidate
}
