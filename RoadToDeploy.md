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
- [x] Write a privacy policy — drafted at `docs/privacy-policy.html`, GitHub Pages workflow added (enable Pages in repo Settings to go live)
- [x] Draft store listing texts (title, short description, full description, camera declaration) — see `docs/store-listing.md`
- [ ] Create store listing assets (screenshots, feature graphic, high-res icon)
- [ ] Decide on Google Drive OAuth strategy (include or defer)

---

## 6. Recommended Next Steps

- [ ] **Create Google Play developer account** ($25, one-time)
- [ ] **Generate release keystore** and store it securely (password manager + encrypted backup)
- [x] **Configure signing** in `build.gradle.kts` (env-var-gated — no-op without `KEYSTORE_FILE`)
- [ ] **Build signed AAB**: set env vars, then `./gradlew bundleRelease`
- [ ] **Test the release build** on a physical device or emulator
- [x] **Write a privacy policy** — `docs/privacy-policy.html`; GitHub Pages workflow ready (`.github/workflows/pages.yml`), one switch in repo Settings to go live
- [x] **Draft store listing texts** — `docs/store-listing.md` (title, short/full description, camera declaration, category)
- [ ] **Take screenshots** of the main app screens on a phone
- [ ] **Create/export the store icon** at 512×512 from the existing adaptive icon
- [ ] **Open a Closed Testing track** in Play Console to start with a limited audience
- [ ] **Submit and address review feedback**
- [x] **(Optional)** Add Android release CI/CD to GitHub Actions — `.github/workflows/android-release.yml`, triggers on `android-v*` tags or manual dispatch; signing activates when secrets are set
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

---

## 7. Step-by-Step Manual Instructions

This section covers every remaining manual task in exact detail.
Work through them top-to-bottom; each step depends on the previous one being complete.

---

### Step A — Create a Google Play Developer Account

