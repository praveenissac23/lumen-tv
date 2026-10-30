# Keep the JavaScript bridge methods callable from the WebView.
-keepclassmembers class tv.lumen.app.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
