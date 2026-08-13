package de.nagellacke.data.local

import android.content.Context
import android.util.Log
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import de.nagellacke.domain.model.finishListFromJsonElement
import kotlinx.serialization.json.JsonPrimitive
import java.io.File

@Database(
    entities = [PolishEntity::class, StickerEntity::class, ManicureEntity::class, CategoryEntity::class],
    version = 3,
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

        // Converts `polishes.finish` from a single label string (e.g. "Gel Look") to a
        // JSON-array-of-labels column (e.g. ["Top Coat","Glitter"]), matching the server/web
        // multi-finish shape from #192. Rebuilds the table wholesale — rather than
        // ALTER TABLE ... DROP/RENAME COLUMN — because DROP COLUMN needs SQLite 3.35+, which
        // isn't guaranteed on every OS version down to minSdk 26. The backfill itself (turning
        // each row's copied legacy string into the new JSON array) can't be expressed in plain
        // SQL, so it's done row-by-row via FinishListConverter/finishListFromJsonElement, the
        // same code paths normal reads/writes use.
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE polishes_new (
                        id TEXT NOT NULL PRIMARY KEY,
                        name TEXT NOT NULL,
                        brand TEXT NOT NULL,
                        num TEXT NOT NULL,
                        color TEXT NOT NULL,
                        finish TEXT NOT NULL,
                        status TEXT NOT NULL,
                        count INTEGER NOT NULL,
                        categories TEXT NOT NULL,
                        notes TEXT NOT NULL,
                        rating INTEGER NOT NULL,
                        photo TEXT,
                        createdAt INTEGER NOT NULL,
                        updatedAt INTEGER NOT NULL,
                        deletedAt INTEGER
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    """
                    INSERT INTO polishes_new (id, name, brand, num, color, finish, status, count, categories, notes, rating, photo, createdAt, updatedAt, deletedAt)
                    SELECT id, name, brand, num, color, finish, status, count, categories, notes, rating, photo, createdAt, updatedAt, deletedAt FROM polishes
                    """.trimIndent(),
                )
                db.execSQL("DROP TABLE polishes")
                db.execSQL("ALTER TABLE polishes_new RENAME TO polishes")

                val converter = FinishListConverter()
                // Read every (id, finish) pair into memory and close the cursor before running
                // any UPDATEs. Interleaving reads and writes on the same table is unsafe here:
                // CursorWindow refills by re-running the query, so an UPDATE issued mid-iteration
                // can cause an already-converted row (now `["Glitter"]`) to be read a second time.
                // `JsonPrimitive` on an already-array-shaped string then fails enum recognition and
                // silently falls back to `['Classic']` — silent data loss in a one-shot, irreversible
                // migration. Only triggers past the default cursor-window size, but the fix is cheap.
                val rows = mutableListOf<Pair<String, String>>()
                db.query("SELECT id, finish FROM polishes").use { cursor ->
                    val idIndex = cursor.getColumnIndexOrThrow("id")
                    val finishIndex = cursor.getColumnIndexOrThrow("finish")
                    while (cursor.moveToNext()) {
                        rows.add(cursor.getString(idIndex) to cursor.getString(finishIndex))
                    }
                }
                for ((id, legacyLabel) in rows) {
                    val finishJson = converter.fromFinishList(finishListFromJsonElement(JsonPrimitive(legacyLabel)))
                    db.execSQL("UPDATE polishes SET finish = ? WHERE id = ?", arrayOf(finishJson, id))
                }
            }
        }

        private const val TAG = "NagellackeDatabase"
        private const val DB_NAME = "nagellacke.db"
        private const val PRE_MULTI_FINISH_BACKUP_SUFFIX = ".pre-multifinish.bak"

        // Safety net mirroring the web app's pre-migration localStorage backup (#192): copies
        // the on-disk DB file next to itself before Room gets a chance to open it (and run
        // MIGRATION_2_3), so a user can recover their pre-multi-finish data even if the
        // migration turns out to have a bug. No-op if there's nothing to back up yet (fresh
        // install) or a backup already exists (only the very first upgrade needs one).
        //
        // Also copies the WAL/SHM sidecar files (`-wal`/`-shm`), not just the main `.db` file:
        // with WRITE_AHEAD_LOGGING, recent writes can live only in the WAL until it's
        // checkpointed back into the main file. If a crash happens right before the update, the
        // main file alone is an incomplete/stale snapshot, and the rollback would silently lose
        // data in exactly the scenario it exists to protect against.
        // Each file is copied to a `.tmp` scratch name first and only then moved into its final
        // name, so a crash mid-copy can never leave a half-written file under a name that looks
        // like a finished backup. The sidecars are moved into place *before* the main `.db` file,
        // because the "already backed up, skip" check above only tests the main file: making it
        // the last one to appear means its presence always implies a complete set. A single
        // atomic guarantee across all three files isn't achievable on a plain filesystem; this
        // ordering plus the existence check gives the property that actually matters here.
        private fun backupDatabaseFileBeforeMultiFinishMigration(context: Context) {
            val dbFile = context.getDatabasePath(DB_NAME)
            if (!dbFile.exists()) return
            val backupFile = File(dbFile.path + PRE_MULTI_FINISH_BACKUP_SUFFIX)
            if (backupFile.exists()) return
            val temporaries = mutableListOf<File>()
            runCatching {
                val mainTemp = File(backupFile.path + ".tmp")
                temporaries += mainTemp
                dbFile.copyTo(mainTemp, overwrite = true)

                for (suffix in arrayOf("-wal", "-shm")) {
                    val sidecar = File(dbFile.path + suffix)
                    if (!sidecar.exists()) continue
                    val sidecarTemp = File(backupFile.path + suffix + ".tmp")
                    temporaries += sidecarTemp
                    sidecar.copyTo(sidecarTemp, overwrite = true)
                    if (!sidecarTemp.renameTo(File(backupFile.path + suffix))) {
                        error("Could not move backup sidecar $suffix into place")
                    }
                    temporaries -= sidecarTemp
                }

                if (!mainTemp.renameTo(backupFile)) {
                    error("Could not move database backup into place")
                }
                temporaries -= mainTemp
            }.onFailure { throwable ->
                // The migration still runs after this - the backup is a safety net, not a
                // precondition - but a silent failure would leave nothing to roll back to, so
                // make it visible instead of swallowing it.
                Log.w(TAG, "Failed to back up database before multi-finish migration", throwable)
                for (temp in temporaries) temp.delete()
            }
        }

        fun create(context: Context): NagellackeDatabase {
            backupDatabaseFileBeforeMultiFinishMigration(context)
            return Room.databaseBuilder(context, NagellackeDatabase::class.java, DB_NAME)
                .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING)
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                .build()
        }
    }
}
