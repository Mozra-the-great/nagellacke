package de.nagellacke.data.sync

import de.nagellacke.domain.model.AppData
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

@Serializable data class LoginRequest(val username: String, val password: String)
@Serializable data class LoginResponse(val token: String)
@Serializable data class SyncRequest(val data: AppData, val clientTime: Long)
@Serializable data class SyncResponse(val data: AppData)
@Serializable data class PhotoRequest(val data: String, val mimeType: String)
@Serializable data class PhotoResponse(val filename: String)

interface ServerApi {
    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @POST("api/auth/register")
    suspend fun register(@Body body: LoginRequest): LoginResponse

    @GET("api/sync")
    suspend fun getSync(): SyncResponse

    @POST("api/sync")
    suspend fun postSync(@Body body: SyncRequest): SyncResponse

    @POST("api/photos")
    suspend fun uploadPhoto(@Body body: PhotoRequest): PhotoResponse

    @DELETE("api/photos/{filename}")
    suspend fun deletePhoto(@Path("filename") filename: String)
}
