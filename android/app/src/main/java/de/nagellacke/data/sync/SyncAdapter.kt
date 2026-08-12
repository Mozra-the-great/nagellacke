package de.nagellacke.data.sync

import de.nagellacke.domain.model.AppData
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request

enum class SyncProvider { Server, Nextcloud, GoogleDrive, OneDrive, Dropbox }

data class SyncResult(
    val success: Boolean,
    val merged: AppData,
    val error: String? = null,
    val lastSyncAt: Long = System.currentTimeMillis(),
)

data class PhotoUploadResult(val filename: String, val url: String)

interface SyncAdapter {
    val provider: SyncProvider
    suspend fun sync(local: AppData): SyncResult
    suspend fun uploadPhoto(data: ByteArray, mimeType: String): PhotoUploadResult
    suspend fun deletePhoto(filename: String)
    fun photoUrl(filename: String): String
}

/**
 * Result of trying to fetch the remote data file before merging.
 *
 * Distinguishes a genuine first-sync "nothing there yet" state ([NotFound]) from an actual
 * read failure ([Error]) — e.g. an auth error, network error, or unparseable response — so a
 * failed read doesn't fail open to "local wins" and clobber the remote copy (#116).
 */
internal sealed class RemoteFetchResult {
    data class Found(val data: AppData) : RemoteFetchResult()
    object NotFound : RemoteFetchResult()
    data class Error(val message: String) : RemoteFetchResult()
}

/** Maps a photo MIME type to a filename extension, mirroring the server's logic (server/src/index.ts). */
internal fun extensionForMimeType(mimeType: String): String = when (mimeType) {
    "image/png" -> "png"
    "image/webp" -> "webp"
    else -> "jpg"
}

/** Response body of an OAuth2 `grant_type=refresh_token` token exchange. */
@Serializable
internal data class OAuthTokenRefreshResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("expires_in") val expiresIn: Long = 3600,
    @SerialName("refresh_token") val refreshToken: String? = null,
)

/**
 * Exchanges [refreshToken] for a new access token at [tokenEndpoint]. Returns null if the
 * request fails or the response can't be parsed — callers must treat that as "refresh failed"
 * and abort rather than send a known-expired token (#116).
 */
internal fun refreshOAuthToken(
    client: OkHttpClient,
    json: Json,
    tokenEndpoint: String,
    clientId: String,
    refreshToken: String,
): OAuthTokenRefreshResponse? {
    val formBody = FormBody.Builder()
        .add("grant_type", "refresh_token")
        .add("refresh_token", refreshToken)
        .add("client_id", clientId)
        .build()
    val res = client.newCall(Request.Builder().url(tokenEndpoint).post(formBody).build()).execute()
    val body = res.body?.string()
    val ok = res.isSuccessful
    res.close()
    if (!ok || body == null) return null
    return runCatching { json.decodeFromString<OAuthTokenRefreshResponse>(body) }.getOrNull()
}
