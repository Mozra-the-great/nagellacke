package de.nagellacke.ui.settings

import android.content.Context
import android.content.Intent
import android.net.Uri
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

object OAuthClientIds {
    // Replace with your actual client IDs registered in each developer console
    const val Google   = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
    const val Microsoft = "YOUR_MICROSOFT_CLIENT_ID"
    const val Dropbox  = "YOUR_DROPBOX_APP_KEY"
    const val Redirect = "nagellacke://oauth"
}

fun buildAuthIntent(context: Context, config: AuthorizationServiceConfiguration, clientId: String, scopes: List<String>): Intent {
    val request = AuthorizationRequest.Builder(config, clientId, ResponseTypeValues.CODE, Uri.parse(OAuthClientIds.Redirect))
        .setScopes(scopes)
        .build() // AppAuth generates PKCE code verifier automatically
    return AuthorizationService(context).getAuthorizationRequestIntent(request)
}