1. Open [play.google.com/apps/publish/signup](https://play.google.com/apps/publish/signup) in a browser.
2. Sign in with the Google account you want to use as the developer account.
   - Use a dedicated Google account (e.g. `nagellacke.dev@gmail.com`) rather than your personal one — you cannot transfer an app to a different developer account later.
3. Pay the one-time **$25 USD** registration fee with a credit or debit card.
4. Fill in the developer profile:
   - **Developer name**: This appears publicly on the Play Store page, e.g. `Moritz Schran` or a studio name.
   - **Contact email**: Must be a valid address Google can reach you at (not necessarily the account email).
5. Accept the Developer Distribution Agreement.
6. Wait for account approval — usually a few hours, up to 1 business day.

---

### Step B — Generate and Secure the Release Keystore

> **Critical**: The keystore is tied to your app listing forever. Losing it means you can never update the app on Play Store. Back it up in at least two places.

#### B.1 Generate the keystore

Open a terminal with Java / the `keytool` binary available (Android Studio ships it under `<sdk>/jdk/bin/keytool`):

```sh
keytool -genkey -v \
  -keystore nagellacke-release.jks \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -alias nagellacke
```

When prompted:
| Field | Value |
|---|---|
| Keystore password | Choose a strong password, save it in your password manager |
| Key password | Can be the same as keystore password, or different |
| First and Last Name | Your name (appears in the cert, not public) |
| Organizational Unit | Can leave blank |
| Organization | Can leave blank |
| City / State / Country | Fill in as appropriate |

The command creates `nagellacke-release.jks` in the current directory.

#### B.2 Verify the keystore

```sh
keytool -list -v -keystore nagellacke-release.jks -alias nagellacke
```

Check that the alias `nagellacke` appears and `Valid from` spans 10000 days (~27 years).

#### B.3 Back up the keystore

Store the keystore in **all three** of these places:
1. **Password manager** (e.g. Bitwarden, 1Password) — attach the `.jks` file to a secure note alongside both passwords (keystore + key).
2. **Encrypted cloud storage** — upload to an encrypted folder or a private file in Nextcloud/Google Drive.
3. **Local backup** — copy to an external drive or USB stick kept offline.

Do **not** commit the `.jks` file to git (already gitignored by `android/.gitignore`).

---

### Step C — Add Secrets to GitHub Repository

These secrets are read by the GitHub Actions workflow (`.github/workflows/android-release.yml`) to sign the AAB in CI.

1. Go to `https://github.com/Mozra-the-great/nagellacke/settings/secrets/actions`.
2. Click **New repository secret** for each of the four secrets below.

#### C.1 Encode the keystore as base64

```sh
# macOS / Linux
base64 -i nagellacke-release.jks | tr -d '\n'

# Windows (PowerShell)
[Convert]::ToBase64String([IO.File]::ReadAllBytes("nagellacke-release.jks"))
```

Copy the output — it is the value for `KEYSTORE_BASE64`.

#### C.2 Create the four secrets

| Secret name | Value |
|---|---|
| `KEYSTORE_BASE64` | Base64-encoded content of `nagellacke-release.jks` |
| `KEYSTORE_PASSWORD` | The keystore password you set in Step B.1 |
| `KEY_ALIAS` | `nagellacke` |
| `KEY_PASSWORD` | The key password you set in Step B.1 |

After adding all four, the CI workflow will automatically sign the AAB on the next `android-v*` tag push.

---

### Step D — Enable GitHub Pages (Privacy Policy Hosting)

The privacy policy must be reachable at a stable public URL before you submit to Play Store.

1. Go to `https://github.com/Mozra-the-great/nagellacke/settings/pages`.
2. Under **Source**, select **GitHub Actions** (not "Deploy from branch").
3. Click **Save**.
4. Merge this PR into `main`. The `pages.yml` workflow will trigger automatically and deploy `docs/`.
5. After the workflow succeeds (check the **Actions** tab), the site will be live at:
   ```
   https://mozra-the-great.github.io/nagellacke/
   ```
6. Verify that `https://mozra-the-great.github.io/nagellacke/privacy-policy.html` loads correctly.
7. Update `docs/store-listing.md` → replace the placeholder URL with the live URL.

> Note: It may take a few minutes for the DNS to propagate after the first deployment.

---

### Step E — Build and Test a Signed AAB Locally

After completing Steps B and C, you can build a signed AAB on your local machine to verify everything works before submitting.

#### E.1 Set environment variables

```sh
# macOS / Linux (bash/zsh)
export KEYSTORE_FILE=/absolute/path/to/nagellacke-release.jks
export KEYSTORE_PASSWORD=your-keystore-password
export KEY_ALIAS=nagellacke
export KEY_PASSWORD=your-key-password

# Windows (PowerShell)
$env:KEYSTORE_FILE = "C:\path\to\nagellacke-release.jks"
$env:KEYSTORE_PASSWORD = "your-keystore-password"
$env:KEY_ALIAS = "nagellacke"
$env:KEY_PASSWORD = "your-key-password"
```

#### E.2 Build the AAB

```sh
cd android
./gradlew bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

#### E.3 Verify the signature

```sh
# Using bundletool (download from https://github.com/google/bundletool/releases)
java -jar bundletool.jar validate --bundle=app/build/outputs/bundle/release/app-release.aab
```

Or simply check that the build succeeded without the "APK is not signed" warning that appears for unsigned builds.

#### E.4 Test on a physical device or emulator

The Play Store accepts only AABs, but for local testing you need an APK.

```sh
# Build a signed APK for sideloading
./gradlew assembleRelease
# Output: app/build/outputs/apk/release/app-release.apk

# Install on connected device
adb install -r app/build/outputs/apk/release/app-release.apk
```

**What to test on the release build:**
- [ ] App launches without crash
- [ ] Login / sync credentials can be entered and saved
- [ ] Nail polish entry can be created with a photo (camera permission prompt appears)
- [ ] Photos load correctly (Coil + R8 don't strip image decoders)
- [ ] Background sync triggers (WorkManager)
- [ ] All main screens navigate correctly (Compose Navigation)

---

### Step F — Create Store Listing Assets

These cannot be generated from code; they require design work.

#### F.1 High-resolution app icon (512 × 512 px PNG, no alpha)

**Option A — Export from Android Studio:**
1. Open the project in Android Studio.
2. In the Project view, right-click `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`.
3. Select **Show in Explorer / Finder** to see the adaptive icon layers.
4. Use the Vector Asset Studio or export the foreground + background as a 512×512 PNG.

**Option B — Use a tool like Figma or Inkscape:**
1. Recreate the icon at 512×512 using the existing icon assets.
2. Export as PNG — no transparency (alpha channel must be off).
3. Test how it looks in Play Store's adaptive icon frame simulator at [romannurik.github.io/AndroidAssetStudio/icons-launcher](https://romannurik.github.io/AndroidAssetStudio/icons-launcher.html).

#### F.2 Feature graphic (1024 × 500 px PNG or JPG)

This is the banner shown at the top of the store listing. It does not appear on the device — it is purely decorative.

Suggested content: App name "Nagellacke" on a nail-polish-themed background (e.g. a photo of colourful nail polish bottles, or a clean gradient in the app's colour palette). No text other than the app name is required.

Tools: Canva (free), Figma, GIMP, or Photoshop.
Export at exactly 1024 × 500 px.

#### F.3 Screenshots (phone)

Minimum 2, maximum 8 screenshots. Recommended: 4–6 covering the main flows.

| Screen | What to show |
|---|---|
| Screenshot 1 | Nail polish collection overview (list or grid) |
| Screenshot 2 | Detail view of a single nail polish entry |
| Screenshot 3 | Diary / history screen |
| Screenshot 4 | Statistics screen |
| Screenshot 5 | Add / edit entry form |
| Screenshot 6 | Sync settings screen |

**How to take screenshots:**
1. Install the release APK on your phone (see Step E.4).
2. Navigate to each screen and press Volume Down + Power (or use `adb shell screencap`).
3. Transfer screenshots to your computer.

**Minimum size:** 320 px on the shortest side. **Maximum size:** 3840 px on the longest side.
Recommended: use the native phone resolution — no need to resize.

**Tip:** Portrait screenshots (the phone's natural orientation) look best in the Play Store.

---

### Step G — Create the App Listing in Play Console

1. Go to [play.google.com/console](https://play.google.com/console) and sign in.
2. Click **Create app** (top right).
3. Fill in the initial form:
   - **App name**: `Nagellacke — Lackverwaltung` (copy from `docs/store-listing.md`)
   - **Default language**: `German – de`
   - **App or game**: App
   - **Free or paid**: Free
   - Check both declarations and click **Create app**.

#### G.1 Store listing (Main store listing tab)

Navigate to **Grow → Store presence → Main store listing**.

| Field | Value |
|---|---|
| App name | `Nagellacke — Lackverwaltung` |
| Short description | Copy from `docs/store-listing.md` |
| Full description | Copy from `docs/store-listing.md` |
| App icon | Upload the 512×512 PNG from Step F.1 |
| Feature graphic | Upload the 1024×500 image from Step F.2 |
| Phone screenshots | Upload 4–6 screenshots from Step F.3 |

Click **Save**.

#### G.2 App content — Privacy policy

Navigate to **Policy → App content → Privacy policy**.

- Enter the URL: `https://mozra-the-great.github.io/nagellacke/privacy-policy.html`
- Click **Save**.

#### G.3 App content — Data safety

Navigate to **Policy → App content → Data safety**.

Fill in the questionnaire:

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes |
| Do you provide a way for users to request that their data is deleted? | Yes (uninstall / "clear data" in Android settings) |

**Data types to declare:**

| Category | Data type | Collected | Shared | Optional / Required |
|---|---|---|---|---|
| Photos and videos | Photos | Yes | No | Optional (only if user takes photo) |
| App activity | (none) | No | — | — |
| Personal info | (none) | No | — | — |
| Financial info | (none) | No | — | — |
| App info and performance | Crash logs | No | — | — |
| Device or other IDs | (none) | No | — | — |

For the **Credentials** row: OAuth tokens and server credentials are stored **on-device only** (via `EncryptedSharedPreferences`) and are not transmitted to any party other than the sync provider the user explicitly configures.

Click **Save** → **Submit**.

#### G.4 App content — Content rating

Navigate to **Policy → App content → Content rating**.

1. Click **Start questionnaire**.
2. Enter your contact email.
3. Category: **Utility**.
4. Answer all questions — for this app all sensitive content questions are "No":
   - Violence: No
   - Sexual content: No
   - Profanity: No
   - Controlled substances: No
   - In-app purchases: No
   - Location sharing: No
5. Click **Next** → **Submit** → **Apply rating**.

Expected result: **Everyone / PEGI 3**.

#### G.5 Declarations — Permissions

Navigate to **Policy → App content → Permissions**.

Under **Camera**, enter the declaration:
> "Die Kamera-Berechtigung wird ausschließlich genutzt, um Fotos von Nagellacken und Maniküren direkt in der App aufzunehmen. Es werden keine Bilder ohne Nutzerzustimmung gespeichert oder übertragen."

Click **Save**.

---

### Step H — Upload the AAB and Submit for Review

#### H.1 Create a Closed Testing release (recommended first step)

Closed Testing lets you distribute to a specific list of testers before going public.
The review process is faster and requirements are lighter.

1. Navigate to **Test → Closed testing → Create track**.
2. Name the track `alpha` or `beta`.
3. Click **Create new release**.
4. Upload `app/build/outputs/bundle/release/app-release.aab` (from Step E.2).
5. **Release name**: `3.0.0` (or autofill).
6. **Release notes** (What's new): Write a short text, e.g.:
   ```
   Erste Version der Nagellacke-App im Play Store.
   ```
7. Click **Save** → **Review release** → **Start rollout to Closed testing**.

#### H.2 Add yourself as a tester

1. Under the track, go to **Testers**.
2. Create a tester list and add your own Google account email.
3. Share the opt-in URL with anyone else you want to test with.

#### H.3 Promote to Production (when ready)

After testing is complete:
1. Navigate to **Release → Production → Create new release**.
2. Promote the AAB from the Closed testing track.
3. Set rollout percentage to **100%** (or start at 20% for a staged rollout).
4. Click **Send for review**.

Google reviews new apps within **1–3 business days**. You will receive an email when the review is complete.

---

### Step I — Version Management Going Forward

Every update to the Play Store requires a higher `versionCode`. The current value is `versionCode = 1`.

**Convention:**
- Increment `versionCode` by 1 for every Play Store release (e.g. 1, 2, 3, …).
- Set `versionName` to the semantic version string (e.g. `"3.1.0"`).
- Once an `android-v*` tag is pushed to GitHub, the CI workflow builds the signed AAB automatically.

**Workflow for a new Android release:**
```sh
# 1. Update versionCode and versionName in android/app/build.gradle.kts
# 2. Commit the change
git add android/app/build.gradle.kts
git commit -m "chore(android): bump version to 3.1.0 (versionCode 2)"

# 3. Tag the release — this triggers the android-release.yml workflow
git tag android-v3.1.0
git push && git push --tags

# 4. Download the signed AAB from the GitHub Actions artifacts
# 5. Upload it to Play Console (Step H above)
```

---

### Step J — (Optional, Later) Google Drive OAuth Verification

This step is only needed if you want to allow more than 100 users to use the Google Drive sync feature.

**What is needed:**
1. A verified domain (e.g. `nagellacke.de` or the GitHub Pages URL).
2. A demo video showing the Google Drive OAuth flow in the app.
3. A detailed justification of why each OAuth scope is needed.
4. Submit the OAuth app for verification at [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → OAuth consent screen → **Publish app** → **Prepare for verification**.

**Timeline:** The verification process takes 2–6 weeks.

**Interim strategy:** Launch with Google Drive support disabled or hidden behind a warning that only 100 test users can use it. Nextcloud, Dropbox, OneDrive, and the custom server adapter work without any Google verification.
