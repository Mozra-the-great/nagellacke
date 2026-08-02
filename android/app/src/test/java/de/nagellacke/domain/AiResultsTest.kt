package de.nagellacke.domain

import de.nagellacke.data.sync.AiJobDto
import de.nagellacke.domain.model.FinishType
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AiResultsTest {
    private fun doneJob(resultJson: String?) = AiJobDto(
        id = "j1", type = "autofill", status = "done",
        result = resultJson?.let { Json.parseToJsonElement(it) },
    )

    @Test fun `parses color and finish when both present and finish label matches`() {
        val job = doneJob("""{"color":"#ffc0cb","finish":"Classic"}""")
        assertEquals(AutofillResult(color = "#ffc0cb", finish = FinishType.Classic), parseAutofillResult(job))
    }

    @Test fun `parses color only when finish is missing`() {
        val job = doneJob("""{"color":"#ffc0cb"}""")
        assertEquals(AutofillResult(color = "#ffc0cb", finish = null), parseAutofillResult(job))
    }

    @Test fun `finish that does not map to any FinishType is dropped, color kept`() {
        val job = doneJob("""{"color":"#ffc0cb","finish":"Sparkly Rainbow"}""")
        assertEquals(AutofillResult(color = "#ffc0cb", finish = null), parseAutofillResult(job))
    }

    @Test fun `finish label with a space (SerialName-only value) still matches`() {
        val job = doneJob("""{"finish":"Gel Look"}""")
        assertEquals(AutofillResult(color = null, finish = FinishType.GelLook), parseAutofillResult(job))
    }

    @Test fun `returns null when neither field is present`() {
        val job = doneJob("""{}""")
        assertNull(parseAutofillResult(job))
    }

    @Test fun `returns null when job is not done`() {
        val job = doneJob("""{"color":"#ffc0cb","finish":"Classic"}""").copy(status = "running")
        assertNull(parseAutofillResult(job))
    }

    @Test fun `returns null when job has no result`() {
        assertNull(parseAutofillResult(doneJob(null)))
    }

    @Test fun `smart-cart added count is parsed`() {
        assertEquals(3, parseSmartCartAdded(doneJob("""{"added":3}""")))
    }

    @Test fun `smart-cart added defaults to 0 when missing or job not done`() {
        assertEquals(0, parseSmartCartAdded(doneJob("""{}""")))
        assertEquals(0, parseSmartCartAdded(doneJob("""{"added":3}""").copy(status = "error")))
        assertEquals(0, parseSmartCartAdded(doneJob(null)))
    }
}
