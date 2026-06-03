package de.nagellacke.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface PolishDao {
    @Query("SELECT * FROM polishes ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<PolishEntity>>

    @Query("SELECT * FROM polishes")
    suspend fun getAll(): List<PolishEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(polish: PolishEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(polishes: List<PolishEntity>)

    @Query("DELETE FROM polishes")
    suspend fun deleteAll()
}

@Dao
interface StickerDao {
    @Query("SELECT * FROM stickers ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<StickerEntity>>

    @Query("SELECT * FROM stickers")
    suspend fun getAll(): List<StickerEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(sticker: StickerEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(stickers: List<StickerEntity>)

    @Query("DELETE FROM stickers")
    suspend fun deleteAll()
}

@Dao
interface ManicureDao {
    @Query("SELECT * FROM manicures ORDER BY date DESC")
    fun observeAll(): Flow<List<ManicureEntity>>

    @Query("SELECT * FROM manicures")
    suspend fun getAll(): List<ManicureEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(manicure: ManicureEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(manicures: List<ManicureEntity>)

    @Query("DELETE FROM manicures")
    suspend fun deleteAll()
}

@Dao
interface CategoryDao {
    @Query("SELECT * FROM categories ORDER BY label ASC")
    fun observeAll(): Flow<List<CategoryEntity>>

    @Query("SELECT * FROM categories")
    suspend fun getAll(): List<CategoryEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(category: CategoryEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(categories: List<CategoryEntity>)

    @Query("DELETE FROM categories")
    suspend fun deleteAll()
}
