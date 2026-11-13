# A minified instrumentation APK shares the target APK's runtime dependencies.
# R8 cannot see the runner's callers while optimizing the target APK: preserve
# their public ABI for testVariant=release. Normal published APKs omit this file.
-keep class kotlin.** { *; }
-keep class androidx.tracing.** { *; }
