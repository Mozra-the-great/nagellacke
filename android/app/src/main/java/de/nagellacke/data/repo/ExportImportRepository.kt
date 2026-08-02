package de.nagellacke.data.repo

import de.nagellacke.data.sync.createAdapter
import de.nagellacke.domain.collectPhotoFilenames
import de.nagellacke.domain.mergeData
import de.nagellacke.domain.model.AppData
import de.nagellacke.domain.remapPhotoRefs
import de.nagellacke.ui.collection.PhotoResolution
import de.nagellacke.ui.collection.photoResolution
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.InputStream
import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import javax.inject.Inject
import javax.inject.Singleton

data class ExportSummary(val polishes: Int, val stickers: Int, val manicures: Int, val photosExported: Int, val photosSkipped: Int)
data class ImportSummary(val polishes: Int, val stickers: Int, val manicures: Int, val photosImported: Int, val photosFailed: Int)

/**
 * ZIP export/import matching SettingsPage.tsx's exportData()/importData(): a `data.json` at the
 * archive root holding the whole [AppData] (same field names, since the Android model matches
 * `@nagellacke/core` since #141), plus a `photos/` folder with every referenced photo. Import
 * merges with the current local collection via the same [mergeData] used by sync, so it behaves
 * like pulling from a very thorough peer rather than a destructive overwrite.
 */
@Singleton
class ExportImportRepository @Inject constructor(
    private val repo: NagellackeRepository,
    private val configStore: SyncConfigStore,
    private val photoRepository: PhotoRepository,
) {
    private val json = Json { prettyPrint = true; ignoreUnknownKeys = true }
    private val httpClient by lazy { OkHttpClient() }

    suspend fun exportZip(out: OutputStream): ExportSummary {
        val data = repo.getCurrentData()
        val resolution = configStore.getConfig().photoResolution()
        var exported = 0
        var skipped = 0

        ZipOutputStream(out).use { zip ->
            zip.putNextEntry(ZipEntry("data.json"))
            zip.write(json.encodeToString(data).toByteArray(Charsets.UTF_8))
            zip.closeEntry()

            for (filename in collectPhotoFilenames(data)) {
                val bytes = readPhotoBytes(filename, resolution)
                if (bytes == null) {
                    skipped++
                    continue
                }
                zip.putNextEntry(ZipEntry("photos/$filename"))
                zip.write(bytes)
                zip.closeEntry()
                exported++
            }
        }
        return ExportSummary(data.polishes.size, data.stickers.size, data.manicures.size, exported, skipped)
    }

    /** Prefers a local copy (photos captured on this device) and falls back to the current sync
     *  provider's URL — the same source [de.nagellacke.ui.collection.rememberPhotoModel] would
     *  resolve to for display, so export can bundle anything the app can currently show. */
    private fun readPhotoBytes(filename: String, resolution: PhotoResolution): ByteArray? {
        runCatching { photoRepository.readBytes(filename) }.getOrNull()?.let { return it }
        val resolvable = resolution as? PhotoResolution.Resolvable ?: return null
        return runCatching {
            val request = Request.Builder().url(resolvable.urlFor(filename)).apply {
                resolvable.authHeader?.let { header("Authorization", it) }
            }.build()
            httpClient.newCall(request).execute()
        }.getOrNull()?.use { response -> if (response.isSuccessful) response.body?.bytes() else null }
    }

    suspend fun importZip(input: InputStream): Result<ImportSummary> = runCatching {
        var parsed: AppData? = null
        val photoBytesByName = LinkedHashMap<String, ByteArray>()

        ZipInputStream(input).use { zip ->
            var entry = zip.nextEntry
            while (entry != null) {
                when {
                    !entry.isDirectory && entry.name == "data.json" ->
                        parsed = json.decodeFromString(AppData.serializer(), zip.readBytes().toString(Charsets.UTF_8))
                    !entry.isDirectory && entry.name.startsWith("photos/") -> {
                        val filename = entry.name.removePrefix("photos/")
                        if (filename.isNotBlank()) photoBytesByName[filename] = zip.readBytes()
                    }
                }
                zip.closeEntry()
                entry = zip.nextEntry
            }
        }
        val importedData = parsed ?: error("Ungültige ZIP-Datei: data.json fehlt")

        // Photos can only be made visible through a configured sync provider — nothing in the
        // app resolves a bare local filename outside an open edit form (see PhotoResolution).
        // Without one, count every bundled photo as failed instead of importing references
        // nothing can ever display.
        val cfg = configStore.getConfig()
        val adapter = cfg?.let { createAdapter(it, configStore) }
        val filenameMap = mutableMapOf<String, String>()
        var photosFailed = 0
        for ((oldFilename, bytes) in photoBytesByName) {
            val newFilename = adapter?.let { a -> runCatching { a.uploadPhoto(bytes, mimeTypeFromFilename(oldFilename)).filename }.getOrNull() }
            if (newFilename != null) filenameMap[oldFilename] = newFilename else photosFailed++
        }

        val remapped = if (filenameMap.isNotEmpty()) remapPhotoRefs(importedData, filenameMap) else importedData
        val merged = mergeData(repo.getCurrentData(), remapped)
        repo.replaceAll(merged)

        ImportSummary(
            polishes = remapped.polishes.size,
            stickers = remapped.stickers.size,
            manicures = remapped.manicures.size,
            photosImported = filenameMap.size,
            photosFailed = photosFailed,
        )
    }

    private fun mimeTypeFromFilename(filename: String): String = when (filename.substringAfterLast('.', "").lowercase()) {
        "png" -> "image/png"
        "webp" -> "image/webp"
        else -> "image/jpeg"
    }
}
