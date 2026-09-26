package de.nagellacke.data.repo

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Photo filenames waiting to be deleted on the sync target, with how many attempts have failed
 * (#348). Persisted because the deletion only runs after the next successful sync, which may be
 * hours or an app restart away. Plain SharedPreferences: filenames are not secret.
 */
@Singleton
class PendingPhotoDeleteStore @Inject constructor(@ApplicationContext context: Context) {
    private val prefs = context.getSharedPreferences("pending_photo_deletes", Context.MODE_PRIVATE)

    @Synchronized
    fun add(filenames: Collection<String>) {
        val fresh = filenames.filter { !prefs.contains(it) }
        if (fresh.isEmpty()) return
        prefs.edit().apply { fresh.forEach { putInt(it, 0) } }.apply()
    }

    @Synchronized
    fun pending(): Set<String> = prefs.all.keys.toSet()

    @Synchronized
    fun remove(filename: String) {
        prefs.edit().remove(filename).apply()
    }

    /** Counts a failed attempt; returns true once [maxAttempts] is reached and the entry was dropped. */
    @Synchronized
    fun recordFailure(filename: String, maxAttempts: Int): Boolean {
        val attempts = prefs.getInt(filename, 0) + 1
        if (attempts >= maxAttempts) {
            prefs.edit().remove(filename).apply()
            return true
        }
        prefs.edit().putInt(filename, attempts).apply()
        return false
    }
}
