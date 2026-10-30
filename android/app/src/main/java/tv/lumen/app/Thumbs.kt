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
    private val gate = Semaphore(3)       // at most 3 decodes at a time
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
        val f = File(dir, "$key.jpg")
        if (f.exists() && f.length() > 0) {
            f.setLastModified(System.currentTimeMillis())
            return WebResourceResponse("image/jpeg", null, FileInputStream(f))
        }
        gate.acquire()
        try {
            if (f.exists() && f.length() > 0) return WebResourceResponse("image/jpeg", null, FileInputStream(f))
            val bytes = fetch(src) ?: return notFound()
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
            return WebResourceResponse("image/jpeg", null, FileInputStream(f))
        } catch (e: Throwable) {
            return notFound()
        } finally {
            gate.release()
        }
    }

    private fun fetch(src: String): ByteArray? {
        return try {
            val (c, s) = Net.open(src, 15000)
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
