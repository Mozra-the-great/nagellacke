package de.nagellacke.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [PolishEntity::class, StickerEntity::class, ManicureEntity::class, CategoryEntity::class],
    version = 2,
    exportSchema = true,
)
@TypeConverters(ListConverter::class)
abstract class NagellackeDatabase : RoomDatabase() {
    abstract fun polishDao(): PolishDao
    abstract fun stickerDao(): StickerDao
    abstract fun manicureDao(): ManicureDao
    abstract fun categoryDao(): CategoryDao

    companion object {
        // Adds polishRefs/stickers/stickerRefs/photo to `manicures`, carrying the fields
        // the Manicure model was missing (see #141). `photos` keeps its TEXT column and
        // just starts holding the named-slot JSON shape instead of a flat array.
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE manicures ADD COLUMN polishRefs TEXT NOT NULL DEFAULT '[]'")
                db.execSQL("ALTER TABLE manicures ADD COLUMN stickers TEXT NOT NULL DEFAULT '[]'")
                db.execSQL("ALTER TABLE manicures ADD COLUMN stickerRefs TEXT NOT NULL DEFAULT '[]'")
                db.execSQL("ALTER TABLE manicures ADD COLUMN photo TEXT DEFAULT NULL")
            }
        }

        fun create(context: Context): NagellackeDatabase =
            Room.databaseBuilder(context, NagellackeDatabase::class.java, "nagellacke.db")
                .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING)
                .addMigrations(MIGRATION_1_2)
                .build()
    }
}
