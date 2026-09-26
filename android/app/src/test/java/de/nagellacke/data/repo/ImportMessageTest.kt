package de.nagellacke.data.repo

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #324 S22: a server with photo uploads switched off answers 403 to every upload. That used
 * to land in the generic "Sync konfiguriert?" count, which sends the user looking in the
 * wrong place.
 */
class ImportMessageTest {
    @Test
    fun `a clean import says so`() {
        assertEquals(
            "Import erfolgreich: 2 Lacke, 1 Sticker, 0 Maniküren, 3 Foto(s).",
            describeImport(ImportSummary(2, 1, 0, 3, 0)),
        )
    }

    @Test
    fun `photos refused by the server get their own explanation`() {
        assertEquals(
            "Import abgeschlossen: 2 Lacke, 0 Sticker, 0 Maniküren, 0 Foto(s). " +
                "4 Foto(s) nicht importiert: Der Server nimmt keine Foto-Uploads an.",
            describeImport(ImportSummary(2, 0, 0, 0, photosFailed = 4, photosRefused = 4)),
        )
    }

    @Test
    fun `other failures keep the old hint, alongside refusals`() {
        assertEquals(
            "Import abgeschlossen: 1 Lacke, 0 Sticker, 0 Maniküren, 1 Foto(s). " +
                "2 Foto(s) nicht importiert: Der Server nimmt keine Foto-Uploads an. " +
                "1 Foto(s) konnten nicht importiert werden (Sync konfiguriert?).",
            describeImport(ImportSummary(1, 0, 0, 1, photosFailed = 3, photosRefused = 2)),
        )
        assertEquals(
            "Import abgeschlossen: 1 Lacke, 0 Sticker, 0 Maniküren, 0 Foto(s). " +
                "2 Foto(s) konnten nicht importiert werden (Sync konfiguriert?).",
            describeImport(ImportSummary(1, 0, 0, 0, photosFailed = 2)),
        )
    }
}
