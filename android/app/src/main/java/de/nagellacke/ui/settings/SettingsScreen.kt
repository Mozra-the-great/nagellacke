package de.nagellacke.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import de.nagellacke.data.sync.SyncProvider
import kotlinx.coroutines.launch
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationResponse
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val PROVIDERS = listOf(
    SyncProvider.Server    to "Eigener Server",
    SyncProvider.Nextcloud to "Nextcloud",
    SyncProvider.GoogleDrive to "Google Drive",
    SyncProvider.OneDrive  to "OneDrive",
    SyncProvider.Dropbox   to "Dropbox",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(vm: SettingsViewModel = hiltViewModel()) {
    val state by vm.uiState.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var selectedProvider by remember { mutableStateOf(state.syncConfig?.provider ?: SyncProvider.Server) }
    var serverUrl   by remember { mutableStateOf(state.syncConfig?.serverUrl ?: "") }
    var serverToken by remember { mutableStateOf(state.syncConfig?.serverToken ?: "") }
    var ncUrl  by remember { mutableStateOf(state.syncConfig?.nextcloudUrl ?: "") }
    var ncUser by remember { mutableStateOf(state.syncConfig?.nextcloudUser ?: "") }
    var ncPass by remember { mutableStateOf(state.syncConfig?.nextcloudPassword ?: "") }
    var showLogin by remember { mutableStateOf(false) }
    var loginMode by remember { mutableStateOf("login") }
    var oauthError by remember { mutableStateOf<String?>(null) }

    // OAuth launchers
    val googleLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val resp = AuthorizationResponse.fromIntent(result.data ?: return@rememberLauncherForActivityResult) ?: return@rememberLauncherForActivityResult
        net.openid.appauth.AuthorizationService(context).performTokenRequest(resp.createTokenExchangeRequest()) { token, ex ->
            when {
                token != null -> {
                    vm.saveOAuthConfig(SyncProvider.GoogleDrive, token.accessToken ?: "", token.refreshToken ?: "", token.accessTokenExpirationTime ?: 0L)
                    oauthError = null
                }
                ex != null -> oauthError = "Google-Anmeldung fehlgeschlagen: ${ex.errorDescription ?: ex.error ?: "Unbekannter Fehler"}"
                else -> oauthError = "Google-Anmeldung fehlgeschlagen"
            }
        }
    }

    Scaffold(topBar = { TopAppBar(title = { Text("Einstellungen", fontWeight = FontWeight.Bold) }) }) { padding ->
        Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(16.dp)) {

            // Stats
            Text("Sammlung", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatCard(state.polishCount, "Lacke", Modifier.weight(1f))
                StatCard(state.stickerCount, "Sticker", Modifier.weight(1f))
                StatCard(state.manicureCount, "Maniküren", Modifier.weight(1f))
            }

            HorizontalDivider(Modifier.padding(vertical = 16.dp))

            // Display preferences
            Text("Darstellung", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Text("Lack-Ansicht", style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = state.bottleStyle,
                    onClick  = { vm.setBottleStyle(true) },
                    label    = { Text("◎ Flasche") },
                )
                FilterChip(
                    selected = !state.bottleStyle,
                    onClick  = { vm.setBottleStyle(false) },
                    label    = { Text("⬤ Farb-Swatch") },
                )
            }
            Text(
                "Gilt für Lacke ohne Foto-Ansicht.",
                style    = MaterialTheme.typography.bodySmall,
                color    = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(top = 2.dp),
            )

            HorizontalDivider(Modifier.padding(vertical = 16.dp))

            // Sync
            Text("Synchronisation", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))

            if (state.syncError != null) {
                Card(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                    Text("⚠ Sync-Fehler: ${state.syncError}", Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error)
                }
            }
            if (state.httpWarning) {
                Card(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                    Text("⚠ Server-URL verwendet HTTP — Daten werden unverschlüsselt übertragen. Bitte HTTPS verwenden.", Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error)
                }
            }
            state.lastSyncAt?.let {
                Text("Letzter Sync: ${formatTs(it)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(bottom = 8.dp))
            }

            Text("Anbieter", style = MaterialTheme.typography.labelLarge)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                PROVIDERS.forEach { (p, label) ->
                    FilterChip(selected = selectedProvider == p, onClick = { selectedProvider = p }, label = { Text(label) })
                }
            }
            Spacer(Modifier.height(8.dp))

            when (selectedProvider) {
                SyncProvider.Server -> {
                    OutlinedTextField(serverUrl, { serverUrl = it }, label = { Text("Server-URL") }, placeholder = { Text("https://example.com") }, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(serverToken, { serverToken = it }, label = { Text("JWT-Token") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { loginMode = "login"; showLogin = true }) { Text("Login") }
                        TextButton(onClick = { loginMode = "register"; showLogin = true }) { Text("Registrieren") }
                    }
                    Button(onClick = { vm.saveServerConfig(serverUrl, serverToken) }, modifier = Modifier.fillMaxWidth()) { Text("Speichern") }
                }
                SyncProvider.Nextcloud -> {
                    OutlinedTextField(ncUrl, { ncUrl = it }, label = { Text("Nextcloud-URL") }, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(ncUser, { ncUser = it }, label = { Text("Benutzername") }, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(ncPass, { ncPass = it }, label = { Text("Passwort / App-Token") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = { vm.saveNextcloudConfig(ncUrl, ncUser, ncPass) }, modifier = Modifier.fillMaxWidth()) { Text("Speichern") }
                }
                SyncProvider.GoogleDrive -> {
                    Text("Google Drive Zugriff via OAuth2", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(8.dp))
                    if (oauthError != null) {
                        Card(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                            Text("⚠ $oauthError", Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error)
                        }
                    }
                    Button(onClick = {
                        oauthError = null
                        googleLauncher.launch(buildAuthIntent(context, OAuthEndpoints.Google, OAuthClientIds.Google, listOf("https://www.googleapis.com/auth/drive.file")))
                    }, modifier = Modifier.fillMaxWidth()) { Text("Mit Google anmelden") }
                }
                SyncProvider.OneDrive -> {
                    Text("OneDrive Zugriff via OAuth2 (Microsoft)", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = {}, modifier = Modifier.fillMaxWidth(), enabled = false) { Text("Mit Microsoft anmelden (in Kürze)") }
                }
                SyncProvider.Dropbox -> {
                    Text("Dropbox Zugriff via OAuth2", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = {}, modifier = Modifier.fillMaxWidth(), enabled = false) { Text("Mit Dropbox anmelden (in Kürze)") }
                }
            }

            Spacer(Modifier.height(12.dp))
            if (state.syncConfig != null) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { vm.syncNow() },
                        enabled = !state.syncing,
                        modifier = Modifier.weight(1f),
                    ) {
                        if (state.syncing) CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
                        Text(if (state.syncing) "Synchronisiere…" else "Jetzt syncen")
                    }
                    TextButton(onClick = { vm.clearConfig() }) { Text("Verbindung trennen") }
                }
            }
        }
    }

    if (showLogin) {
        ServerLoginDialog(
            mode = loginMode,
            serverUrl = serverUrl,
            onDismiss = { showLogin = false },
            onSuccess = { token -> serverToken = token; vm.saveServerConfig(serverUrl, token); showLogin = false },
            vm = vm,
        )
    }
}

