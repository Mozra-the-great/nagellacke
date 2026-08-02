package de.nagellacke.domain

import de.nagellacke.data.repo.NagellackeRepository
import de.nagellacke.data.repo.SyncConfigStore
import de.nagellacke.data.sync.AiClient
import de.nagellacke.data.sync.SyncProvider
import kotlinx.coroutines.flow.first
import javax.inject.Inject

/**
 * Orchestrates AI Autofill against the server, matching CartPage.tsx's runAutofill(): start the
 * job, poll it to completion, then apply the result. Injected into whichever ViewModel owns the
 * polish form (Collection, Wishlist) so the job survives the sheet being dismissed — it's driven
 * by the caller's viewModelScope, not a Composable-scoped coroutine.
 */
class AiAssistant @Inject constructor(
    private val repo: NagellackeRepository,
    private val configStore: SyncConfigStore,
) {
    sealed class AutofillOutcome {
        data object Applied : AutofillOutcome()
        data object NoResult : AutofillOutcome()
        data class Failed(val message: String) : AutofillOutcome()
    }

    private fun client(): AiClient? {
        val cfg = configStore.getConfig() ?: return null
        if (cfg.provider != SyncProvider.Server || cfg.serverUrl.isBlank()) return null
        return AiClient(cfg.serverUrl, cfg.serverToken)
    }

    /**
     * Starts an autofill job for the already-inserted polish [polishId], polls it to completion,
     * then re-reads the CURRENT stored copy and applies color/finish to it — never the copy that
     * was passed in when the job started — so a slow job can't clobber edits made in the
     * meantime. [NagellackeRepository.updatePolish] bumps `updatedAt` itself, so the AI's result
     * survives the next sync instead of losing a last-write-wins race (see #141).
     */
    suspend fun runAutofill(polishId: String, name: String, brand: String, num: String): AutofillOutcome {
        val client = client() ?: return AutofillOutcome.Failed("Kein Server-Sync konfiguriert")
        val jobId = client.startAutofill(name, brand, num)
            .getOrElse { return AutofillOutcome.Failed(it.message ?: "Unbekannter Fehler") }
        val job = client.pollJob(jobId)
            .getOrElse { return AutofillOutcome.Failed(it.message ?: "Unbekannter Fehler") }
        if (job.status == "error") return AutofillOutcome.Failed(job.error ?: "Unbekannter Fehler")
        val result = parseAutofillResult(job) ?: return AutofillOutcome.NoResult
        val current = repo.observeData().first().polishes.find { it.id == polishId } ?: return AutofillOutcome.NoResult
        repo.updatePolish(current.copy(color = result.color ?: current.color, finish = result.finish ?: current.finish))
        return AutofillOutcome.Applied
    }
}
