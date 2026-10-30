package tv.lumen.app

import android.util.Xml
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import java.io.BufferedInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Calendar
import java.util.TimeZone
import java.util.zip.GZIPInputStream

/** Plain HTTP helpers: redirects across http/https, gzip, IPTV-friendly user agent. */
object Net {

    fun open(url: String, timeoutMs: Int): Pair<HttpURLConnection, InputStream> {
        var target = url
        repeat(6) {
            val c = URL(target).openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = minOf(timeoutMs, 15000)
            c.readTimeout = timeoutMs
            c.setRequestProperty("User-Agent", PlayerHost.USER_AGENT)
            c.setRequestProperty("Accept-Encoding", "gzip")
            val code = c.responseCode
            if (code in 300..399) {
                val loc = c.getHeaderField("Location") ?: throw IllegalStateException("Redirect without a location")
                target = URL(URL(target), loc).toString()
                c.disconnect()
                return@repeat
            }
            if (code !in 200..299) { c.disconnect(); throw HttpError(code) }
            var stream: InputStream = BufferedInputStream(c.inputStream, 64 * 1024)
            // gzip either by header or by magic bytes (.xml.gz guide files)
            stream.mark(2)
            val b1 = stream.read(); val b2 = stream.read()
            stream.reset()
            if ("gzip".equals(c.contentEncoding, true) || (b1 == 0x1f && b2 == 0x8b)) {
                stream = BufferedInputStream(GZIPInputStream(stream, 64 * 1024), 64 * 1024)
            }
            return c to stream
        }
        throw IllegalStateException("Too many redirects")
    }

    fun getText(url: String, timeoutMs: Int): String {
        val (c, s) = open(url, timeoutMs)
        try { return s.bufferedReader(Charsets.UTF_8).use { it.readText() } } finally { c.disconnect() }
    }

    class HttpError(val code: Int) : Exception("HTTP $code")

    /** One request without following redirects; caller handles 3xx. */
    private fun connect(url: String, method: String, headers: Map<String, String>, timeoutMs: Int): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.instanceFollowRedirects = false
        c.requestMethod = method
        c.connectTimeout = minOf(timeoutMs, 15000)
        c.readTimeout = timeoutMs
        c.setRequestProperty("User-Agent", headers["User-Agent"] ?: PlayerHost.USER_AGENT)
        for ((k, v) in headers) if (k != "User-Agent") c.setRequestProperty(k, v)
        return c
    }

    /** Follows redirects for any method (POST bodies are re-sent, as APIs expect). */
    private fun follow(url: String, method: String, headers: Map<String, String>, body: ByteArray?, timeoutMs: Int): HttpURLConnection {
        var target = url
        repeat(6) {
            val c = connect(target, method, headers, timeoutMs)
            if (body != null) { c.doOutput = true; c.outputStream.use { it.write(body) } }
            val code = c.responseCode
            if (code in 300..399) {
                val loc = c.getHeaderField("Location") ?: return c
                target = URL(URL(target), loc).toString()
                c.disconnect()
                return@repeat
            }
            return c
        }
        throw IllegalStateException("Too many redirects")
    }

    /** File size and type without downloading. Falls back to a 1-byte range read when HEAD isn't allowed. */
    fun head(url: String): Pair<Long, String> {
        var c = follow(url, "HEAD", mapOf("Accept-Encoding" to "identity"), null, 12000)
        try {
            var size = c.getHeaderField("Content-Length")?.toLongOrNull() ?: -1L
            var type = c.contentType ?: ""
            if (c.responseCode !in 200..299 || size <= 0) {
                c.disconnect()
                c = follow(url, "GET", mapOf("Range" to "bytes=0-0", "Accept-Encoding" to "identity"), null, 12000)
                val cr = c.getHeaderField("Content-Range") // bytes 0-0/123456
                size = cr?.substringAfter('/')?.toLongOrNull() ?: (c.getHeaderField("Content-Length")?.toLongOrNull() ?: -1L)
                if (c.responseCode == 200) size = c.getHeaderField("Content-Length")?.toLongOrNull() ?: -1L
                type = c.contentType ?: type
            }
            return size to type
        } finally { c.disconnect() }
    }

    /** Text request for JSON APIs. Returns the body even for error statuses (APIs explain errors in it). */
    fun request(method: String, url: String, headers: Map<String, String>, body: String?): String {
        val c = follow(url, method, headers, body?.takeIf { it.isNotEmpty() }?.toByteArray(), 20000)
        try {
            val stream = if (c.responseCode >= 400) c.errorStream else c.inputStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            if (text.isEmpty() && c.responseCode >= 400) throw HttpError(c.responseCode)
            return text
        } finally { c.disconnect() }
    }

    /** Reads `len` bytes at `from` using a Range request; null if the server ignores ranges. */
    private fun range(url: String, from: Long, len: Int): Pair<ByteArray, Long>? {
        val c = follow(url, "GET", mapOf("Range" to "bytes=$from-${from + len - 1}", "Accept-Encoding" to "identity"), null, 15000)
        try {
            if (c.responseCode != 206) return null
            val total = c.getHeaderField("Content-Range")?.substringAfter('/')?.toLongOrNull() ?: -1L
            val buf = ByteArray(len)
            var n = 0
            c.inputStream.use { s -> while (n < len) { val r = s.read(buf, n, len - n); if (r < 0) break; n += r } }
            return (if (n == len) buf else buf.copyOf(n)) to total
        } finally { c.disconnect() }
    }

    /**
     * OpenSubtitles file hash: file size + sum of the first and last 64 KB read as 64-bit little-endian words.
     * Needs a server that supports byte ranges; returns null otherwise.
     */
    fun subtitleHash(url: String): Pair<String, Long>? {
        val chunk = 65536
        val (first, total) = range(url, 0, chunk) ?: return null
        if (total < chunk * 2) return null
        val (last, _) = range(url, total - chunk, chunk) ?: return null
        if (first.size < chunk || last.size < chunk) return null
        var h = total
        fun sum(b: ByteArray) {
            val bb = java.nio.ByteBuffer.wrap(b).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            while (bb.remaining() >= 8) h += bb.long
        }
        sum(first); sum(last)
        return String.format("%016x", h) to total
    }

    /** Downloads a URL to a file (gunzipping if needed). */
    fun download(url: String, dest: java.io.File) {
        val (c, s) = open(url, 30000)
        try { s.use { input -> dest.outputStream().use { input.copyTo(it) } } } finally { c.disconnect() }
    }
}

