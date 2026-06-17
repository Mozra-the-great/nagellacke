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

    fun resolveUri(filename: String): Uri = Uri.fromFile(File(dir, filename))

    fun delete(filename: String) { File(dir, filename).delete() }

    fun readBytes(filename: String): ByteArray = File(dir, filename).readBytes()

    private fun calculateSampleSize(context: Context, uri: Uri, maxW: Int, maxH: Int): Int {
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
        var size = 1
        while (opts.outWidth / size > maxW || opts.outHeight / size > maxH) size *= 2
        return size
    }
}
