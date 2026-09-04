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
/**
 * Deletes every file directly in [root] that is neither listed in [referencedFilenames] nor
 * younger than [minAgeMs]. Backs PhotoRepository.cleanup(); see the docs there for why both
 * conditions are needed. Split out for the same reason as [resolveWithin]: PhotoRepository
 * reaches its directory through `context.filesDir`, which no unit test here can provide.
 */
fun deleteUnreferencedFiles(
    root: File,
    referencedFilenames: Set<String>,
    minAgeMs: Long,
    now: Long = System.currentTimeMillis(),
) {
    val cutoff = now - minAgeMs
    root.listFiles()?.forEach { file ->
        if (file.isFile && file.name !in referencedFilenames && file.lastModified() < cutoff) {
            file.delete()
        }
    }
}

fun resolveWithin(root: File, filename: String): File {
    // An absolute filename has to be rejected before it is joined, because joining hides
    // it: File(root, "/etc/passwd") does not produce "/etc/passwd", it produces
    // "<root>/etc/passwd", which passes the prefix check below and looks contained.
    // Containment is not the guarantee this function documents, and the re-rooting is the
    // silent collision the KDoc rules out - "/x.jpg" and "x.jpg" would name one file.
    // On Windows the join instead throws IOException and the catch below turned that into
    // a SecurityException by accident, which is why the test covering this only ever
    // passed there; Android is Linux, so the case was live in production.
    if (File(filename).isAbsolute) {
        throw SecurityException("Invalid photo filename: $filename")
    }
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
