package de.nagellacke.data.repo

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PhotoRepository @Inject constructor(@ApplicationContext private val context: Context) {
    private val dir: File get() = File(context.filesDir, "photos").also { it.mkdirs() }

    suspend fun importPhoto(uri: Uri): String {
        val filename = "photo_${UUID.randomUUID()}.jpg"
        val target = File(dir, filename)
        context.contentResolver.openInputStream(uri)?.use { input ->
            val opts = BitmapFactory.Options().apply {
                inSampleSize = calculateSampleSize(context, uri, 1024, 1024)
            }
            val bitmap = BitmapFactory.decodeStream(input, null, opts) ?: return filename
            FileOutputStream(target).use { out ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, 80, out)
            }
        }
        return filename
    }

    fun resolveUri(filename: String): Uri = Uri.fromFile(resolveSafe(filename))

    // Called from a Compose `remember` block (see CommonUi.PhotoPickerField) on every
    // form open — must fail closed (false) rather than throw, or a malicious synced
    // filename would crash the UI instead of just falling back to the remote image.
    fun exists(filename: String): Boolean =
        runCatching { resolveSafe(filename).exists() }.getOrDefault(false)

    fun delete(filename: String) { resolveSafe(filename).delete() }

    /** Deletes any locally-cached photo not in [referencedFilenames] — run after a sync so photos
     *  for permanently-purged tombstones (see [de.nagellacke.domain.purgeOldDeleted]) get reclaimed
     *  instead of lingering on disk forever (#226). Soft-deleted-but-not-yet-purged items still
     *  reference their photo, so this never touches a file an undo could still need.
     *
     *  Skips anything younger than [minAgeMs]: a photo just imported into an open add/edit form is
     *  on disk but not yet referenced by any saved row, and a sync racing with that unsaved form
     *  must not delete it out from under the user.
     *
     *  Deletes the File handles listFiles() hands back rather than routing their names through
     *  delete(): those handles come from the directory itself, so there is no attacker-supplied
     *  name to guard here, and re-deriving one only to re-resolve it would be a detour. The
     *  traversal guard (#222) belongs on the entry points that take a filename from sync data. */
    fun cleanup(referencedFilenames: Set<String>, minAgeMs: Long = 24L * 60 * 60 * 1000) =
        deleteUnreferencedFiles(dir, referencedFilenames, minAgeMs)

    fun readBytes(filename: String): ByteArray = resolveSafe(filename).readBytes()

    private fun resolveSafe(filename: String): File = resolveWithin(dir, filename)

    private fun calculateSampleSize(context: Context, uri: Uri, maxW: Int, maxH: Int): Int {
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
        var size = 1
        while (opts.outWidth / size > maxW || opts.outHeight / size > maxH) size *= 2
        return size
    }
}
