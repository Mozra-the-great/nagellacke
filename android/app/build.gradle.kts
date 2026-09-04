import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

// Set KEYSTORE_FILE env var to the absolute path of the .jks file to enable release signing.
// Without it the release build is produced unsigned (safe for local development / CI without secrets).
val keystoreFilePath: String? = System.getenv("KEYSTORE_FILE")

// OAuth client IDs for the cloud-sync providers. These are per-installation values:
// anyone self-hosting this app registers their own OAuth clients in the Google /
// Microsoft / Dropbox developer consoles. They used to be hardcoded placeholder
// strings in OAuthHelper.kt ("YOUR_GOOGLE_CLIENT_ID...") that were passed straight
// into real OAuth requests (#271), with nothing anywhere saying they had to be
// replaced. They are now supplied the same way the signing config is: an environment
// variable, falling back to local.properties (gitignored), falling back to empty.
//
// Empty is a deliberate default rather than a placeholder: "" is unambiguously
// "not configured", which OAuthClientIds.isConfigured() can test for, while a
// placeholder string is indistinguishable from a real - and merely wrong - id.
// NB: `Properties` has to be imported at the top of the file rather than written as
// java.util.Properties here - Gradle's own `java` project extension shadows the package
// name inside the script body.
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { stream -> load(stream) }
}

// System.getenv returns a platform type, so an elvis chain on it trips
// "always returns the left operand of non-nullable type" - which the Kotlin DSL script
// compiler reports as an error, not a warning. isNullOrBlank() sidesteps that and also
// treats an empty env var as unset, which is what a caller means by it.
fun oauthClientId(key: String): String {
    val fromEnv: String? = System.getenv(key)
    if (!fromEnv.isNullOrBlank()) return fromEnv
    return localProperties.getProperty(key) ?: ""
}

android {
    namespace = "de.nagellacke"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.nagellacke.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "3.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        manifestPlaceholders["appAuthRedirectScheme"] = "nagellacke"

        buildConfigField("String", "OAUTH_CLIENT_ID_GOOGLE", "\"${oauthClientId("OAUTH_CLIENT_ID_GOOGLE")}\"")
        buildConfigField("String", "OAUTH_CLIENT_ID_MICROSOFT", "\"${oauthClientId("OAUTH_CLIENT_ID_MICROSOFT")}\"")
        buildConfigField("String", "OAUTH_CLIENT_ID_DROPBOX", "\"${oauthClientId("OAUTH_CLIENT_ID_DROPBOX")}\"")
    }

    signingConfigs {
        if (keystoreFilePath != null) {
            create("release") {
                storeFile = file(keystoreFilePath)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS") ?: "nagellacke"
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // null when KEYSTORE_FILE is absent → unsigned build (cannot be distributed)
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.splashscreen)
    implementation(libs.androidx.navigation.compose)

    // Compose BOM
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Room
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    // WorkManager
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)

    // Security
    implementation(libs.androidx.security.crypto)

    // Hilt
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    // Network
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)

    // Image
    implementation(libs.coil.compose)

    // OAuth
    implementation(libs.appauth)

    // Tests
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test)
    androidTestImplementation(libs.androidx.room.testing)
    androidTestImplementation(libs.kotlinx.coroutines.test)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}

// The shared merge fixtures live at the repository root, outside both the Gradle build and
// the npm workspace, because neither implementation of mergeData() owns them — see
// fixtures/merge/README.md. Hand the tests an absolute path rather than letting them guess
// one from the working directory, which differs between Gradle and an IDE run.
tasks.withType<Test>().configureEach {
    systemProperty("nagellacke.fixtures.dir", rootProject.file("../fixtures").absolutePath)
}
