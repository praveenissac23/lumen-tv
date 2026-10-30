package tv.lumen.app

import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.InputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import kotlin.concurrent.thread

/**
 * Tiny web page served on the home network so a phone can type and dictate searches,
 * and paste playlist logins, subtitle keys and wallpaper links into the TV.
 * Every form carries a 4-digit code shown on the TV, so other devices on the network can't send.
 */
class LocalServer(private val onMessage: (JSONObject) -> Unit) {
    val port = 8899
    val pin = (1000..9999).random().toString()
    @Volatile private var server: ServerSocket? = null

    fun start() {
        if (server != null) return
        thread(name = "lumen-remote", isDaemon = true) {
            try {
                val s = ServerSocket(port)
                server = s
                while (!s.isClosed) {
                    val client = try { s.accept() } catch (e: Exception) { break }
                    thread(isDaemon = true) { try { handle(client) } catch (e: Exception) { } }
                }
            } catch (e: Exception) {
                server = null
            }
        }
    }

    fun stop() { try { server?.close() } catch (e: Exception) { } ; server = null }

    fun url(): String? {
        val ip = localIp() ?: return null
        return "http://$ip:$port"
    }

    private fun localIp(): String? = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }?.hostAddress
    } catch (e: Exception) { null }

    private fun handle(sock: Socket) {
        sock.use { c ->
            c.soTimeout = 10000
            val input = BufferedInputStream(c.getInputStream())
            val requestLine = readLine(input) ?: return
            var length = 0
            while (true) {
                val h = readLine(input) ?: break
                if (h.isEmpty()) break
                if (h.startsWith("Content-Length:", true)) length = h.substringAfter(':').trim().toIntOrNull() ?: 0
            }
            val parts = requestLine.split(" ")
            val method = parts.getOrNull(0) ?: "GET"
            var msg = ""
            if (method == "POST" && length in 1..65536) {
                val buf = ByteArray(length)
                var n = 0
                while (n < length) { val r = input.read(buf, n, length - n); if (r < 0) break; n += r }
                msg = submit(parseForm(String(buf, 0, n, Charsets.UTF_8)))
            }
            val body = page(msg).toByteArray(Charsets.UTF_8)
            val out = c.getOutputStream()
            out.write("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".toByteArray())
            out.write(body)
            out.flush()
        }
    }

    private fun readLine(s: InputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val b = s.read()
            if (b < 0) return if (sb.isEmpty()) null else sb.toString()
            if (b == '\n'.code) return sb.toString().trimEnd('\r')
            if (sb.length > 8192) return null
            sb.append(b.toChar())
        }
    }

    private fun parseForm(body: String): Map<String, String> = body.split("&").mapNotNull {
        val i = it.indexOf('=')
        if (i <= 0) null else try {
            URLDecoder.decode(it.substring(0, i), "UTF-8") to URLDecoder.decode(it.substring(i + 1), "UTF-8")
        } catch (e: IllegalArgumentException) { null }
    }.toMap()

    private fun submit(f: Map<String, String>): String {
        if (f["pin"]?.trim() != pin) return "That code doesn’t match the one on the TV."
        val type = f["type"] ?: return ""
        val msg = JSONObject().put("type", type)
        when (type) {
            "search", "play", "oskey", "wallpaper" -> {
                val t = f["text"]?.trim().orEmpty()
                if (t.isEmpty()) return "Type something first."
                msg.put("text", t)
            }
            "xtream" -> {
                if (f["server"].isNullOrBlank() || f["user"].isNullOrBlank()) return "Fill in the server and username."
                msg.put("type", "playlist").put("playlist", JSONObject().put("type", "xtream").put("name", f["name"]?.ifBlank { null } ?: "My TV")
                    .put("server", f["server"]!!.trim()).put("user", f["user"]!!.trim()).put("pass", f["pass"]?.trim().orEmpty()))
            }
            "m3u" -> {
                if (f["url"].isNullOrBlank()) return "Paste the playlist link."
                msg.put("type", "playlist").put("playlist", JSONObject().put("type", "m3u").put("name", f["name"]?.ifBlank { null } ?: "My playlist")
                    .put("url", f["url"]!!.trim()).put("epgUrl", f["epg"]?.trim().orEmpty()))
            }
            else -> return ""
        }
        onMessage(msg)
        return when (type) {
            "search" -> "Searching on the TV."
            "play" -> "Playing on the TV."
            "oskey" -> "Subtitle key saved on the TV."
            "wallpaper" -> "Wallpaper changed on the TV."
            else -> "Sent. The TV is loading your playlist."
        }
    }

    private fun page(msg: String): String = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Lumen TV remote</title>
