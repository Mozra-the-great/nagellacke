package de.nagellacke.data.repo

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import dagger.hilt.android.qualifiers.ApplicationContext
import de.nagellacke.data.sync.SyncProvider
import javax.inject.Inject
import javax.inject.Singleton

data class SyncConfig(
    val provider: SyncProvider,
    val serverUrl: String = "",
    val serverToken: String = "",
    val nextcloudUrl: String = "",
    val nextcloudUser: String = "",
    val nextcloudPassword: String = "",
    val accessToken: String = "",
    val refreshToken: String = "",
    val tokenExpiry: Long = 0L,
)

@Singleton
class SyncConfigStore @Inject constructor(@ApplicationContext context: Context) {
    private val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)

    private val prefs = EncryptedSharedPreferences.create(
        "sync_config",
        masterKeyAlias,
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun getConfig(): SyncConfig? {
        val provider = prefs.getString("provider", null)?.let {
            runCatching { SyncProvider.valueOf(it) }.getOrNull()
        } ?: return null
        return SyncConfig(
            provider       = provider,
            serverUrl      = prefs.getString("serverUrl", "") ?: "",
            serverToken    = prefs.getString("serverToken", "") ?: "",
            nextcloudUrl   = prefs.getString("ncUrl", "") ?: "",
            nextcloudUser  = prefs.getString("ncUser", "") ?: "",
            nextcloudPassword = prefs.getString("ncPass", "") ?: "",
            accessToken    = prefs.getString("accessToken", "") ?: "",
            refreshToken   = prefs.getString("refreshToken", "") ?: "",
            tokenExpiry    = prefs.getLong("tokenExpiry", 0L),
        )
    }

    fun saveConfig(config: SyncConfig?) {
        prefs.edit().apply {
            if (config == null) {
                putString("provider", null)
            } else {
                putString("provider",     config.provider.name)
                putString("serverUrl",    config.serverUrl)
                putString("serverToken",  config.serverToken)
                putString("ncUrl",        config.nextcloudUrl)
                putString("ncUser",       config.nextcloudUser)
                putString("ncPass",       config.nextcloudPassword)
                putString("accessToken",  config.accessToken)
                putString("refreshToken", config.refreshToken)
                putLong("tokenExpiry",    config.tokenExpiry)
            }
        }.apply()
    }

    fun saveTokens(provider: SyncProvider, accessToken: String, refreshToken: String, expiry: Long) {
        val existing = getConfig() ?: return
        saveConfig(existing.copy(
            provider     = provider,
            accessToken  = accessToken,
            refreshToken = refreshToken,
            tokenExpiry  = expiry,
        ))
    }

    fun clearConfig() = saveConfig(null)
}
