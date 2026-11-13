# Error Prone's compile-only annotation signature mentions this javac enum.
# Android does not provide javac's model API; it is never used by the playback tests.
# This suppression applies to instrumentation only, never the app APK.
-dontwarn javax.lang.model.element.Modifier
