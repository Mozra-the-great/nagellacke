package de.nagellacke.domain

import de.nagellacke.data.sync.AiJobDto
import de.nagellacke.domain.model.FinishType
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

/**
 * Result of a finished autofill job. Both fields are independently optional: the AI (or the
 * job) may only have produced one of them, or a `finish` value that doesn't map to any
 * [FinishType] — callers should apply only the non-null fields and leave the rest untouched.
 */
data class AutofillResult(val color: String?, val finish: FinishType?)

/** Extracts `{color?, finish?}` from a finished autofill job's result, matching finish by label
 *  the same way [de.nagellacke.data.local.PolishEntity]'s toDomain() mapper does. Returns null
 *  for a job that isn't done, has no result, or produced neither field. */
fun parseAutofillResult(job: AiJobDto): AutofillResult? {
    if (job.status != "done") return null
    val result = job.result as? JsonObject ?: return null
    val color = (result["color"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    val finishRaw = (result["finish"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    val finish = finishRaw?.let { raw -> FinishType.entries.firstOrNull { it.label == raw } }
    if (color == null && finish == null) return null
    return AutofillResult(color, finish)
}

/** Extracts the number of wishlist items a finished smart-cart job added; 0 if unparseable. */
fun parseSmartCartAdded(job: AiJobDto): Int {
    if (job.status != "done") return 0
    val result = job.result as? JsonObject ?: return 0
    return runCatching { result["added"]?.jsonPrimitive?.content?.toInt() }.getOrNull() ?: 0
}
