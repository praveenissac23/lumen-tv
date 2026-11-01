package tv.lumen.app

import android.app.Activity
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.SurfaceView
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.Tracks
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.text.CueGroup
import org.json.JSONArray
import java.io.File
import java.util.Locale
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import org.json.JSONObject

/**
 * Owns the ExoPlayer instance and the SurfaceView it draws into.
 * The SurfaceView sits under the transparent WebView; the web UI tells us
 * where the video should appear (a preview box, or the whole screen).
 */
@OptIn(UnstableApi::class)
class PlayerHost(
    private val activity: Activity,
    private val container: FrameLayout,     // full-screen layer under the WebView
    private val emit: (String, JSONObject) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val surface = SurfaceView(activity)
    private var player: ExoPlayer? = null
    private var bufferMs = 4000
    private var resizeMode = "fit"
    private var rect: JSONObject? = null       // stage coordinates (1920x1080) or null = full screen
    private var videoW = 16
    private var videoH = 9
    private var lastUrl: String? = null
    private var lastLive = true
    private var triedHls = false
    private val extSubs = ArrayList<MediaItem.SubtitleConfiguration>()
    var wasPlaying = false
        private set

    init {
        container.addView(surface, FrameLayout.LayoutParams(0, 0))
        container.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> layoutSurface() }
    }

    private val ticker = object : Runnable {
        override fun run() {
            val p = player ?: return
            if (p.isPlaying) {
                val dur = if (p.duration == C.TIME_UNSET) 0L else p.duration
                emit("progress", JSONObject().put("pos", p.currentPosition).put("dur", dur))
            }
            main.postDelayed(this, 1000)
        }
    }

    private var builtForLive = true

    private fun build(live: Boolean): ExoPlayer {
        builtForLive = live
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent(USER_AGENT)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(20000)
        val data = DefaultDataSource.Factory(activity, http)
        val extractors = DefaultExtractorsFactory()
            .setTsExtractorFlags(
                DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or
                    DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS
            )
            .setConstantBitrateSeekingEnabled(true)
        val load = if (live) DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                maxOf(bufferMs, 2500),       // min buffer
                maxOf(bufferMs * 4, 30000),  // max buffer
                minOf(bufferMs, 2500).coerceAtLeast(700), // start playing after
                bufferMs,                    // after a rebuffer
            )
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()
        else DefaultLoadControl.Builder()
            // Films and episodes: read far ahead (up to 10 minutes / 160 MB) and keep the last
            // 2 minutes, so skipping forward or back inside that window is instant.
            .setBufferDurationsMs(60_000, 600_000, 2_500, 5_000)
            .setTargetBufferBytes(160 * 1024 * 1024)
            .setPrioritizeTimeOverSizeThresholds(false)
            .setBackBuffer(120_000, true)
            .build()
        val p = ExoPlayer.Builder(activity)
            .setLoadControl(load)
            .setMediaSourceFactory(DefaultMediaSourceFactory(data, extractors)
                .setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(if (live) 3 else 8)))
            .build()
        p.setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
            true,
        )
        p.setVideoSurfaceView(surface)
        p.videoScalingMode = if (resizeMode == "zoom") C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING else C.VIDEO_SCALING_MODE_SCALE_TO_FIT
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_BUFFERING -> emit("player", JSONObject().put("state", "buffering"))
                    Player.STATE_READY -> emit("player", JSONObject().put("state", "ready"))
                    Player.STATE_ENDED -> emit("player", JSONObject().put("state", "ended"))
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                val p2 = player ?: return
                // Live streams fall behind the window after a stall: jump back to live.
                if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                    p2.seekToDefaultPosition(); p2.prepare(); return
                }
                // Extension-less links are often HLS: retry once as HLS.
                val url = lastUrl
                if (!triedHls && url != null && !url.contains(".m3u8") &&
                    (error.errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED ||
                        error.errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED)
                ) {
                    triedHls = true
                    p2.setMediaItem(MediaItem.Builder().setUri(url).setMimeType(MimeTypes.APPLICATION_M3U8).build())
                    p2.prepare(); p2.play(); return
                }
                emit("player", JSONObject().put("state", "error").put("msg", friendly(error)))
            }

            // Subtitle text is drawn by the web interface so it can be styled and sized there.
            override fun onCues(cueGroup: CueGroup) {
                val text = cueGroup.cues.mapNotNull { it.text?.toString() }.joinToString("\n")
                emit("cues", JSONObject().put("text", text))
            }

            override fun onTracksChanged(tracks: Tracks) {
                emit("tracks", JSONObject().put("changed", true))
            }

            override fun onVideoSizeChanged(size: VideoSize) {
                if (size.width > 0 && size.height > 0) {
                    videoW = (size.width * size.pixelWidthHeightRatio).toInt()
                    videoH = size.height
                    layoutSurface()
                }
            }
        })
        return p
    }

    fun play(url: String, opts: JSONObject) {
        val live = opts.optBoolean("live", true)
        if (player != null && builtForLive != live) { player?.release(); player = null }   // films get the big buffer
        val p = player ?: build(live).also { player = it }
        extSubs.clear()
        p.setPlaybackSpeed(1f)
        emit("cues", JSONObject().put("text", ""))
        rect = opts.optJSONObject("rect")
        lastUrl = url
        lastLive = opts.optBoolean("live", true)
        triedHls = false
        val item = MediaItem.Builder().setUri(Uri.parse(url))
        if (url.contains(".m3u8")) item.setMimeType(MimeTypes.APPLICATION_M3U8)
        p.setMediaItem(item.build(), opts.optLong("start", 0))
        p.repeatMode = if (url.startsWith("asset:")) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
        p.prepare()
        p.playWhenReady = true
        surface.visibility = View.VISIBLE
        layoutSurface()
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        main.removeCallbacks(ticker); main.post(ticker)
    }

    fun stop() {
        player?.let { it.stop(); it.clearMediaItems() }
        lastUrl = null
        surface.visibility = View.INVISIBLE
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        main.removeCallbacks(ticker)
    }

    fun pause(p: Boolean) { player?.playWhenReady = !p }
    fun seekBy(ms: Long) { player?.let { it.seekTo((it.currentPosition + ms).coerceAtLeast(0)) } }
    fun seekTo(ms: Long) { player?.seekTo(ms.coerceAtLeast(0)) }

    fun setRect(r: JSONObject?) { rect = r; layoutSurface() }

    fun setSpeed(x: Float) { if (x > 0f) player?.setPlaybackSpeed(x) }

    /** Audio and subtitle tracks of the current video. Ids are "group:track". */
    fun tracks(): String {
        val out = JSONObject().put("audio", JSONArray()).put("text", JSONArray())
        val p = player ?: return out.toString()
        p.currentTracks.groups.forEachIndexed { g, group ->
            val key = when (group.type) { C.TRACK_TYPE_AUDIO -> "audio"; C.TRACK_TYPE_TEXT -> "text"; else -> null } ?: return@forEachIndexed
            for (i in 0 until group.length) {
                if (!group.isTrackSupported(i)) continue
                val f = group.getTrackFormat(i)
                val lang = f.language ?: ""
                val langName = if (lang.isNotEmpty() && lang != "und") Locale(lang).getDisplayLanguage(Locale.ENGLISH) else ""
                var label = listOfNotNull(f.label?.takeIf { it.isNotBlank() }, langName.takeIf { it.isNotBlank() && f.label?.contains(it, true) != true })
                    .joinToString(", ").ifEmpty { "Track ${i + 1}" }
                if (key == "audio" && f.channelCount > 2) label += " ${if (f.channelCount == 6) "5.1" else "${f.channelCount}ch"}"
                out.getJSONArray(key).put(
                    JSONObject().put("id", "$g:$i").put("label", label).put("lang", lang)
                        .put("selected", group.isTrackSelected(i)).put("external", f.label?.startsWith("Downloaded") == true)
                )
            }
        }
        return out.toString()
    }

    fun selectTrack(type: String, id: String) {
        val p = player ?: return
        val t = if (type == "audio") C.TRACK_TYPE_AUDIO else C.TRACK_TYPE_TEXT
        if (id == "off") {
            p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(t, true).build()
            emit("cues", JSONObject().put("text", ""))
            return
        }
        val parts = id.split(":").mapNotNull { it.toIntOrNull() }
        if (parts.size != 2) return
        val (g, i) = parts
        val group = p.currentTracks.groups.getOrNull(g) ?: return
        if (group.type != t || i !in 0 until group.length) return
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(t, false)
            .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, i))
            .build()
    }

    /** Attach a downloaded subtitle file to the current video and switch to it, keeping the position. */
    fun addSubtitle(file: File, lang: String, name: String) {
        val p = player ?: return
        val item = p.currentMediaItem ?: return
        val mime = when (file.extension.lowercase()) {
            "vtt" -> MimeTypes.TEXT_VTT
            "ass", "ssa" -> MimeTypes.TEXT_SSA
            else -> MimeTypes.APPLICATION_SUBRIP
        }
        val conf = MediaItem.SubtitleConfiguration.Builder(Uri.fromFile(file))
            .setMimeType(mime)
            .setLanguage(lang)
            .setLabel("Downloaded ${name.take(40)}".trim())
            .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
            .build()
        extSubs.add(conf)
        val pos = p.currentPosition
        p.setMediaItem(item.buildUpon().setSubtitleConfigurations(ArrayList(extSubs)).build(), pos)
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_TEXT)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            .setPreferredTextLanguage(lang)
            .build()
        p.prepare()
        p.playWhenReady = true
    }

    fun setResize(mode: String) {
        resizeMode = mode
        player?.videoScalingMode =
            if (mode == "zoom") C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING else C.VIDEO_SCALING_MODE_SCALE_TO_FIT
        layoutSurface()
    }

    /** Buffer changes apply to the next stream: the player is rebuilt with the new load control. */
    fun setBuffer(ms: Int) {
        if (ms == bufferMs) return
        bufferMs = ms
        if (player != null && lastUrl == null) { player?.release(); player = null }
    }

    // Place the SurfaceView: stage rect -> screen pixels, then fit/fill/zoom inside it.
    private fun layoutSurface() {
        val W = container.width.toFloat()
        val H = container.height.toFloat()
        if (W <= 0 || H <= 0) return
        val r = rect
        var x = 0f; var y = 0f; var w = W; var h = H
        if (r != null) {
            // Fractions of the screen sent by the interface
            x = r.optDouble("fx").toFloat() * W
            y = r.optDouble("fy").toFloat() * H
            w = r.optDouble("fw").toFloat() * W
            h = r.optDouble("fh").toFloat() * H
            if (w.isNaN() || h.isNaN() || w <= 0f || h <= 0f) { x = 0f; y = 0f; w = W; h = H }
        }
        if (resizeMode == "fit" && videoW > 0 && videoH > 0) {
            val va = videoW.toFloat() / videoH
            if (w / h > va) { val nw = h * va; x += (w - nw) / 2f; w = nw } else { val nh = w / va; y += (h - nh) / 2f; h = nh }
        }
        val lp = FrameLayout.LayoutParams(w.toInt(), h.toInt(), Gravity.TOP or Gravity.START)
        lp.leftMargin = x.toInt(); lp.topMargin = y.toInt()
        surface.layoutParams = lp
    }

    fun onStop() {
        val p = player ?: return
        wasPlaying = lastUrl != null
        p.playWhenReady = false
    }

    fun onStart() {
        val p = player ?: return
        val url = lastUrl
        if (wasPlaying && url != null) {
            // Live streams restart at the live edge; films carry on where they were.
            if (lastLive) { p.seekToDefaultPosition(); p.prepare() }
            p.playWhenReady = true
        }
        wasPlaying = false
    }

    fun release() { main.removeCallbacks(ticker); player?.release(); player = null }

    private fun friendly(e: PlaybackException): String = when (e.errorCode) {
        PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> "The server refused this stream. Your subscription may have too many devices connected."
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "Can’t reach the stream. Check your internet connection."
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> "This device can’t decode this channel’s video format."
        else -> "This stream didn’t start (${e.errorCodeName}). Try again or pick another channel."
    }

    companion object {
        // Many IPTV servers only accept common player user agents.
        const val USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20"
    }
}
