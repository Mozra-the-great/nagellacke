# Android wieder aufnehmen

Die native Android-App ist seit **2026-10 eingefroren (EOL, [#372](https://github.com/Mozra-the-great/nagellacke/issues/372))**.
Sie ist **stillgelegt, nicht gelöscht**: Der Code liegt unverändert unter `android/`, der letzte
gepflegte Stand ist der Tag **`android-final`** (`git checkout android-final`). Weiterentwickelt
wird nur noch die Web-App plus Server. Es gab zum Zeitpunkt des EOL keine aktiven Android-Nutzer,
deshalb gibt es keinen Hinweis in der App.

Diese Seite hält fest, **was abgeschaltet wurde** und **wie man es wieder einschaltet**.

## Was stillgelegt wurde

| Bereich | Zustand | Wo |
|---|---|---|
| Code | unverändert | `android/` (Tag `android-final`) |
| CI-Job `build-android` | bleibt in der Datei, läuft nur bei Repo-Variable `ANDROID_ENABLED == 'true'` | `.github/workflows/ci.yml` |
| Required Check `build-android` | **unverändert eingetragen** (Ruleset „Required checks"); der übersprungene Job zählt als bestanden | Repo-Settings → Rules |
| Release-Workflow | nur noch manuell (`workflow_dispatch`); der `android-v*`-Tag-Trigger ist auskommentiert | `.github/workflows/android-release.yml` |
| Secrets / Keystore | unverändert vorhanden (siehe unten) | GitHub-Secrets, lokale Maschine |
| Dependabot | es gibt keine `.github/dependabot.yml`, also keine Gradle-Versions-Updates; siehe Schritt 6 unten | — |
| Server / Sync | unverändert, nichts entfernt (siehe unten) | `v3/server/` |
| Play Store | kein veröffentlichter Eintrag bekannt (siehe unten) | — |
| Label `area/android` | bleibt | GitHub |

## Secrets und Keystore (nur Namen und Orte, keine Werte)

GitHub-Actions-Secrets im Repo (vom Release-Workflow gelesen):

- `KEYSTORE_BASE64` — der Keystore als Base64 (wird im Workflow nach `android/app/nagellacke-release.jks` dekodiert)
- `KEYSTORE_PASSWORD`
- `KEY_ALIAS`
- `KEY_PASSWORD`

Der Release-Keystore selbst liegt **lokal auf Moritz' Entwicklungsrechner** unter
`%USERPROFILE%\keystores\nagellacke-release.jks` (daneben eine `nagellacke-release-CREDENTIALS.txt`).
Das ist die einzige Kopie außerhalb der GitHub-Secrets — **sichern, nicht neu erzeugen**: Mit einem neuen
Keystore ließen sich bestehende Installationen und ein späterer Play-Store-Eintrag nicht mehr
aktualisieren. Die `.jks`-Datei ist über `android/.gitignore` vom Commit ausgeschlossen.

Nicht-geheime Build-Konfiguration: Die OAuth-Client-IDs (`OAUTH_CLIENT_ID_GOOGLE`, `OAUTH_CLIENT_ID_ONEDRIVE`,
`OAUTH_CLIENT_ID_DROPBOX`) kommen aus Umgebungsvariablen bzw. `android/local.properties` (Vorlage
`android/local.properties.example`), siehe [Entwicklung](entwicklung.md).

## Was Android vom Server nutzt (bleibt, wird nicht entfernt)

Alle diese Routen sind **geteilt** mit der Web-App; es gibt keine rein Android-spezifische Route.
Sie bleiben, weil die Web-App sie ohnehin braucht und sich Android sonst nicht ohne Rekonstruktion
wieder anschließen ließe:

- Auth: `POST /api/auth/login`, `POST /api/auth/login/verify` (2FA, #227), `POST /api/auth/register`,
  `GET /api/auth/me`, `POST /api/auth/refresh`
- Sync: `GET /api/sync`, `POST /api/sync`
- Fotos: `POST /api/photos`, `DELETE /api/photos/:filename`, `GET /api/photos/token` (Coil umgeht den
  Retrofit-Interceptor, daher die Query-Token-Variante, #297)
- Berichte: `POST /api/reports/send`, `GET|POST /api/reports/schedule`
- KI: `GET|POST /api/ai/settings`, `POST /api/ai/autofill`, `POST /api/ai/smart-cart`, `GET /api/ai/jobs/:id`

Android-spezifisches Verhalten, das Server und Clients beachten:

- **Refresh-Token im Body:** Android hat keinen Cookie-Jar. `POST /api/auth/refresh` akzeptiert deshalb weiterhin
  `refreshToken` im JSON-Body und liefert beide Tokens zurück; der Web-Cookie-Pfad (`nl_refresh`) liefert nur `{ token }` (#299).
- **AppAuth-Redirect:** liegt rein im Client — `nagellacke://oauth` (`RedirectUriReceiverActivity` in
  `android/app/src/main/AndroidManifest.xml`, `appAuthRedirectScheme` in `android/app/build.gradle.kts`).
  Der Server hat dafür keinen Endpunkt. Der OAuth-*Connect*-Flow (Google/Microsoft/Dropbox) war ohnehin nie fertig
  (`buildAuthIntent()` ohne Aufrufer, Buttons deaktiviert).
- **Cloud-Adapter** (Nextcloud, Google Drive, OneDrive, Dropbox) sprechen direkt mit den Anbietern, nicht über den Server.
- **Gemeinsamer Merge-Vertrag:** `fixtures/merge/*.json` wird von `v3/packages/core` *und* `android/.../MergeFixturesTest.kt`
  gelesen. Die Fixtures bleiben liegen; ohne laufenden Android-Job prüft nur noch die TypeScript-Seite. Nach Änderungen an
  `mergeData()` muss Android beim Wiedereinschalten gegen diese Fixtures neu verifiziert werden.
- **Web-Hinweise auf Android:** `docs/FEATURES.md` (`WEB-SET-10`, `WEB-SET-53`) und `docs/sync.md` erwähnen die Android-App.

## Play Store

Es ist **kein Store-Eintrag dokumentiert**: `docs/store-listing.md` ist ein Entwurf, in `RoadToDeploy.md` sind
Play-Entwicklerkonto, Screenshots und Einreichung nicht abgehakt, und es gibt nur das GitHub-Pre-Release
„Android v3.0.0 — Signed APK" (Tag `android-v3.0.0`). Die Play Console wurde im Zuge von #372 **nicht** angefasst. Falls dort
doch ein Eintrag angelegt wurde: nur unveröffentlichen, nicht löschen. Der lokale Branch `feat/play-store-prep`
(Store-Texte, Release-Infrastruktur; nicht auf `origin`) bleibt unberührt.

## Android wieder aufnehmen — Schritt für Schritt

1. **Ausgangsstand prüfen.** `git diff android-final..main -- android/` muss leer sein. Weiterarbeiten kann man von `main` aus.
2. **Server-Kompatibilität prüfen.** Seit `android-final` hat sich die Server-API weiterentwickelt (Web-only). Die Routen oben
   gegen `android/app/src/main/java/de/nagellacke/data/sync/*Api.kt` abgleichen, die `mergeData()`-Fixtures laufen lassen und die
   Android-Tests lokal (`cd android && ./gradlew testDebugUnitTest assembleDebug`) grün bekommen, bevor CI wieder eingeschaltet wird.
3. **CI-Job einschalten.** Repo-Variable setzen: Settings → Secrets and variables → Actions → Variables → `ANDROID_ENABLED` = `true`
   (oder `gh variable set ANDROID_ENABLED --body true`). Dann läuft `build-android` wieder bei jedem PR und Push.
   Alternativ die `if:`-Zeile am Job in `.github/workflows/ci.yml` entfernen und den Kommentar anpassen.
4. **Required Check prüfen.** `build-android` steht weiterhin im Ruleset „Required checks" (Quelle: GitHub Actions); ein
   übersprungener Job zählte bisher als bestanden, jetzt muss er real grün sein. Falls der Check irgendwann ausgetragen wurde:
   Settings → Rules → Rulesets → „Required checks" → Status check `build-android` (Integration „GitHub Actions") wieder
   hinzufügen. Zum Zeitpunkt des EOL waren dort erforderlich: `CodeQL`, `claude-review`, `build`, `build-android`
   (strict, Konversationsauflösung nötig).
5. **Release-Workflow reaktivieren.** In `.github/workflows/android-release.yml` den auskommentierten `push: tags: 'android-v*'`-Block
   wieder einkommentieren und den Kopfkommentar entfernen. Die vier Secrets (siehe oben) sind noch gesetzt; vor dem ersten Release
   prüfen, dass der lokale Keystore noch zu `KEYSTORE_BASE64` passt (`keytool -list -keystore …`).
6. **Dependabot.** Es gibt aktuell keine `.github/dependabot.yml`; GitHub erzeugt nur Security-Updates für Alerts. Für
   Gradle-Versions-Updates eine Datei anlegen bzw. ergänzen:

   ```yaml
   version: 2
   updates:
     - package-ecosystem: "gradle"
       directory: "/android"
       schedule:
         interval: "weekly"
   ```

   Falls Gradle-Alerts während des Einfrierens als „nicht genutzt" verworfen wurden, in den Dependabot-Alerts wieder öffnen.
7. **Dokumentation zurückdrehen.** README-Statuszeile, `CLAUDE.md` („Android: frozen"), den `AI_DEVELOPMENT.md`-Hinweis und
   das Changelog aktualisieren; das Label `area/android` wird wieder normal verwendet.
8. **Issues.** Die in #372 geschlossenen Android-Issues tragen `status/wontfix` und bleiben als Analyse erhalten; bei Bedarf einzeln
   wieder öffnen und das Label entfernen.

### Toolchain-Hinweise

- **JDK 17+** nötig. Auf dem Entwicklungsrechner ist der Standard-`java` nur 1.8; Android Studio bringt ein JBR (JDK 21) mit:
  `JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"` vor jedem `./gradlew` setzen. CI nutzt Temurin 17.
- **Android SDK** unter `%LOCALAPPDATA%\Android\Sdk` (inkl. `cmdline-tools/latest`), Emulator-AVD `nagellacke_test`
  (Pixel 6, API 34, `google_apis;x86_64`).
- **OneDrive und Gradle:** Das Repo liegt in einem OneDrive-Ordner; dessen Dateisperren lassen Gradle-Tasks (z. B. `dexBuilder`)
  zufällig mit `AccessDeniedException` scheitern. Abhilfe: `buildDir` per externem Init-Script (nicht im Repo) außerhalb von OneDrive
  legen, z. B. `allprojects { buildDir = file("C:/gradle-builds/nagellacke-android/${project.name}") }`, aufgerufen mit `--init-script`.
- **Tests:** reine JVM-Unit-Tests (`./gradlew testDebugUnitTest`); ein `androidTest`-Sourceset gibt es bewusst nicht. Debug-Builds
  brauchen weder Signing-Secrets noch OAuth-IDs.
