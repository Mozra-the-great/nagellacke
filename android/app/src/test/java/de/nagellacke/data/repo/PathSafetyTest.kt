package de.nagellacke.data.repo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    // This is the one case the prefix check cannot catch on its own, which is why
    // resolveWithin rejects absolute names up front: File(dir, "/tmp/x/outside.jpg")
    // silently re-roots to "<dir>/tmp/x/outside.jpg" and looks contained. Windows took a
    // different route to the same SecurityException - the join throws IOException there -
    // so this test passed on a Windows dev machine while the case was live on Android.
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

    // --- deleteUnreferencedFiles (#226) ---
    //
    // Deleting a photo that is still referenced would be worse than the leak this fixes,
    // so both conditions - unreferenced AND old enough - are load-bearing.

    private val day = 24L * 60 * 60 * 1000

    private fun photo(dir: File, name: String, ageMs: Long): File =
        File(dir, name).apply {
            writeText("x")
            setLastModified(System.currentTimeMillis() - ageMs)
        }

    @Test
    fun `an old unreferenced photo is deleted`() {
        val dir = photosDir()
        val orphan = photo(dir, "orphan.jpg", 2 * day)
        deleteUnreferencedFiles(dir, emptySet(), day)
        assertFalse(orphan.exists())
    }

    @Test
    fun `an old photo that is still referenced is kept`() {
        val dir = photosDir()
        val kept = photo(dir, "kept.jpg", 2 * day)
        deleteUnreferencedFiles(dir, setOf("kept.jpg"), day)
        assertTrue(kept.exists())
    }

    // The race this guards: a photo imported into a form the user has not saved yet is on
    // disk but referenced by nothing, and a sync must not delete it out from under them.
    @Test
    fun `a freshly imported photo is kept even though nothing references it yet`() {
        val dir = photosDir()
        val fresh = photo(dir, "just-imported.jpg", 60 * 1000)
        deleteUnreferencedFiles(dir, emptySet(), day)
        assertTrue(fresh.exists())
    }

    @Test
    fun `a photo exactly at the age cutoff is kept`() {
        val dir = photosDir()
        val f = File(dir, "edge.jpg").apply { writeText("x") }
        val now = System.currentTimeMillis()
        f.setLastModified(now - day)
        deleteUnreferencedFiles(dir, emptySet(), day, now)
        assertTrue(f.exists())
    }

    @Test
    fun `deleting one orphan leaves the other files untouched`() {
        val dir = photosDir()
        val orphan = photo(dir, "orphan.jpg", 2 * day)
        val referenced = photo(dir, "referenced.jpg", 2 * day)
        val fresh = photo(dir, "fresh.jpg", 60 * 1000)
        deleteUnreferencedFiles(dir, setOf("referenced.jpg"), day)
        assertFalse(orphan.exists())
        assertTrue(referenced.exists())
        assertTrue(fresh.exists())
    }

    @Test
    fun `a subdirectory is never deleted`() {
        val dir = photosDir()
        val sub = File(dir, "sub").apply { mkdirs(); setLastModified(System.currentTimeMillis() - 2 * day) }
        deleteUnreferencedFiles(dir, emptySet(), day)
        assertTrue(sub.exists())
    }

    @Test
    fun `a missing directory is handled without throwing`() {
        val missing = File(tmp.root, "not-created-yet")
        deleteUnreferencedFiles(missing, emptySet(), day)
        assertFalse(missing.exists())
    }
}
