package de.nagellacke.data.sync

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import de.nagellacke.BuildConfig
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

@Serializable data class OpenRouterSettingsDto(val model: String, val freeOnly: Boolean, val hasApiKey: Boolean)
@Serializable data class GeminiSettingsDto(val model: String, val hasApiKey: Boolean)
@Serializable data class WebSearchSettingsDto(val backend: String, val searxngUrl: String, val hasBraveApiKey: Boolean)
@Serializable data class AiSettingsDto(
    val provider: String,
    val openrouter: OpenRouterSettingsDto,
    val gemini: GeminiSettingsDto,
    val webSearch: WebSearchSettingsDto,
)

@Serializable data class SaveOpenRouterDto(val apiKey: String? = null, val model: String, val freeOnly: Boolean)
@Serializable data class SaveGeminiDto(val apiKey: String? = null, val model: String)
@Serializable data class SaveWebSearchDto(val backend: String, val searxngUrl: String, val braveApiKey: String? = null)
@Serializable data class SaveAiSettingsRequest(
    val provider: String,
    val openrouter: SaveOpenRouterDto,
    val gemini: SaveGeminiDto,
    val webSearch: SaveWebSearchDto,
)

@Serializable data class AutofillRequest(val name: String, val brand: String, val num: String)
@Serializable data class SmartCartRequest(val prompt: String)
@Serializable data class JobIdResponse(val jobId: String)
@Serializable data class AiJobDto(
    val id: String,
    val type: String,
    val status: String,
    val result: JsonElement? = null,
    val error: String? = null,
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
)
@Serializable data class AiJobResponse(val job: AiJobDto)
@Serializable private data class ErrorResponse(val error: String? = null)

interface AiApi {
    @GET("api/ai/settings")
    suspend fun getSettings(): AiSettingsDto

    @POST("api/ai/settings")
    suspend fun saveSettings(@Body body: SaveAiSettingsRequest): OkResponse

    @POST("api/ai/autofill")
    suspend fun startAutofill(@Body body: AutofillRequest): JobIdResponse

    @POST("api/ai/smart-cart")
    suspend fun startSmartCart(@Body body: SmartCartRequest): JobIdResponse

    @GET("api/ai/jobs/{id}")
    suspend fun getJob(@Path("id") id: String): AiJobResponse
}

/** Thrown/wrapped by [AiClient] so failures carry the server's actual German error text
 *  (e.g. a spent AI quota, or "provider not configured") instead of a generic HTTP status —
 *  required by #148 so quota exhaustion reads as that, not as an opaque failure. */
class AiRequestException(message: String) : Exception(message)

/** Talks to the server's AI endpoints — settings, autofill, smart-cart, job polling. */
class AiClient(serverUrl: String, token: String) {
    private val json = Json { ignoreUnknownKeys = true }

    private val api: AiApi by lazy {
        val base = serverUrl.trimEnd('/') + "/"
        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                chain.proceed(chain.request().newBuilder().header("Authorization", "Bearer $token").build())
            }
            .apply {
                if (BuildConfig.DEBUG) {
                    addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
                }
            }
            .build()

        Retrofit.Builder()
            .baseUrl(base)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(AiApi::class.java)
    }

    private suspend fun <T> safeCall(block: suspend () -> T): Result<T> = try {
        Result.success(block())
    } catch (e: HttpException) {
        val serverMessage = e.response()?.errorBody()?.string()
            ?.let { raw -> runCatching { json.decodeFromString<ErrorResponse>(raw).error }.getOrNull() }
        Result.failure(AiRequestException(serverMessage ?: e.message() ?: "Fehler ${e.code()}"))
    } catch (e: Exception) {
        Result.failure(e)
    }

    suspend fun getSettings(): Result<AiSettingsDto> = safeCall { api.getSettings() }

    suspend fun saveSettings(body: SaveAiSettingsRequest): Result<Unit> = safeCall { api.saveSettings(body); Unit }

    suspend fun startAutofill(name: String, brand: String, num: String): Result<String> =
        safeCall { api.startAutofill(AutofillRequest(name, brand, num)).jobId }

    suspend fun startSmartCart(prompt: String): Result<String> =
        safeCall { api.startSmartCart(SmartCartRequest(prompt)).jobId }

    /** Polls a job until it reaches a terminal state, mirroring pollAiJob() in ai.ts. */
    suspend fun pollJob(jobId: String, intervalMs: Long = 2000, timeoutMs: Long = 120_000): Result<AiJobDto> = safeCall {
        val start = System.currentTimeMillis()
        while (true) {
            val job = api.getJob(jobId).job
            if (job.status == "done" || job.status == "error") return@safeCall job
            if (System.currentTimeMillis() - start > timeoutMs) throw AiRequestException("Zeitüberschreitung bei der KI-Anfrage")
            delay(intervalMs)
        }
        @Suppress("UNREACHABLE_CODE")
        error("unreachable")
    }
}
