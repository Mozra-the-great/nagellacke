package de.nagellacke.domain

import de.nagellacke.domain.model.AppData
import de.nagellacke.domain.model.ManicurePhotos

/** Every photo filename referenced anywhere in [data] — polishes, stickers, and all five
 *  manicure photo fields (the legacy singular `photo` plus the four named slots). Mirrors
 *  collectPhotoFilenames() in SettingsPage.tsx so an export bundles exactly what the web
 *  app's export would. */
fun collectPhotoFilenames(data: AppData): Set<String> {
    val names = LinkedHashSet<String>()
    data.polishes.forEach { it.photo?.let(names::add) }
    data.stickers.forEach { it.photo?.let(names::add) }
    data.manicures.forEach { m ->
        m.photo?.let(names::add)
        m.photos.fingerRight?.let(names::add)
        m.photos.fingerLeft?.let(names::add)
        m.photos.thumbRight?.let(names::add)
        m.photos.thumbLeft?.let(names::add)
    }
    return names
}

/** Rewrites every photo filename reference in [data] through [map], leaving names with no
 *  entry untouched. Mirrors remapPhotoRefs() in SettingsPage.tsx — used after import re-uploads
 *  each bundled photo and gets back a (possibly different) filename from the sync provider. */
fun remapPhotoRefs(data: AppData, map: Map<String, String>): AppData {
    fun remap(name: String?): String? = name?.let { map[it] ?: it }
    return data.copy(
        polishes = data.polishes.map { it.copy(photo = remap(it.photo)) },
        stickers = data.stickers.map { it.copy(photo = remap(it.photo)) },
        manicures = data.manicures.map { m ->
            m.copy(
                photo = remap(m.photo),
                photos = ManicurePhotos(
                    fingerRight = remap(m.photos.fingerRight),
                    fingerLeft = remap(m.photos.fingerLeft),
                    thumbRight = remap(m.photos.thumbRight),
                    thumbLeft = remap(m.photos.thumbLeft),
                ),
            )
        },
    )
}
