-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable

# App data + sync models (kotlinx.serialization targets)
-keep class de.nagellacke.data.sync.** { *; }
-keep class de.nagellacke.domain.model.** { *; }

# kotlinx.serialization
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class de.nagellacke.**$$serializer { *; }
-keepclassmembers class de.nagellacke.** {
    *** Companion;
}
-keepclasseswithmembers class de.nagellacke.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase

# AppAuth
-dontwarn net.openid.appauth.**

# Hilt / Dagger (generated code)
-dontwarn dagger.hilt.**
-keep class dagger.hilt.** { *; }
-keep class javax.inject.** { *; }
-keep class * extends dagger.hilt.android.internal.managers.ViewComponentManager$FragmentContextWrapper { *; }

# Google Tink (androidx.security.crypto / EncryptedSharedPreferences) references
# error-prone annotations that are compile-time only and absent at runtime.
-dontwarn com.google.errorprone.annotations.**
