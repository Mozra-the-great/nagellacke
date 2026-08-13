package de.nagellacke.domain

import de.nagellacke.domain.model.AppData
import de.nagellacke.domain.model.FinishType
import de.nagellacke.domain.model.Manicure
import de.nagellacke.domain.model.ManicurePhotos
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.PolishRef
import de.nagellacke.domain.model.PolishStatus
import de.nagellacke.domain.model.Sticker
import de.nagellacke.domain.model.StickerType
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

/** Port coverage for #149 — mirrors what report.ts's generateReport() is expected to produce. */
class ReportGeneratorTest {
    private fun ts(date: LocalDate) = date.atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()

    private fun polish(id: String, name: String, createdAt: Long, rating: Int = 0, brand: String = "OPI", deletedAt: Long? = null) = Polish(
        id = id, name = name, brand = brand, num = "", color = "#ff6699",
        finish = listOf(FinishType.Classic), status = PolishStatus.Ok, rating = rating,
        createdAt = createdAt, updatedAt = createdAt, deletedAt = deletedAt,
    )

    @Test fun `week report includes only items created in that week`() {
        val monday = LocalDate.of(2026, 3, 2) // a Monday
        val inWeek = polish("p1", "In der Woche", ts(monday.plusDays(2)))
        val beforeWeek = polish("p2", "Vorher", ts(monday.minusDays(1)))
        val data = AppData(polishes = listOf(inWeek, beforeWeek))

        val html = generateReportHtml(data, ReportPeriod.Week, monday.plusDays(3)) { null }

        assertTrue(html.contains("In der Woche"))
        assertFalse(html.contains("Vorher"))
        assertTrue(html.contains("<strong>1</strong> neue Lacke"))
    }

    @Test fun `month report includes only items created that month`() {
        val inMonth = polish("p1", "Im Monat", ts(LocalDate.of(2026, 3, 15)))
        val otherMonth = polish("p2", "Anderer Monat", ts(LocalDate.of(2026, 2, 28)))
        val data = AppData(polishes = listOf(inMonth, otherMonth))

        val html = generateReportHtml(data, ReportPeriod.Month, LocalDate.of(2026, 3, 10)) { null }

        assertTrue(html.contains("Im Monat"))
        assertFalse(html.contains("Anderer Monat"))
        assertTrue(html.contains("März 2026"))
    }

    @Test fun `deleted items are excluded from totals and new-item lists`() {
        val active = polish("p1", "Aktiv", ts(LocalDate.of(2026, 3, 15)))
        val deleted = polish("p2", "Gelöscht", ts(LocalDate.of(2026, 3, 15)), deletedAt = 1L)
        val data = AppData(polishes = listOf(active, deleted))

        val html = generateReportHtml(data, ReportPeriod.Month, LocalDate.of(2026, 3, 10)) { null }

        assertTrue(html.contains("Aktiv"))
        assertFalse(html.contains("Gelöscht"))
        assertTrue(html.contains("<div class=\"stat-num\">1</div><div class=\"stat-label\">Lacke gesamt</div>"))
    }

    @Test fun `average rating is only shown when polishes are rated`() {
        val rated = polish("p1", "Bewertet", ts(LocalDate.of(2026, 1, 1)), rating = 4)
        val unrated = polish("p2", "Unbewertet", ts(LocalDate.of(2026, 1, 1)), rating = 0)
        val withRatings = generateReportHtml(AppData(polishes = listOf(rated)), ReportPeriod.Month, LocalDate.of(2026, 3, 1)) { null }
        val withoutRatings = generateReportHtml(AppData(polishes = listOf(unrated)), ReportPeriod.Month, LocalDate.of(2026, 3, 1)) { null }

        assertTrue(withRatings.contains("⌀ Bewertung"))
        assertFalse(withoutRatings.contains("⌀ Bewertung"))
    }

    @Test fun `empty period shows the empty-state message`() {
        val html = generateReportHtml(AppData(), ReportPeriod.Week, LocalDate.of(2026, 3, 5)) { null }
        assertTrue(html.contains("Keine neuen Lacke in diesem Zeitraum."))
        assertTrue(html.contains("Keine neuen Sticker in diesem Zeitraum."))
        assertTrue(html.contains("Keine Maniküren in diesem Zeitraum."))
    }

    @Test fun `manicure in period is rendered with polish refs and notes`() {
        val date = LocalDate.of(2026, 3, 12)
        val m = Manicure(
            id = "m1", date = date.toString(),
            polishRefs = listOf(PolishRef(name = "Rose Gold", brand = "OPI", color = "#ffc0cb")),
            notes = "Hält super", photos = ManicurePhotos(fingerRight = "fr.jpg"),
            createdAt = ts(date), updatedAt = ts(date),
        )
        val html = generateReportHtml(AppData(manicures = listOf(m)), ReportPeriod.Month, date) { filename -> "https://example.com/photos/$filename" }

        assertTrue(html.contains("Rose Gold"))
        assertTrue(html.contains("Hält super"))
        assertTrue(html.contains("https://example.com/photos/fr.jpg"))
    }

    @Test fun `photoUrl returning null omits the image instead of a broken src`() {
        val date = LocalDate.of(2026, 3, 12)
        val p = polish("p1", "Ohne URL", ts(date)).copy(photo = "x.jpg")
        val html = generateReportHtml(AppData(polishes = listOf(p)), ReportPeriod.Month, date) { null }
        assertFalse(html.contains("<img"))
    }

    @Test fun `sticker report includes type label and colors`() {
        val date = LocalDate.of(2026, 3, 12)
        val s = Sticker(
            id = "s1", name = "Herzchen", type = StickerType.Accent, colors = listOf("#ff0000"),
            status = PolishStatus.Ok, createdAt = ts(date), updatedAt = ts(date),
        )
        val html = generateReportHtml(AppData(stickers = listOf(s)), ReportPeriod.Month, date) { null }
        assertTrue(html.contains("Herzchen"))
        assertTrue(html.contains(StickerType.Accent.label))
    }
}