/**
 * Streams an XMLTV guide and keeps only programmes inside [from, to].
 * Output JSON: {"channelId": [[start, stop, "title", "desc"], ...], ...} sorted by start.
 */
object Xmltv {
    private class Prog(val s: Long, val e: Long, val t: String, val d: String)
    private val OFFSET = Regex("([+-])(\\d{2})(\\d{2})")

    fun parse(input: InputStream, from: Long, to: Long): String {
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(input, null)
        val byCh = HashMap<String, ArrayList<Prog>>(2048)
        var ch: String? = null
        var s = 0L; var e = 0L
        var title: String? = null; var desc: String? = null
        var keep = false
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            if (event == XmlPullParser.START_TAG) {
                when (parser.name) {
                    "programme" -> {
                        ch = parser.getAttributeValue(null, "channel")
                        s = time(parser.getAttributeValue(null, "start"))
                        e = time(parser.getAttributeValue(null, "stop"))
                        if (e == 0L) e = s + 1800
                        keep = ch != null && s > 0 && e >= from && s <= to
                        title = null; desc = null
                    }
                    "title" -> if (keep && title == null) title = parser.nextText()
                    "desc" -> if (keep && desc == null) desc = parser.nextText()
                }
            } else if (event == XmlPullParser.END_TAG && parser.name == "programme") {
                if (keep && ch != null) {
                    val d = desc ?: ""
                    byCh.getOrPut(ch) { ArrayList() }.add(Prog(s, e, title ?: "", if (d.length > 300) d.substring(0, 300) else d))
                }
                keep = false
            }
            event = parser.next()
        }
        val out = StringBuilder(1 shl 20)
        out.append('{')
        var first = true
        for ((id, list) in byCh) {
            list.sortBy { it.s }
            if (!first) out.append(',')
            first = false
            out.append(JSONObject.quote(id)).append(":[")
            list.forEachIndexed { i, p ->
                if (i > 0) out.append(',')
                out.append('[').append(p.s).append(',').append(p.e).append(',')
                    .append(JSONObject.quote(p.t)).append(',').append(JSONObject.quote(p.d)).append(']')
            }
            out.append(']')
        }
        out.append('}')
        return out.toString()
    }

    // "20261030013000 +0400" -> epoch seconds
    private fun time(v: String?): Long {
        if (v == null || v.length < 12) return 0
        return try {
            val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
            cal.clear()
            cal.set(
                v.substring(0, 4).toInt(), v.substring(4, 6).toInt() - 1, v.substring(6, 8).toInt(),
                v.substring(8, 10).toInt(), v.substring(10, 12).toInt(),
                if (v.length >= 14 && v[12].isDigit()) v.substring(12, 14).toInt() else 0,
            )
            var t = cal.timeInMillis / 1000
            val m = OFFSET.find(v, 12)
            if (m != null) {
                val sign = if (m.groupValues[1] == "-") -1 else 1
                t -= sign * (m.groupValues[2].toInt() * 3600 + m.groupValues[3].toInt() * 60)
            }
            t
        } catch (e: Exception) { 0 }
    }
}
