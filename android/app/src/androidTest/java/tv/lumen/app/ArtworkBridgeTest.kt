package tv.lumen.app

import android.content.ContextWrapper
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class ArtworkBridgeTest {
    @Test fun jpegArtworkReachesRealWebViewAndBadCacheRecovers() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val server = ServerSocket(0)
        val requests = AtomicInteger()
        val bitmap = Bitmap.createBitmap(16, 24, Bitmap.Config.ARGB_8888).apply { eraseColor(0xff4169a1.toInt()) }
        val png = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        bitmap.recycle()
        val serving = Thread {
            while (!server.isClosed) {
                try { server.accept().use { socket ->
                    socket.soTimeout = 5000
                    val reader = socket.getInputStream().bufferedReader()
                    val path = reader.readLine()?.split(" ")?.getOrNull(1) ?: "/"
                    while (!reader.readLine().isNullOrEmpty()) { }
                    val output = socket.getOutputStream()
                    when (path) {
                        "/redirect" -> output.write("HTTP/1.1 302 Found\r\nLocation: /image\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                        "/image" -> {
                            requests.incrementAndGet()
                            output.write("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: ${png.size}\r\nConnection: close\r\n\r\n".toByteArray())
                            output.write(png)
                        }
                        else -> output.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                    }
                    output.flush()
                } } catch (e: Exception) { if (!server.isClosed) throw e }
            }
        }.apply { isDaemon = true; start() }
        val base = "http://127.0.0.1:${server.localPort}"
        val cache = File(context.cacheDir, "artwork-test-${System.nanoTime()}").apply { mkdirs() }
        var activity: MainActivity? = null
        try {
            val isolated = object : ContextWrapper(context) { override fun getCacheDir() = cache }
            val first = Thumbs(isolated).serve("$base/image", 320).data.use { it.readBytes() }
            assertNotNull(BitmapFactory.decodeByteArray(first, 0, first.size))
            cache.walkTopDown().first { it.extension == "jpg" }.writeBytes(byteArrayOf(0, 1, 2))
            val repaired = Thumbs(isolated).serve("$base/image", 320).data.use { it.readBytes() }
            assertNotNull(BitmapFactory.decodeByteArray(repaired, 0, repaired.size))
            assertTrue("Corrupt disk cache must refetch", requests.get() >= 2)
            val launched = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            activity = launched
            val bundle = instrumentation.context.assets.open("artwork-ui.js").bufferedReader().use { it.readText() }
            val html = "<!doctype html><meta charset='utf-8'><style>img{max-width:100%;max-height:200px}</style><body><script>window.__imageBase=${JSONObject.quote(base)};</script><script>$bundle</script>"
            instrumentation.runOnMainSync { launched.webView.loadDataWithBaseURL("file:///android_asset/web/", html, "text/html", "utf-8", null) }
            val deadline = System.currentTimeMillis() + 45000
            var last = ""
            while (System.currentTimeMillis() < deadline) {
                val ready = CountDownLatch(1)
                instrumentation.runOnMainSync { launched.webView.evaluateJavascript("window.__imageResult ? JSON.stringify(__imageResult()) : ''") { last = it; ready.countDown() } }
                assertTrue(ready.await(5, TimeUnit.SECONDS))
                val decoded = org.json.JSONTokener(last).nextValue() as? String
                if (!decoded.isNullOrEmpty()) {
                    val result = JSONObject(decoded)
                    if (result.optBoolean("loaded") && result.optBoolean("native") && result.optBoolean("missing")) return
                }
                Thread.sleep(100)
            }
            fail("Native JPEGs must decode in Android WebView; missing artwork must retain title. Last state: $last")
        } finally {
            activity?.let { a -> instrumentation.runOnMainSync { a.finish() } }
            cache.deleteRecursively(); server.close(); serving.join(1000)
        }
    }
}