<style>
:root{color-scheme:dark}body{margin:0;font:16px/1.4 system-ui,sans-serif;background:#12161b;color:#ece7dd}
main{max-width:520px;margin:0 auto;padding:20px 16px 60px}h1{font-size:24px;margin:8px 0 4px}h2{font-size:17px;margin:28px 0 10px;color:#cfa968}
p{color:#b9b5ad;margin:4px 0 12px}form{background:#1c232a;border-radius:14px;padding:14px;margin:0 0 12px}
input{box-sizing:border-box;width:100%;font:inherit;color:inherit;background:#12161b;border:1px solid #2f3843;border-radius:10px;padding:12px;margin:4px 0 10px}
button{font:inherit;font-weight:600;border:0;border-radius:24px;padding:11px 20px;background:#cfa968;color:#1d160a;margin-right:8px}
button.alt{background:#252d36;color:#ece7dd}.msg{background:#252d36;border-left:4px solid #cfa968;padding:10px 12px;border-radius:8px;margin:12px 0}
label{font-size:14px;color:#b9b5ad}
</style></head><body><main>
<h1>Lumen TV remote</h1><p>Enter the code shown on the TV once; your browser remembers it.</p>
${if (msg.isNotEmpty()) "<div class=\"msg\">${esc(msg)}</div>" else ""}
<form method="post"><label>Code on the TV</label><input name="pin" id="pin" inputmode="numeric" maxlength="4" required>
<h2 style="margin-top:6px">Search the TV</h2><p>Type, or tap the microphone on your keyboard and speak.</p>
<input name="text" placeholder="Channel, film or show" autocomplete="off">
<button name="type" value="search">Search</button><button class="alt" name="type" value="play">Play channel</button></form>
<h2>Add Xtream Codes login</h2>
<form method="post"><input type="hidden" name="pin" class="pinc"><input name="name" placeholder="Name (optional)"><input name="server" placeholder="Server, e.g. http://example.com:8080">
<input name="user" placeholder="Username" autocapitalize="off"><input name="pass" placeholder="Password" autocapitalize="off">
<button name="type" value="xtream">Send to TV</button></form>
<h2>Add M3U playlist link</h2>
<form method="post"><input type="hidden" name="pin" class="pinc"><input name="name" placeholder="Name (optional)"><input name="url" placeholder="Playlist link"><input name="epg" placeholder="Guide (XMLTV) link, optional">
<button name="type" value="m3u">Send to TV</button></form>
<h2>OpenSubtitles API key</h2>
<form method="post"><input type="hidden" name="pin" class="pinc"><input name="text" placeholder="Paste your API key" autocapitalize="off"><button name="type" value="oskey">Save on TV</button></form>
<h2>Wallpaper</h2>
<form method="post"><input type="hidden" name="pin" class="pinc"><input name="text" placeholder="Link to a JPG or PNG"><button name="type" value="wallpaper">Set wallpaper</button></form>
</main><script>
var p=document.getElementById('pin');try{p.value=localStorage.getItem('lpin')||''}catch(e){}
document.querySelectorAll('form').forEach(function(f){f.addEventListener('submit',function(){try{localStorage.setItem('lpin',p.value)}catch(e){}
f.querySelectorAll('.pinc').forEach(function(h){h.value=p.value})})});
</script></body></html>"""

    private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
