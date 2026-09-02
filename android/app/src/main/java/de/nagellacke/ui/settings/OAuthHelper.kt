package de.nagellacke.ui.settings

import android.content.Context
import android.content.Intent
import android.net.Uri
import de.nagellacke.BuildConfig
import net.openid.appauth.AuthorizationRequest
import net.openid.appauth.AuthorizationService
import net.openid.appauth.AuthorizationServiceConfiguration
import net.openid.appauth.ResponseTypeValues

object OAuthEndpoints {
    val Google = AuthorizationServiceConfiguration(
        Uri.parse("https://accounts.google.com/o/oauth2/v2/auth"),
        Uri.parse("https://oauth2.googleapis.com/token"),
    )
    val Microsoft = AuthorizationServiceConfiguration(
        Uri.parse("https://login.microsoftonline.com/common/oauth2/v2.0/authorize"),
        Uri.parse("https://login.microsoftonline.com/common/oauth2/v2.0/token"),
    )
    val Dropbox = AuthorizationServiceConfiguration(
        Uri.parse("https://www.dropbox.com/oauth2/authorize"),
        Uri.parse("https://api.dropboxapi.com/oauth2/token"),
    )
}

/**
 * OAuth client ids for the cloud-sync providers, supplied at build time.
 *
 * These used to be hardcoded placeholder strings ("YOUR_GOOGLE_CLIENT_ID...") that were
 * handed straight to the real OAuth authorization and token endpoints, with nothing in
 * the build, the README or the app saying they had to be replaced first (#271). They now
 * come from BuildConfig, fed by an OAUTH_CLIENT_ID_* environment variable or the matching
 * key in android/local.properties - the same pattern the release signing config uses. See
 * the README for how to register the clients.
 *
 * An unconfigured id is the empty string, never a placeholder: "" is unambiguously "not
 * set up", whereas a placeholder is indistinguishable from a real but wrong id.
 */
object OAuthClientIds {
    val Google: String = BuildConfig.OAUTH_CLIENT_ID_GOOGLE
    val Microsoft: String = BuildConfig.OAUTH_CLIENT_ID_MICROSOFT
    val Dropbox: String = BuildConfig.OAUTH_CLIENT_ID_DROPBOX
    const val Redirect = "nagellacke://oauth"

    /** False when this build has no client id for the provider, so callers can say so. */
    fun isConfigured(clientId: String): Boolean = clientId.isNotBlank()
}

/**
 * Note: nothing calls this yet - the "Mit Google/Microsoft/Dropbox anmelden" buttons in
 * SettingsScreen are still disabled ("in Kürze"). Callers must check
 * [OAuthClientIds.isConfigured] first and tell the user to set the client id up, rather
 * than sending a request the provider can only reject.
 */
fun buildAuthIntent(context: Context, config: AuthorizationServiceConfiguration, clientId: String, scopes: List<String>): Intent {
    require(OAuthClientIds.isConfigured(clientId)) {
        "Kein OAuth-Client-ID für diesen Anbieter einkompiliert — siehe README (OAUTH_CLIENT_ID_*)"
    }
    val request = AuthorizationRequest.Builder(config, clientId, ResponseTypeValues.CODE, Uri.parse(OAuthClientIds.Redirect))
        .setScopes(scopes)
        .build() // AppAuth generates PKCE code verifier automatically
    val service = AuthorizationService(context)
    val intent = service.getAuthorizationRequestIntent(request)
    service.dispose()
    return intent
}