@Composable
fun ServerLoginDialog(mode: String, serverUrl: String, onDismiss: () -> Unit, onSuccess: (String) -> Unit, vm: SettingsViewModel) {
    val scope = rememberCoroutineScope()
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (mode == "login") "Server-Login" else "Registrieren") },
        text = {
            Column {
                OutlinedTextField(username, { username = it }, label = { Text("Benutzername") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(password, { password = it }, label = { Text("Passwort") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                if (error.isNotBlank()) { Spacer(Modifier.height(8.dp)); Text(error, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    scope.launch {
                        loading = true; error = ""
                        val result = if (mode == "login") vm.serverLogin(serverUrl, username, password) else vm.serverRegister(serverUrl, username, password)
                        loading = false
                        result.onSuccess { onSuccess(it) }.onFailure { error = it.message ?: "Fehler" }
                    }
                },
                enabled = !loading && username.isNotBlank() && password.isNotBlank(),
            ) { Text(if (mode == "login") "Anmelden" else "Registrieren") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}

@Composable
fun StatCard(num: Int, label: String, modifier: Modifier = Modifier) {
    Card(modifier) {
        Column(Modifier.padding(14.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(num.toString(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            Text(label, style = MaterialTheme.typography.bodySmall)
        }
    }
}

private fun formatTs(ts: Long) = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMAN).format(Date(ts))
