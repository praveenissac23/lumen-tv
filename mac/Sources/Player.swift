import Cocoa

/// VLC playback under the interface. Plays everything VLC plays (MPEG-TS, HLS, MKV, AVI…)
/// and reports the same events as the Android player: player / progress / tracks.
final class Player {
    private let view: NSView
    private let emit: (String, [String: Any]) -> Void
    private let vlc = VLCMediaPlayer()
    private var rect: [String: Any]? = nil
    private var resizeMode = "fit"
    private var bufferMs = 4000
    private var active = false
    private var lastState = ""
    private var lastTrackCount = -1
    private var lastVideoSize = CGSize.zero
    private var timer: Timer?
    private var tick = 0

    init(view: NSView, emit: @escaping (String, [String: Any]) -> Void) {
        self.view = view
        self.emit = emit
        vlc.drawable = view
        let t = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in self?.poll() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func play(_ url: String, opts: [String: Any]) {
        rect = opts["rect"] as? [String: Any]
        let start = (opts["start"] as? NSNumber)?.doubleValue ?? 0
        var u: URL?
        var loop = false
        if url.hasPrefix("asset:") {
            u = App.webRoot.appendingPathComponent(URL(string: url)?.lastPathComponent ?? "demo.mp4")
            loop = true
        } else {
            u = URL(string: url) ?? URL(string: url.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")
        }
        guard let mediaURL = u else { emit("player", ["state": "error", "msg": "This link isn’t a valid stream address."]); return }
        let m = VLCMedia(url: mediaURL)
        m.addOption(":network-caching=\(max(1000, bufferMs))")
        m.addOption(":live-caching=\(max(1000, bufferMs))")
        m.addOption(":http-user-agent=\(Net.userAgent)")
        m.addOption(":http-reconnect")
        if start > 0 { m.addOption(":start-time=\(start / 1000.0)") }
        if loop { m.addOption(":input-repeat=65535") }
        vlc.media = m
        vlc.rate = 1
        vlc.play()
        active = true
        lastState = ""
        lastTrackCount = -1
        view.isHidden = false
        layout()
        emit("cues", ["text": ""])
        emit("player", ["state": "buffering"])
        App.shared?.keepAwake(true)
    }

    func stop() {
        if vlc.media != nil { vlc.stop() }
        active = false
        view.isHidden = true
        App.shared?.keepAwake(false)
    }

    func pause(_ p: Bool) { if p { if vlc.isPlaying { vlc.pause() } } else { vlc.play() } }

    private var nowMs: Int32 { let t: VLCTime? = vlc.time; return t?.intValue ?? 0 }
    private var lengthMs: Int32 { let l: VLCTime? = vlc.media?.length; return l?.intValue ?? 0 }

    func seekBy(_ ms: Double) { guard vlc.media != nil else { return }; seekTo(Double(nowMs) + ms) }

    func seekTo(_ ms: Double) { guard vlc.media != nil else { return }; vlc.time = VLCTime(int: Int32(max(0, min(ms, 2_000_000_000)))) }

    func setRect(_ r: [String: Any]?) { rect = r; layout() }

    func setResize(_ mode: String) { resizeMode = mode; layout() }

    func setBuffer(_ ms: Int) { bufferMs = ms }

    func setSpeed(_ x: Double) { if x > 0 { vlc.rate = Float(x) } }

    // ---------- tracks ----------
    func tracks() -> String {
        func list(_ names: [Any]?, _ idx: [Any]?, _ cur: Int32, prefix: String) -> [[String: Any]] {
            let n = (names ?? []).map { "\($0)" }
            let ids = (idx ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
            var out: [[String: Any]] = []
            for (i, id) in ids.enumerated() where id >= 0 {
                let label = i < n.count ? n[i] : "Track \(i + 1)"
                out.append(["id": "\(prefix):\(id)", "label": label, "lang": "", "selected": id == cur, "external": label.hasPrefix("Downloaded")])
            }
            return out
        }
        let o: [String: Any] = [
            "audio": list(vlc.audioTrackNames, vlc.audioTrackIndexes, vlc.currentAudioTrackIndex, prefix: "a"),
            "text": list(vlc.videoSubTitlesNames, vlc.videoSubTitlesIndexes, vlc.currentVideoSubTitleIndex, prefix: "t"),
        ]
        return (try? JSONSerialization.data(withJSONObject: o)).flatMap { String(data: $0, encoding: .utf8) } ?? "{\"audio\":[],\"text\":[]}"
    }

    func selectTrack(_ type: String, _ id: String) {
        if id == "off" {
            if type == "audio" { vlc.currentAudioTrackIndex = -1 } else { vlc.currentVideoSubTitleIndex = -1 }
            return
        }
        guard let n = Int32(id.split(separator: ":").last ?? "") else { return }
        if type == "audio" { vlc.currentAudioTrackIndex = n } else { vlc.currentVideoSubTitleIndex = n }
    }

    func addSubtitle(_ file: URL) {
        _ = vlc.addPlaybackSlave(file, type: .subtitle, enforce: true)
    }

    // ---------- placement ----------
    /// Puts the video where the interface wants it: a preview box, or the whole window.
    func layout() {
        guard let parent = view.superview else { return }
        let W = parent.bounds.width, H = parent.bounds.height
        guard W > 0, H > 0 else { return }
        var f = CGRect(x: 0, y: 0, width: W, height: H)
        if let r = rect,
           let fx = (r["fx"] as? NSNumber)?.doubleValue, let fy = (r["fy"] as? NSNumber)?.doubleValue,
           let fw = (r["fw"] as? NSNumber)?.doubleValue, let fh = (r["fh"] as? NSNumber)?.doubleValue, fw > 0, fh > 0 {
            f = CGRect(x: fx * W, y: fy * H, width: fw * W, height: fh * H)
        } else if resizeMode != "fit" {
            // Fill the screen: grow the video view past the edges; the window clips it.
            let vs = vlc.videoSize
            if vs.width > 0 && vs.height > 0 {
                let va = vs.width / vs.height, wa = W / H
                if va > wa { let nw = H * va; f = CGRect(x: (W - nw) / 2, y: 0, width: nw, height: H) }
                else { let nh = W / va; f = CGRect(x: 0, y: (H - nh) / 2, width: W, height: nh) }
            }
        }
        if view.frame != f { view.frame = f }
    }

    // ---------- state, reported twice a second ----------
    private func poll() {
        guard active else { return }
        var s = ""
        switch vlc.state {
        case .opening, .buffering: s = vlc.isPlaying ? "ready" : "buffering"
        case .playing: s = "ready"
        case .ended: s = "ended"
        case .error: s = "error"
        default: s = vlc.isPlaying ? "ready" : lastState
        }
        if s != lastState && !s.isEmpty {
            lastState = s
            if s == "error" {
                emit("player", ["state": "error", "msg": "This stream didn’t start. The server may be busy, or too many devices are using your subscription. Try again or pick another channel."])
            } else {
                emit("player", ["state": s])
            }
        }
        if vlc.isPlaying {
            tick += 1
            if tick % 2 == 0 {
                emit("progress", ["pos": Int(nowMs), "dur": max(0, Int(lengthMs))])
            }
            let count = vlc.audioTrackIndexes.count + vlc.videoSubTitlesIndexes.count
            if count != lastTrackCount { lastTrackCount = count; emit("tracks", ["changed": true]) }
            let vs = vlc.videoSize
            if vs != lastVideoSize { lastVideoSize = vs; layout() }
        }
    }
}
