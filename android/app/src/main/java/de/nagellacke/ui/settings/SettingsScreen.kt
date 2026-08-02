package de.nagellacke.ui.settings

import android.webkit.WebView
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import de.nagellacke.data.sync.SyncProvider
import de.nagellacke.domain.ReportPeriod
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
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

    var selectedProvider by remember { mutableStateOf(state.syncConfig?.provider ?: SyncProvider.Server) }
    var serverUrl   by remember { mutableStateOf(state.syncConfig?.serverUrl ?: "") }
    var serverToken by remember { mutableStateOf(state.syncConfig?.serverToken ?: "") }
    var ncUrl  by remember { mutableStateOf(state.syncConfig?.nextcloudUrl ?: "") }
    var ncUser by remember { mutableStateOf(state.syncConfig?.nextcloudUser ?: "") }
    var ncPass by remember { mutableStateOf(state.syncConfig?.nextcloudPassword ?: "") }
    var showLogin by remember { mutableStateOf(false) }
    var loginMode by remember { mutableStateOf("login") }

    var reportPeriod by remember { mutableStateOf(ReportPeriod.Week) }
    var reportDate by remember { mutableStateOf(LocalDate.now()) }
    var showReportDatePicker by remember { mutableStateOf(false) }
    var reportHtml by remember { mutableStateOf<String?>(null) }
    var reportEmail by remember { mutableStateOf("") }
    var reportEmailStatus by remember { mutableStateOf<String?>(null) }
    var scheduleEnabled by remember(state.reportSchedule.loaded) { mutableStateOf(state.reportSchedule.enabled) }
    var scheduleFrequency by remember(state.reportSchedule.loaded) { mutableStateOf(state.reportSchedule.frequency) }
    var scheduleEmail by remember(state.reportSchedule.loaded) { mutableStateOf(state.reportSchedule.toEmail) }
    var scheduleSaveStatus by remember { mutableStateOf<String?>(null) }

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
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
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
                    Button(onClick = {}, modifier = Modifier.fillMaxWidth(), enabled = false) { Text("Mit Google anmelden (in Kürze)") }
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

            HorizontalDivider(Modifier.padding(vertical = 16.dp))

            // Reports
            Text("Berichte", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = reportPeriod == ReportPeriod.Week, onClick = { reportPeriod = ReportPeriod.Week }, label = { Text("Wochenübersicht") })
                FilterChip(selected = reportPeriod == ReportPeriod.Month, onClick = { reportPeriod = ReportPeriod.Month }, label = { Text("Monatsübersicht") })
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = reportDate.format(DateTimeFormatter.ofPattern("dd.MM.yyyy")),
                onValueChange = {},
                label = { Text("Datum im Zeitraum") },
                readOnly = true,
                enabled = false,
                modifier = Modifier.fillMaxWidth().clickable { showReportDatePicker = true },
            )
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = { scope.launch { reportHtml = vm.buildReportHtml(reportPeriod, reportDate) } },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("📄 Bericht erstellen") }

            if (state.syncConfig?.provider == SyncProvider.Server) {
                Spacer(Modifier.height(16.dp))
                HorizontalDivider()
                Spacer(Modifier.height(12.dp))
                Text("Per E-Mail senden", style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.height(6.dp))

                if (!state.reportSchedule.smtpConfigured) {
                    Card(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                        Text(
                            "SMTP nicht konfiguriert — bitte SMTP_HOST, SMTP_USER und SMTP_PASS als Umgebungsvariablen auf dem Server setzen.",
                            Modifier.padding(12.dp),
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }

                OutlinedTextField(reportEmail, { reportEmail = it }, label = { Text("E-Mail-Adresse") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(6.dp))
                if (reportEmailStatus == "error") {
                    Text("Senden fehlgeschlagen", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                if (reportEmailStatus == "sent") {
                    Text("✓ Bericht gesendet!", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
                }
                Button(
                    onClick = {
                        scope.launch {
                            reportEmailStatus = "sending"
                            val period = if (reportPeriod == ReportPeriod.Week) "week" else "month"
                            val result = vm.sendReportEmail(period, reportDate.toString(), reportEmail)
                            reportEmailStatus = if (result.isSuccess) "sent" else "error"
                        }
                    },
                    enabled = reportEmail.isNotBlank() && state.reportSchedule.smtpConfigured && reportEmailStatus != "sending",
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (reportEmailStatus == "sending") "Sende…" else "✉ Jetzt per E-Mail senden") }

                Spacer(Modifier.height(16.dp))
                HorizontalDivider()
                Spacer(Modifier.height(12.dp))
                Text("Automatischer Zeitplan", style = MaterialTheme.typography.labelLarge)
                Text(
                    "Wöchentlich: jeden Montag 08:00 Uhr (Vorwoche). Monatlich: 1. des Monats 08:00 Uhr (Vormonat).",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = scheduleEnabled, onClick = { scheduleEnabled = true }, label = { Text("An") })
                    FilterChip(selected = !scheduleEnabled, onClick = { scheduleEnabled = false }, label = { Text("Aus") })
                }
                if (scheduleEnabled) {
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = scheduleFrequency == "weekly", onClick = { scheduleFrequency = "weekly" }, label = { Text("Wöchentlich") })
                        FilterChip(selected = scheduleFrequency == "monthly", onClick = { scheduleFrequency = "monthly" }, label = { Text("Monatlich") })
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(scheduleEmail, { scheduleEmail = it }, label = { Text("Senden an") }, modifier = Modifier.fillMaxWidth())
                }
                Spacer(Modifier.height(8.dp))
                if (scheduleSaveStatus == "error") {
                    Text("Speichern fehlgeschlagen", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                Button(
                    onClick = {
                        scope.launch {
                            scheduleSaveStatus = "saving"
                            val result = vm.saveReportSchedule(scheduleEnabled, scheduleFrequency, scheduleEmail)
                            scheduleSaveStatus = if (result.isSuccess) "saved" else "error"
                        }
                    },
                    enabled = scheduleSaveStatus != "saving" && state.reportSchedule.smtpConfigured,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (scheduleSaveStatus == "saving") "Speichere…" else if (scheduleSaveStatus == "saved") "✓ Gespeichert" else "Zeitplan speichern") }
            }
        }
    }

    if (showReportDatePicker) {
        val pickerState = rememberDatePickerState(
            initialSelectedDateMillis = reportDate.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
        )
        DatePickerDialog(
            onDismissRequest = { showReportDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    pickerState.selectedDateMillis?.let {
                        reportDate = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()
                    }
                    showReportDatePicker = false
                }) { Text("OK") }
            },
        ) { DatePicker(pickerState) }
    }

    reportHtml?.let { html ->
        ReportPreviewDialog(html = html, onDismiss = { reportHtml = null })
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

/** Full-screen HTML report preview — the generated report is plain HTML/CSS, so a WebView
 *  renders it exactly like "open in a new tab" does on the web app, without reimplementing
 *  the layout as Compose UI. */
@Composable
private fun ReportPreviewDialog(html: String, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.End) {
                IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, contentDescription = "Schließen") }
            }
            AndroidView(
                factory = { context ->
                    WebView(context).apply {
                        settings.javaScriptEnabled = false
                        loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
