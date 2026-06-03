package de.nagellacke.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

@Database(
    entities = [PolishEntity::class, StickerEntity::class, ManicureEntity::class, CategoryEntity::class],
    version = 1,
    exportSchema = true,
)
@TypeConverters(ListConverter::class)
abstract class NagellackeDatabase : RoomDatabase() {
    abstract fun polishDao(): PolishDao
    abstract fun stickerDao(): StickerDao
    abstract fun manicureDao(): ManicureDao
    abstract fun categoryDao(): CategoryDao

    companion object {
        fun create(context: Context): NagellackeDatabase =
            Room.databaseBuilder(context, NagellackeDatabase::class.java, "nagellacke.db")
                .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING)
                .build()
    }
}
