package tv.lumen.app

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
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
        report = emit
        // Android 8+: the app needs "Install unknown apps" permission once.
        if (Build.VERSION.SDK_INT >= 26 && !act.packageManager.canRequestPackageInstalls()) {
            pendingApk = apk
            askedAt = System.currentTimeMillis()
            emit("update", JSONObject().put("state", "permission"))
            val opened = tryStart(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${act.packageName}")))
                || tryStart(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES))
                || tryStart(Intent(Settings.ACTION_SECURITY_SETTINGS))
            if (!opened) emit("update", JSONObject().put("state", "permission-manual"))
            return
        }
        try {
            installWithSession(apk)
        } catch (e: Exception) {
            // Older installers: hand the file to the system's package installer screen.
            val uri = if (Build.VERSION.SDK_INT >= 24) FileProvider.getUriForFile(act, "${act.packageName}.files", apk) else Uri.fromFile(apk)
            @Suppress("DEPRECATION")
            val ok = tryStart(Intent(Intent.ACTION_INSTALL_PACKAGE).setData(uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                .putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true))
                || tryStart(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            if (!ok) emit("update", JSONObject().put("state", "error").put("msg", e.message ?: "The installer couldn’t be opened"))
        }
    }

    /** Streams the APK into a PackageInstaller session; Android shows one "Install" confirmation. */
    private fun installWithSession(apk: File) {
        val installer = act.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(act.packageName)
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("lumen-tv", 0, apk.length()).use { out ->
                    input.copyTo(out, 64 * 1024)
                    session.fsync(out)
                }
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val pending = PendingIntent.getBroadcast(act, id, Intent(act, InstallReceiver::class.java).setPackage(act.packageName), flags)
            session.commit(pending.intentSender)
        }
    }

    private fun tryStart(i: Intent): Boolean = try {
        act.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true
    } catch (e: Exception) { false }

    // After the person allows "Install unknown apps", returning to the app continues the install.
    private var pendingApk: File? = null
    private var askedAt = 0L
    fun onResume(emit: (String, JSONObject) -> Unit) {
        val apk = pendingApk ?: return
        if (Build.VERSION.SDK_INT >= 26 && !act.packageManager.canRequestPackageInstalls()) {
            // Some Fire TVs open and immediately close that settings page: show the manual steps instead.
            if (System.currentTimeMillis() - askedAt < 4000) emit("update", JSONObject().put("state", "permission-manual"))
            return
        }
        pendingApk = null
        emit("update", JSONObject().put("state", "installing"))
        openInstaller(apk, emit)
    }

    companion object {
        /** Where install results go (set while an update is running). */
        @Volatile var report: ((String, JSONObject) -> Unit)? = null
    }
}

/** Install results from PackageInstaller: shows Android's confirmation, or reports why it failed. */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                try { ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) {
                    Updater.report?.invoke("update", JSONObject().put("state", "error").put("msg", "Android’s installer couldn’t be opened"))
                }
            }
            PackageInstaller.STATUS_SUCCESS -> { /* the app restarts on the new version (see RelaunchReceiver) */ }
            PackageInstaller.STATUS_FAILURE_ABORTED -> Updater.report?.invoke("update", JSONObject().put("state", "error").put("msg", "Update cancelled"))
            PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
                Updater.report?.invoke("update", JSONObject().put("state", "error")
                    .put("msg", "This build can’t replace the installed app. Uninstall Lumen TV once and install the latest build; updates work after that."))
            PackageInstaller.STATUS_FAILURE_STORAGE -> Updater.report?.invoke("update", JSONObject().put("state", "error").put("msg", "Not enough free space on the TV"))
            else -> Updater.report?.invoke("update", JSONObject().put("state", "error")
                .put("msg", intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "The update didn’t install"))
        }
    }
}

/** After an update installs, open the app again on the new version. */
class RelaunchReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        try {
            ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) { }
    }
}
