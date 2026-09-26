package de.nagellacke.data.repo

import de.nagellacke.data.local.CategoryDao
import de.nagellacke.data.local.ManicureDao
import de.nagellacke.data.local.PolishDao
import de.nagellacke.data.local.StickerDao
import androidx.room.withTransaction
import de.nagellacke.data.local.NagellackeDatabase
import de.nagellacke.data.local.toDomain
import de.nagellacke.data.local.toEntity
import de.nagellacke.domain.generateId
import de.nagellacke.domain.photosOf
import de.nagellacke.domain.model.AppData
import de.nagellacke.domain.model.Category
import de.nagellacke.domain.model.Manicure
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.Sticker
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class NagellackeRepository @Inject constructor(
    private val db: NagellackeDatabase,
    private val polishDao: PolishDao,
    private val stickerDao: StickerDao,
    private val manicureDao: ManicureDao,
    private val categoryDao: CategoryDao,
    private val pendingPhotoDeletes: PendingPhotoDeleteStore,
) {
    fun observeData(): Flow<AppData> = combine(
        polishDao.observeAll(),
        stickerDao.observeAll(),
        manicureDao.observeAll(),
        categoryDao.observeAll(),
    ) { p, s, m, c ->
        AppData(
            polishes   = p.map { it.toDomain() },
            stickers   = s.map { it.toDomain() },
            manicures  = m.map { it.toDomain() },
            customCats = c.map { it.toDomain() },
        )
    }

    suspend fun getCurrentData(): AppData = AppData(
        polishes   = polishDao.getAll().map { it.toDomain() },
        stickers   = stickerDao.getAll().map { it.toDomain() },
        manicures  = manicureDao.getAll().map { it.toDomain() },
        customCats = categoryDao.getAll().map { it.toDomain() },
    )

    suspend fun replaceAll(data: AppData) = db.withTransaction {
        polishDao.deleteAll()
        stickerDao.deleteAll()
        manicureDao.deleteAll()
        categoryDao.deleteAll()
        polishDao.upsertAll(data.polishes.map { it.toEntity() })
        stickerDao.upsertAll(data.stickers.map { it.toEntity() })
        manicureDao.upsertAll(data.manicures.map { it.toEntity() })
        categoryDao.upsertAll(data.customCats.map { it.toEntity() })
    }

    // Polish CRUD
    suspend fun addPolish(p: Polish) {
        val now = System.currentTimeMillis()
        polishDao.upsert(p.copy(createdAt = now, updatedAt = now).toEntity())
    }
    suspend fun updatePolish(p: Polish) {
        val previous = polishDao.getAll().firstOrNull { it.id == p.id }?.toDomain()
        polishDao.upsert(p.copy(updatedAt = System.currentTimeMillis()).toEntity())
        // A replaced or removed photo is deleted on the sync target after the next sync (#348).
        previous?.let { pendingPhotoDeletes.add(photosOf(it) - photosOf(p)) }
    }
    suspend fun deletePolish(id: String) {
        val existing = polishDao.getAll().firstOrNull { it.id == id } ?: return
        polishDao.upsert(existing.copy(deletedAt = System.currentTimeMillis(), updatedAt = System.currentTimeMillis()))
        pendingPhotoDeletes.add(photosOf(existing.toDomain()))
    }

    // Sticker CRUD
    suspend fun addSticker(s: Sticker) {
        val now = System.currentTimeMillis()
        stickerDao.upsert(s.copy(id = generateId(), createdAt = now, updatedAt = now).toEntity())
    }
    suspend fun updateSticker(s: Sticker) {
        val previous = stickerDao.getAll().firstOrNull { it.id == s.id }?.toDomain()
        stickerDao.upsert(s.copy(updatedAt = System.currentTimeMillis()).toEntity())
        previous?.let { pendingPhotoDeletes.add(photosOf(it) - photosOf(s)) }
    }
    suspend fun deleteSticker(id: String) {
        val existing = stickerDao.getAll().firstOrNull { it.id == id } ?: return
        stickerDao.upsert(existing.copy(deletedAt = System.currentTimeMillis(), updatedAt = System.currentTimeMillis()))
        pendingPhotoDeletes.add(photosOf(existing.toDomain()))
    }

    // Manicure CRUD
    suspend fun addManicure(m: Manicure) {
        val now = System.currentTimeMillis()
        manicureDao.upsert(m.copy(id = generateId(), createdAt = now, updatedAt = now).toEntity())
    }
    suspend fun updateManicure(m: Manicure) {
        val previous = manicureDao.getAll().firstOrNull { it.id == m.id }?.toDomain()
        manicureDao.upsert(m.copy(updatedAt = System.currentTimeMillis()).toEntity())
        previous?.let { pendingPhotoDeletes.add(photosOf(it) - photosOf(m)) }
    }
    suspend fun deleteManicure(id: String) {
        val existing = manicureDao.getAll().firstOrNull { it.id == id } ?: return
        manicureDao.upsert(existing.copy(deletedAt = System.currentTimeMillis(), updatedAt = System.currentTimeMillis()))
        pendingPhotoDeletes.add(photosOf(existing.toDomain()))
    }

    // Category CRUD
    suspend fun addCategory(label: String) {
        val now = System.currentTimeMillis()
        categoryDao.upsert(Category(id = generateId(), label = label, updatedAt = now).toEntity())
    }
    suspend fun deleteCategory(id: String) {
        val existing = categoryDao.getAll().firstOrNull { it.id == id } ?: return
        categoryDao.upsert(existing.copy(deletedAt = System.currentTimeMillis(), updatedAt = System.currentTimeMillis()))
    }
}
