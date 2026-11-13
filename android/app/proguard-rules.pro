# Keep the JavaScript bridge methods callable from the WebView.
-keepclassmembers class tv.lumen.app.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# SWIG JNI resolves these class and method names from the native library.
-keep class com.frostwire.jlibtorrent.** { *; }

# Public entry points exercised by instrumentation against the minified APK.
-keep class tv.lumen.app.MainActivity { public *; protected void onActivityResult(int, int, android.content.Intent); }
-keep class tv.lumen.app.TorrentEngine { public *; }
-keep class tv.lumen.app.TorrentRuntime { public *; }
