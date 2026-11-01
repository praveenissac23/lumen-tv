package tv.lumen.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.Semaphore

/**
 * Serves channel logos and posters to the interface as small JPEGs.
 * Providers often ship 2000-pixel posters; decoding dozens of those at once is what
 * runs a TV stick out of memory. Here each image is downscaled once and cached on disk.
 *
 * The page asks for  https://thumb.lumen/?w=320&u=<encoded original url>
 */
class Thumbs(ctx: Context) {
    private val dir = File(ctx.cacheDir, "thumbs").apply { mkdirs() }
    private val gate = Semaphore(8)       // parallel downloads (network-bound; decoding is quick at these sizes)
    // Recently served images kept in memory, so revisiting a screen shows them at once.
    private val mem = object : android.util.LruCache<String, ByteArray>(12 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ByteArray) = value.size
    }
    // Links that failed recently aren't tried again on every screen (dead logo servers are common).
    private val failed = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private val headers = mapOf("Cache-Control" to "max-age=2592000", "Access-Control-Allow-Origin" to "*")
    private fun ok(bytes: ByteArray) = WebResourceResponse("image/jpeg", null, 200, "OK", headers, ByteArrayInputStream(bytes))
    private val empty = ByteArray(0)

    init {
        Thread {
            // keep the cache from growing forever: drop files unused for 30 days
            val cutoff = System.currentTimeMillis() - 30L * 86400000
            dir.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
        }.start()
    }

    fun serve(src: String, width: Int): WebResourceResponse {
        val w = width.coerceIn(48, 1280)
        val key = Integer.toHexString(src.hashCode()) + "_" + w + "_" + Integer.toHexString(src.length)
        mem.get(key)?.let { return ok(it) }
        failed[src]?.let { if (System.currentTimeMillis() - it < 30 * 60 * 1000) return notFound() }
        val f = File(dir, "$key.jpg")
        if (f.exists() && f.length() > 0) {
            val b = f.readBytes(); mem.put(key, b)
            return ok(b)
        }
        gate.acquire()
        try {
            mem.get(key)?.let { return ok(it) }
            if (f.exists() && f.length() > 0) { val b = f.readBytes(); mem.put(key, b); return ok(b) }
            val small = smaller(src, w)
            val bytes = fetch(small) ?: (if (small != src) fetch(src) else null)
            if (bytes == null) { failed[src] = System.currentTimeMillis(); return notFound() }
            val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
            if (opts.outWidth <= 0) return notFound()
            var sample = 1
            while (opts.outWidth / (sample * 2) >= w) sample *= 2
            val decode = BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = Bitmap.Config.RGB_565 }
            var bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decode) ?: return notFound()
            if (bmp.width > w * 1.5) {
                val h = (bmp.height.toLong() * w / bmp.width).toInt().coerceAtLeast(1)
                val scaled = Bitmap.createScaledBitmap(bmp, w, h, true)
                if (scaled !== bmp) bmp.recycle()
                bmp = scaled
            }
            val tmp = File(dir, "$key.tmp")
            tmp.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 82, it) }
            bmp.recycle()
            tmp.renameTo(f)
            val out = f.readBytes(); mem.put(key, out)
            return ok(out)
        } catch (e: Throwable) {
            return notFound()
        } finally {
            gate.release()
        }
    }

    /** Providers often link full-size TMDB posters (1–3 MB). TMDB serves the same picture in small sizes. */
    private fun smaller(src: String, w: Int): String {
        if (!src.contains("image.tmdb.org/t/p/")) return src
        val size = when { w <= 185 -> "w185"; w <= 342 -> "w342"; w <= 500 -> "w500"; else -> "w780" }
        return src.replace(Regex("/t/p/[^/]+/"), "/t/p/$size/")
    }

    private fun fetch(src: String): ByteArray? {
        return try {
            val (c, s) = Net.open(src, 7000)
            try {
                val out = java.io.ByteArrayOutputStream()
                val buf = ByteArray(32 * 1024)
                var total = 0
                s.use { input ->
                    while (true) {
                        val n = input.read(buf); if (n < 0) break
                        total += n
                        if (total > 8 * 1024 * 1024) return null   // not a poster
                        out.write(buf, 0, n)
                    }
                }
                out.toByteArray()
            } finally { c.disconnect() }
        } catch (e: Exception) { null }
    }

    private fun notFound() = WebResourceResponse("image/jpeg", null, 404, "Not found", emptyMap(), ByteArrayInputStream(empty))
}
