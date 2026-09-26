package de.nagellacke.domain

import de.nagellacke.domain.model.AppData
import de.nagellacke.domain.model.Manicure
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.Sticker

// Remote photo cleanup (#348). Deleting or re-photographing a record used to leave its photo on
// the sync target forever: every adapter implements deletePhoto(), but nothing called it.
// The repository now queues the filenames a record stops using, and SyncManager deletes them
// once the change has been synced. These functions are the part that decides, kept free of
// Android types so the JVM unit tests can pin them.

fun photosOf(p: Polish): Set<String> = setOfNotNull(p.photo)

fun photosOf(s: Sticker): Set<String> = setOfNotNull(s.photo)

fun photosOf(m: Manicure): Set<String> = setOfNotNull(
    m.photo, m.photos.fingerRight, m.photos.fingerLeft, m.photos.thumbRight, m.photos.thumbLeft,
)

/** Photo filenames referenced by records that are not soft-deleted. */
fun collectLivePhotoFilenames(data: AppData): Set<String> = collectPhotoFilenames(
    data.copy(
        polishes = data.polishes.filter { it.deletedAt == null },
        stickers = data.stickers.filter { it.deletedAt == null },
        manicures = data.manicures.filter { it.deletedAt == null },
    ),
)

/**
 * Splits queued remote deletions into those that may be deleted now and those a live record
 * references again — after the sync that just merged [data], so a record another device edited
 * back to life, or a second record sharing the same photo, keeps its file.
 */
fun partitionPendingPhotoDeletes(pending: Set<String>, data: AppData): Pair<Set<String>, Set<String>> {
    val live = collectLivePhotoFilenames(data)
    val (deletable, inUse) = pending.partition { it !in live }
    return deletable.toSet() to inUse.toSet()
}
