package de.nagellacke.domain

import de.nagellacke.domain.model.AppData
import de.nagellacke.domain.model.FinishType
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The Kotlin half of the shared merge contract. The TypeScript half is
 * v3/packages/core/src/mergeFixtures.test.ts and reads the very same files.
 *
 * mergeData() exists twice — once here, once in @nagellacke/core — and both decide which
 * side of a sync wins. Each had only its own tests, so the two could drift apart with every
 * test on both sides still green while a real sync dropped or resurrected a record. These
 * fixtures are the contract neither side owns; see fixtures/merge/README.md.
 */
class MergeFixturesTest {

    // Parsed the way real sync payloads are: unknown keys tolerated, and the fixtures'
    // pre-migration shapes (a bare-string `finish`) handled by FlexibleFinishSerializer.
    // That is deliberate — Kotlin normalizes finish while deserializing where TypeScript
    // does it inside mergeData, and the fixtures assert the two end up in the same place.
    private val json = Json { ignoreUnknownKeys = true }

    private val fixtureDir: File by lazy {
        val configured = System.getProperty("nagellacke.fixtures.dir")
            ?: error(
                "nagellacke.fixtures.dir is not set. Gradle sets it in app/build.gradle.kts; " +
                    "an IDE run needs it added to the run configuration."
            )
        File(configured, "merge")
    }

    private fun longOrNull(value: Long?): JsonElement =
        if (value == null) JsonNull else JsonPrimitive(value)

    // FinishType carries @SerialName for the two-word values ("Top Coat", "Gel Look"), so it
    // is encoded rather than read off .name — otherwise those two would silently compare as
    // "TopCoat" and never match the fixture.
    private fun finishName(f: FinishType): String =
        json.encodeToJsonElement(FinishType.serializer(), f).let { (it as JsonPrimitive).content }

    /**
     * Reduces a merged AppData to the fields the merge actually decides. The two platforms
     * fill absent optionals differently, so comparing whole records would fail on defaults
     * rather than on merge behaviour. `deletedAt` is always emitted, null when live, so a
     * missing key and an explicit null cannot be confused.
     */
    private fun project(merged: AppData): JsonObject = buildJsonObject {
        put("polishes", buildJsonArray {
            merged.polishes.forEach { p ->
                add(buildJsonObject {
                    put("id", JsonPrimitive(p.id))
                    put("name", JsonPrimitive(p.name))
                    put("updatedAt", JsonPrimitive(p.updatedAt))
                    put("deletedAt", longOrNull(p.deletedAt))
                    put("finish", buildJsonArray { p.finish.forEach { add(JsonPrimitive(finishName(it))) } })
                })
            }
        })
        put("customCats", buildJsonArray {
            merged.customCats.forEach { c ->
                add(buildJsonObject {
                    put("id", JsonPrimitive(c.id))
                    put("label", JsonPrimitive(c.label))
                    put("updatedAt", JsonPrimitive(c.updatedAt))
                    put("deletedAt", longOrNull(c.deletedAt))
                })
            }
        })
        put("manicures", buildJsonArray {
            merged.manicures.forEach { m ->
                add(buildJsonObject {
                    put("id", JsonPrimitive(m.id))
                    put("date", JsonPrimitive(m.date))
                    put("updatedAt", JsonPrimitive(m.updatedAt))
                    put("deletedAt", longOrNull(m.deletedAt))
                })
            }
        })
        put("stickers", buildJsonArray {
            merged.stickers.forEach { s ->
                add(buildJsonObject {
                    put("id", JsonPrimitive(s.id))
                    put("name", JsonPrimitive(s.name))
                    put("updatedAt", JsonPrimitive(s.updatedAt))
                    put("deletedAt", longOrNull(s.deletedAt))
                })
            }
        })
    }

    private fun fixtureFiles(): List<File> =
        fixtureDir.listFiles { f: File -> f.isFile && f.name.endsWith(".json") }
            ?.sortedBy { it.name }
            ?: emptyList()

    // Without this, a moved or empty fixture directory would turn the whole class into a
    // silently passing no-op — the exact failure mode these fixtures exist to prevent.
    @Test
    fun `the shared fixture directory is found and not empty`() {
        assertTrue("no fixtures found in $fixtureDir", fixtureFiles().isNotEmpty())
    }

    @Test
    fun `every shared fixture merges the same way as the TypeScript implementation`() {
        val failures = mutableListOf<String>()

        for (file in fixtureFiles()) {
            val fixture = json.parseToJsonElement(file.readText()).jsonObject
            val name = (fixture["name"] as? JsonPrimitive)?.content ?: file.name

            val local = json.decodeFromJsonElement(AppData.serializer(), fixture.getValue("local"))
            val remote = json.decodeFromJsonElement(AppData.serializer(), fixture.getValue("remote"))

            val actual = project(mergeData(local, remote))
            val expected = fixture.getValue("expected") as JsonObject

            // Collected rather than asserted one by one: if the implementations have drifted,
            // seeing every affected case at once says far more than the first alphabetically.
            if (actual != expected) {
                failures += "$name\n  expected: $expected\n  actual:   $actual"
            }
        }

        assertTrue("shared merge fixtures disagree:\n" + failures.joinToString("\n"), failures.isEmpty())
    }
}
