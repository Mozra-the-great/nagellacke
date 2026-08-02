package de.nagellacke.data.sync

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import de.nagellacke.BuildConfig
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

@Serializable data class SendReportRequest(val period: String, val date: String, val toEmail: String)
@Serializable data class ScheduleConfigDto(val enabled: Boolean, val frequency: String, val toEmail: String)
@Serializable data class ScheduleResponse(val config: ScheduleConfigDto? = null, val smtpConfigured: Boolean = false)
@Serializable data class SaveScheduleResponse(val ok: Boolean = false, val config: ScheduleConfigDto? = null)
@Serializable data class OkResponse(val ok: Boolean = false)

interface ReportApi {
    @POST("api/reports/send")
    suspend fun sendReport(@Body body: SendReportRequest): OkResponse

    @GET("api/reports/schedule")
    suspend fun getSchedule(): ScheduleResponse

    @POST("api/reports/schedule")
    suspend fun saveSchedule(@Body body: ScheduleConfigDto): SaveScheduleResponse
}

/**
 * Talks to the server's report endpoints (`/api/reports/send`, `/api/reports/schedule`) — email
 * delivery and the schedule config. The report preview itself is generated entirely client-side
 * (see [de.nagellacke.domain.generateReportHtml]) and doesn't need this client, matching how the
 * web app's "Bericht erstellen" button works.
 */
class ReportsClient(serverUrl: String, token: String) {
    private val json = Json { ignoreUnknownKeys = true }

    private val api: ReportApi by lazy {
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
            .create(ReportApi::class.java)
    }

    suspend fun sendReport(period: String, date: String, toEmail: String): Result<Unit> =
        runCatching { api.sendReport(SendReportRequest(period, date, toEmail)); Unit }

    suspend fun getSchedule(): Result<ScheduleResponse> = runCatching { api.getSchedule() }

    suspend fun saveSchedule(enabled: Boolean, frequency: String, toEmail: String): Result<Unit> =
        runCatching { api.saveSchedule(ScheduleConfigDto(enabled, frequency, toEmail)); Unit }
}
