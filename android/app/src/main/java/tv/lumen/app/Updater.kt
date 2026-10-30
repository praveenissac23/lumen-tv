package tv.lumen.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Downloads a new APK published by the GitHub build and opens Android's installer.
 * The app checks GitHub's "latest release" itself (see web/src/updates.js).
 */
class Updater(private val act: MainActivity) {

    @Volatile private var busy = false

    fun install(url: String, emit: (String, JSONObject) -> Unit) {
        if (busy) return
        busy = true
        Thread {
            try {
                val dir = File(act.cacheDir, "updates").apply { mkdirs() }
                dir.listFiles()?.forEach { it.delete() }
                val apk = File(dir, "lumen-tv.apk")
                download(url, apk) { pct -> emit("update", JSONObject().put("state", "downloading").put("pct", pct)) }
                emit("update", JSONObject().put("state", "installing"))
                act.runOnUiThread { openInstaller(apk, emit) }
            } catch (e: Exception) {
                emit("update", JSONObject().put("state", "error").put("msg", e.message ?: "Download failed"))
            } finally {
                busy = false
            }
        }.start()
    }

    private fun download(url: String, dest: File, progress: (Int) -> Unit) {
        var target = url
        var conn: HttpURLConnection? = null
        for (i in 0 until 6) {
            val c = URL(target).openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 15000
            c.readTimeout = 30000
            c.setRequestProperty("User-Agent", "LumenTV")
            val code = c.responseCode
            if (code in 300..399) {
                target = URL(URL(target), c.getHeaderField("Location")).toString()
                c.disconnect()
                continue
            }
            if (code !in 200..299) { c.disconnect(); throw IllegalStateException("Server answered $code") }
            conn = c
            break
        }
        val c = conn ?: throw IllegalStateException("Too many redirects")
        try {
            val total = c.contentLength.toLong()
            var done = 0L
            var last = -1
            c.inputStream.use { input ->
                dest.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        if (total > 0) {
                            val pct = (done * 100 / total).toInt()
                            if (pct != last) { last = pct; progress(pct) }
                        }
                    }
                }
            }
        } finally { c.disconnect() }
    }

    private fun openInstaller(apk: File, emit: (String, JSONObject) -> Unit) {
        // Android 8+: the app needs "Install unknown apps" permission once.
        if (Build.VERSION.SDK_INT >= 26 && !act.packageManager.canRequestPackageInstalls()) {
            emit("update", JSONObject().put("state", "permission"))
            try {
                act.startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${act.packageName}"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            } catch (e: Exception) {
                act.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            pendingApk = apk
            return
        }
        val uri = if (Build.VERSION.SDK_INT >= 24)
            FileProvider.getUriForFile(act, "${act.packageName}.files", apk)
        else Uri.fromFile(apk)
        @Suppress("DEPRECATION")
        val intent = Intent(Intent.ACTION_INSTALL_PACKAGE)
            .setData(uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
        try {
            act.startActivity(intent)
        } catch (e: Exception) {
            act.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    // After the person allows "Install unknown apps", returning to the app continues the install.
    private var pendingApk: File? = null
    fun onResume(emit: (String, JSONObject) -> Unit) {
        val apk = pendingApk ?: return
        if (Build.VERSION.SDK_INT >= 26 && !act.packageManager.canRequestPackageInstalls()) return
        pendingApk = null
        openInstaller(apk, emit)
    }
}
