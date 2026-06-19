# Road to Deploy: Google Play Store Feasibility Study

## Executive Summary

Yes — publishing the Nagellacke Android app on the Google Play Store is **entirely feasible**. The app is built with modern, production-quality Android architecture (Jetpack Compose, Room, Hilt, WorkManager) and already targets the correct SDK versions. The main blockers are administrative and configuration steps, not architectural ones. Total estimated effort is **2–5 days** spread across setup, store preparation, and Google's review process.

---

## 1. Is It Possible?

**Yes.** The app meets all technical baseline requirements for Play Store distribution:

| Requirement | Status |
|---|---|
| Target API ≥ 34 (Android 14) | ✅ targetSdk = 35 |
| 64-bit support | ✅ Kotlin/JVM, Compose |
| Valid `applicationId` | ✅ `de.nagellacke.app` |
| Single APK / AAB capable | ✅ Standard Gradle build |
| No prohibited APIs | ✅ Only INTERNET + CAMERA |
| Backup rules declared | ✅ `data_extraction_rules.xml` / `backup_rules.xml` |

---

## 2. What Is Required

### 2.1 Google Play Developer Account

- **What:** A Google account enrolled as a Play developer.
- **Cost:** One-time $25 USD registration fee.
- **Time:** Account approval typically takes a few hours to 1 business day.
- **Link:** [play.google.com/apps/publish/signup](https://play.google.com/apps/publish/signup)

### 2.2 App Signing (Keystore)

This is the most critical technical step. `android/app/build.gradle.kts` now contains a signing configuration block, but it is **env-var-gated** — the release build remains unsigned until you provide `KEYSTORE_FILE`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, and `KEY_PASSWORD` as environment variables.

**What to do:**

1. Generate a release keystore (one-time):
   ```sh
   keytool -genkey -v -keystore nagellacke-release.jks \
     -keyalg RSA -keysize 2048 -validity 10000 \
     -alias nagellacke
   ```

2. Add a `signingConfigs` block to `app/build.gradle.kts`:
   ```kotlin
   signingConfigs {
       create("release") {
           storeFile = file("nagellacke-release.jks")
           storePassword = System.getenv("KEYSTORE_PASSWORD")
           keyAlias = "nagellacke"
           keyPassword = System.getenv("KEY_PASSWORD")
       }
   }
   ```

3. Reference it in the `release` build type:
   ```kotlin
   buildTypes {
       release {
           signingConfig = signingConfigs.getByName("release")
           // ... existing config
       }
   }
   ```

> **Important:** Store the keystore file securely and back it up. If you lose it, you can never update the app on Play Store under the same listing. Google Play App Signing (see section 4) mitigates this risk.

**Recommendation:** Enable **Google Play App Signing**. You upload an encrypted upload key; Google holds the final distribution key. This protects you if the upload key is ever lost.

### 2.3 Build an Android App Bundle (AAB)

Google Play requires the AAB format (`.aab`), not APK, for new apps.

```sh
cd android
./gradlew bundleRelease
# Output: app/build/outputs/bundle/release/app-release.aab
```

### 2.4 Store Listing Assets

All of these must be created before submission:

| Asset | Specification | Notes |
|---|---|---|
| App icon | 512×512 px PNG, no alpha | High-res version of existing mipmap icon |
| Feature graphic | 1024×500 px PNG/JPG | Decorative banner shown on store page |
| Screenshots (phone) | At least 2, up to 8; min 320px, max 3840px | Show main screens: Collection, Diary, Stats |
| Short description | Max 80 characters | One-line summary |
| Full description | Max 4000 characters | Full feature description |
| App title | Max 30 characters | e.g., "Nagellacke — Lackverwaltung" |

### 2.5 Privacy Policy

**Required** — the app requests the CAMERA permission and handles personal data (nail polish collections, photos, sync credentials). Google rejects apps that request sensitive permissions without a privacy policy.

The privacy policy must:
- Be hosted at a stable public URL (e.g., a GitHub Pages page, or a simple HTML file on your server)
- State what data is collected, how it is used, and how users can delete their data
- Cover: camera usage, photos stored locally and on sync providers (Nextcloud, Dropbox, Google Drive, OneDrive, custom server)

### 2.6 Data Safety Form

In the Play Console, you must fill out the **Data Safety** section, declaring:

| Data Type | Collected? | Notes |
|---|---|---|
| Photos / videos | Yes | User photos of manicures |
| App activity | No | No analytics |
| Credentials | Yes (encrypted) | OAuth tokens, server credentials stored via `androidx.security.crypto` |
| Location | No | |

The app uses `androidx.security.crypto` for secure credential storage — this is good and should be mentioned.

### 2.7 Content Rating Questionnaire

Fill out the IARC content rating form in the Play Console. Given the app's content (nail polish tracking, photos), the expected rating is **Everyone / PEGI 3**.

---

## 3. Effort Estimate

| Task | Estimated Effort |
|---|---|
| Create Google Play developer account | 30 min |
| Generate keystore and configure signing | 1–2 hours |
| Build and test signed AAB | 1 hour |
| Create store listing assets (screenshots, icon, graphics) | 4–8 hours |
| Write privacy policy and host it | 1–2 hours |
| Fill out Play Console forms (data safety, content rating, store listing) | 2–3 hours |
| First submission and waiting for review | 1–3 business days |
| Address any review rejections | 0–4 hours |
| **Total active work** | **~1–2 days** |
| **Total calendar time (incl. review)** | **~5–7 days** |

---

## 4. Important Considerations

### 4.1 Google Drive OAuth App Verification

The app includes `GoogleDriveAdapter.kt` for Google Drive sync. If users can authenticate with Google through the app, **Google requires OAuth app verification** before the app can be used by more than 100 test users.

- **Process:** Submit the OAuth client to Google's verification program, including a privacy policy, demo video, and domain verification.
- **Time:** Can take **2–6 weeks**.
- **Workaround:** The sync feature can be launched without Google Drive support initially. Nextcloud, Dropbox, OneDrive, and the custom server adapter can all work without Google's OAuth review.

### 4.2 Self-Hosted Server Sync

The "Server" sync adapter connects to the user's own self-hosted Nagellacke backend. This is **not a problem** for Play Store approval — many apps connect to user-configured endpoints. Just ensure the UI makes it clear that users provide their own server.

### 4.3 Personal App vs. Public Distribution

Currently this is a personal/self-hosted app. Publishing to Play Store means:
- **Public listing**: Anyone can find and install the app (unless you use internal testing or closed testing tracks).
- **Account requirements**: Users need a Google account to download from Play Store.
- **Alternatives:** Consider using the **Internal Testing** or **Closed Testing** track initially to distribute only to specific people (e.g., personal use + friends), which has a faster review process and fewer requirements.

### 4.4 Version Management

- Current `versionCode = 1`, `versionName = "3.0.0"`.
- Every update pushed to Play Store must increment `versionCode`. Plan a versioning strategy (e.g., `versionCode` auto-incremented by CI, `versionName` following semantic versioning).
- Once an AAB with a given `versionCode` is uploaded, that number can never be reused.

### 4.5 App Icon Quality

The existing mipmap icons should be reviewed. Play Store requires a 512×512 px high-resolution icon. The `mipmap-anydpi-v26/` directory uses adaptive icon XML — verify the resulting icon looks good at large sizes and against different backgrounds (Play Store renders adaptive icons in various shapes).

### 4.6 ProGuard / R8

Minification and resource shrinking are already enabled for release builds (`isMinifyEnabled = true`, `isShrinkResources = true`). The `proguard-rules.pro` file already keeps critical classes for serialization, AppAuth, OkHttp, and Hilt. **Test the release build thoroughly** after enabling signing — R8 can sometimes strip classes that are only referenced via reflection.

### 4.7 Camera Permission Justification

The `CAMERA` permission is marked as "sensitive" by Google. In the Play Console, you must provide a **permission declaration** explaining why the app needs it (for taking photos of nail polish / manicures). This is straightforward to justify but must be completed.

### 4.8 No CI/CD for Android Releases

Currently, there is no GitHub Actions workflow for building or releasing the Android app. For a sustainable release process, consider adding:
- A workflow to build and sign the AAB on tagged releases
- Secrets in GitHub for keystore credentials (`KEYSTORE_PASSWORD`, `KEY_PASSWORD`, the keystore file as a base64 secret)
- Optional: automated upload to Play Store via the [Google Play GitHub Action](https://github.com/r0adkll/upload-google-play)

---

## 5. Technical Readiness Assessment

The app's architecture and code quality are **production-ready**:

- Modern stack: Jetpack Compose, Material3, Room, Hilt, WorkManager, Retrofit, Coil
- Proper separation of concerns (UI / Domain / Data layers)
- Secure credential storage via `androidx.security.crypto`
- ProGuard configured for release
- Background sync via WorkManager (battery-efficient)
- OAuth support via AppAuth library
- Backup rules declared

**Gaps to fill before Play Store submission:**

- [x] Add release signing configuration to `build.gradle.kts` (env-var-gated; unsigned without `KEYSTORE_FILE`)
- [ ] Create and safeguard a release keystore (`keytool -genkey …`) and set `KEYSTORE_FILE` / `KEYSTORE_PASSWORD` / `KEY_PASSWORD`
- [ ] Produce a signed AAB and smoke-test it on a real device (`./gradlew bundleRelease`)
- [x] Write a privacy policy — drafted at `docs/privacy-policy.html` (needs hosting, e.g. GitHub Pages)
- [ ] Create store listing assets (screenshots, feature graphic, high-res icon)
- [ ] Decide on Google Drive OAuth strategy (include or defer)

---

## 6. Recommended Next Steps

- [ ] **Create Google Play developer account** ($25, one-time)
- [ ] **Generate release keystore** and store it securely (password manager + encrypted backup)
- [x] **Configure signing** in `build.gradle.kts` (env-var-gated — no-op without `KEYSTORE_FILE`)
- [ ] **Build signed AAB**: set env vars, then `./gradlew bundleRelease`
- [ ] **Test the release build** on a physical device or emulator
- [x] **Write a privacy policy** — drafted at `docs/privacy-policy.html` (needs hosting at a stable URL)
- [ ] **Take screenshots** of the main app screens on a phone
- [ ] **Create/export the store icon** at 512×512 from the existing adaptive icon
- [ ] **Open a Closed Testing track** in Play Console to start with a limited audience
- [ ] **Submit and address review feedback**
- [x] **(Optional)** Add Android release CI/CD to GitHub Actions — workflow at `.github/workflows/android-release.yml`, triggers on `android-v*` tags or manual dispatch; signing activates automatically when `KEYSTORE_BASE64` / `KEYSTORE_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD` secrets are set in the repo
- [ ] **(Optional, later)** Apply for Google OAuth verification to enable Google Drive sync

---

## Summary

| Question | Answer |
|---|---|
| **Is it possible?** | Yes — the app is technically ready |
| **Main blockers?** | Signing setup, privacy policy, store assets |
| **Effort?** | ~1–2 days of active work + 1–3 days review wait |
| **Biggest risk?** | Google Drive OAuth verification (2–6 weeks) — can be deferred |
| **Recommended first step?** | Create developer account + set up signing |
