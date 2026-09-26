package de.nagellacke.domain

import de.nagellacke.domain.AiAssistant.AutofillOutcome
import org.junit.Assert.assertEquals
import org.junit.Test

/** #324 S22: the autofill outcome is shown now instead of being dropped. */
class AutofillMessageTest {
    @Test
    fun `each outcome has a message, a failure carries the server's reason`() {
        assertEquals("KI-Auto-Fill: Farbe und Finish ergänzt.", AiAssistant.message(AutofillOutcome.Applied))
        assertEquals("KI-Auto-Fill hat nichts Passendes gefunden.", AiAssistant.message(AutofillOutcome.NoResult))
        assertEquals(
            "KI-Auto-Fill fehlgeschlagen: KI-Funktionen sind auf diesem Server deaktiviert",
            AiAssistant.message(AutofillOutcome.Failed("KI-Funktionen sind auf diesem Server deaktiviert")),
        )
    }
}
