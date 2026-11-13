# Keep the JavaScript bridge methods callable from the WebView.
-keepclassmembers class tv.lumen.app.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# SWIG JNI resolves these class and method names from the native library.
-keep class com.frostwire.jlibtorrent.** { *; }
