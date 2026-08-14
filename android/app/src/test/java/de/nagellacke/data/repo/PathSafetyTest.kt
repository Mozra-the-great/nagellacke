package de.nagellacke.data.repo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class PathSafetyTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun photosDir(): File = tmp.newFolder("photos")

    @Test
    fun `an ordinary filename resolves inside the photos dir`() {
        val dir = photosDir()
        val resolved = resolveWithin(dir, "photo_2f8c1e.jpg")
        assertEquals(dir.canonicalFile, resolved.parentFile)
        assertEquals("photo_2f8c1e.jpg", resolved.name)
    }

    @Test
    fun `a parent-directory traversal is rejected`() {
        val dir = photosDir()
        assertThrows(SecurityException::class.java) {
            resolveWithin(dir, "../databases/nagellacke.db")
        }
    }

    @Test
    fun `a deep traversal out of the app sandbox is rejected`() {
        val dir = photosDir()
        assertThrows(SecurityException::class.java) {
            resolveWithin(dir, "../../../../etc/passwd")
        }
    }

    // The escape does not have to start with "..": a nested path that climbs back out
    // mid-string canonicalizes to the same place.
    @Test
    fun `a traversal hidden after a valid-looking segment is rejected`() {
        val dir = photosDir()
        assertThrows(SecurityException::class.java) {
            resolveWithin(dir, "sub/../../outside.jpg")
        }
    }

    // On Windows, File(dir, "C:\\...") produces a path the OS rejects outright and
    // canonicalFile throws IOException before the prefix check ever runs. Either way the
    // caller must see a SecurityException: an IOException escaping resolveWithin would
    // surface from delete()/readBytes() as an unrelated failure type, and exists()'s
    // fail-closed runCatching is the only place that would absorb it.
    @Test
    fun `an absolute path outside the dir is rejected`() {
        val dir = photosDir()
        val outside = File(tmp.root, "outside.jpg").absolutePath
        assertThrows(SecurityException::class.java) {
            resolveWithin(dir, outside)
        }
    }

    @Test
    fun `a filename the OS cannot resolve is rejected, not leaked as IOException`() {
        val dir = photosDir()
        assertThrows(SecurityException::class.java) {
            resolveWithin(dir, "in\u0000valid.jpg")
        }
    }

    // A subdirectory is inside the root, so it is allowed. Nothing writes nested photo
    // paths today; this pins the boundary as "must stay within", not "must be flat".
    @Test
    fun `a nested path that stays inside the dir is allowed`() {
        val dir = photosDir()
        val resolved = resolveWithin(dir, "nested/photo.jpg")
        assertTrue(resolved.path.startsWith(dir.canonicalFile.path + File.separator))
    }

    // "." canonicalizes to the root itself, which the guard permits explicitly - it is
    // not an escape, and rejecting it would be a surprise for callers.
    @Test
    fun `the dir itself is not treated as an escape`() {
        val dir = photosDir()
        assertEquals(dir.canonicalFile, resolveWithin(dir, "."))
    }

    // The prefix check compares against root + separator, so a sibling directory whose
    // name merely starts with the root's name must not slip through.
    @Test
    fun `a sibling dir sharing the root's name prefix is rejected`() {
        val dir = photosDir()
        tmp.newFolder("photos_evil")
        assertThrows(SecurityException::class.java) {
            resolveWithin(dir, "../photos_evil/x.jpg")
        }
    }

    @Test
    fun `an empty filename resolves to the dir itself and is not an escape`() {
        val dir = photosDir()
        assertEquals(dir.canonicalFile, resolveWithin(dir, ""))
    }
}
