import Cocoa

/// window.Native for the Mac: same method names and arguments as Android's NativeBridge.kt.
/// Calls arrive on server worker threads; anything touching views hops to the main thread.
final class Bridge {
    private var bodies: [Int: String] = [:]
    private let lock = NSLock()
    private let epg = EpgStore()
    private let cacheDir: URL = {
        let u = App.support.appendingPathComponent("cache", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
    private let work = DispatchQueue(label: "lumen.work", qos: .utility, attributes: .concurrent)
    private let updater = Updater()

    private func emit(_ e: String, _ d: [String: Any]) { App.shared.emit(e, d) }
    private func ui(_ f: @escaping () -> Void) { DispatchQueue.main.async(execute: f) }
    @discardableResult private func main<T>(_ f: () -> T) -> T { Thread.isMainThread ? f() : DispatchQueue.main.sync(execute: f) }
    private func put(_ id: Int, _ body: String) { lock.lock(); bodies[id] = body; lock.unlock() }
    private func json(_ o: Any) -> String {
        (try? JSONSerialization.data(withJSONObject: o)).flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }
    private func file(_ key: String) -> URL {
        let safe = String(key.map { c -> Character in (c.isLetter && c.isASCII) || c.isNumber || c == "." || c == "_" || c == "-" ? c : "_" })
        return cacheDir.appendingPathComponent(safe)
    }

    /// Returns the method's result as text, or nil (sent as "no content", read as null by the page).
    func call(_ name: String, _ a: [Any]) -> String? {
        func s(_ i: Int) -> String { i < a.count ? (a[i] as? String ?? (a[i] is NSNull ? "" : "\(a[i])")) : "" }
        func n(_ i: Int) -> Double { i < a.count ? ((a[i] as? NSNumber)?.doubleValue ?? Double(s(i)) ?? 0) : 0 }
        func id() -> Int { Int(n(0)) }

        switch name {
        // ---------- device ----------
        case "deviceInfo":
            let size = App.viewSize
            return json(["fireTv": false, "voice": false, "desktop": true, "platform": "mac",
                         "model": "Mac", "version": App.version, "versionCode": App.build,
                         "cssW": size.width, "cssH": size.height])
        case "viewSize":
            let size = App.viewSize
            return json(["w": size.width, "h": size.height])
        case "exit":
            DispatchQueue.main.async { NSApp.terminate(nil) }
            return nil

        // ---------- network ----------
        case "http":
            let rid = id(), url = s(1), timeout = max(5, n(2) / 1000)
            work.async {
                do {
                    let d = try Net.get(url, timeout: timeout)
                    self.put(rid, Net.text(d))
                    self.emit("http", ["id": rid, "ok": true])
                } catch let e as Net.HttpError {
                    self.emit("http", ["id": rid, "ok": false, "status": e.code, "error": "HTTP \(e.code)"])
                } catch {
                    self.emit("http", ["id": rid, "ok": false, "error": error.localizedDescription])
                }
            }
            return nil
        case "take":
            lock.lock(); defer { lock.unlock() }
            return bodies.removeValue(forKey: id())
        case "catalog":
            let rid = id(), url = s(1), kind = s(2), key = s(3)
            work.async {
                do {
                    let count = try Catalog.fetch(url: url, kind: kind, dest: self.file(key))
                    self.emit("catalog", ["id": rid, "ok": true, "count": count])
                } catch {
                    self.emit("catalog", ["id": rid, "ok": false, "error": error.localizedDescription])
                }
            }
            return nil

        // ---------- guide ----------
        case "epgImport":
            let rid = id(), url = s(1), from = Int64(n(2)), to = Int64(n(3)), csv = s(4)
            let wanted: Set<String>? = csv.isEmpty ? nil : Set(csv.split(separator: ",").map(String.init))
            work.async {
                do {
                    let count = try self.epg.importGuide(url: url, from: from, to: to, wanted: wanted) { done in
                        self.emit("epg", ["state": "importing", "count": done])
                    }
                    self.emit("epg", ["id": rid, "state": "ready", "ok": true, "count": count])
                } catch {
                    self.emit("epg", ["id": rid, "state": "error", "ok": false, "error": error.localizedDescription])
                }
            }
            return nil
        case "epgInfo":
            return json(["importedAt": epg.importedAt(), "count": epg.count(), "importing": epg.importing])
        case "epgNow", "epgRange", "epgSearch":
            let rid = id()
            let ids = s(1).split(separator: ",").prefix(200).map(String.init)
            let (x, y, lim, q) = (n(2), n(3), Int(n(4)), s(1))
            work.async {
                let r: Any
                if name == "epgNow" { r = self.epg.nowNext(ids, at: Int64(x)) }
                else if name == "epgRange" { r = self.epg.range(ids, from: Int64(x), to: Int64(y)) }
                else { r = self.epg.search(q, from: Int64(x), to: Int64(y), limit: lim) }
                self.put(rid, self.json(r))
                self.emit("call", ["id": rid, "ok": true])
            }
            return nil

        // ---------- cache ----------
        case "cacheRead":
            return try? String(contentsOf: file(s(0)), encoding: .utf8)
        case "cacheWrite":
            try? s(1).write(to: file(s(0)), atomically: true, encoding: .utf8)
            return nil

        // ---------- voice: macOS dictation types into the search box instead ----------
        case "voiceStart":
            emit("voice", ["state": "error", "text": "Voice input isn’t available on this device"])
            return nil
        case "voiceStop", "showKeyboard":
            return nil

        // ---------- player ----------
        case "play":
            let url = s(0)
            let opts = (try? JSONSerialization.jsonObject(with: Data(s(1).utf8))) as? [String: Any] ?? [:]
            ui { App.shared.player?.play(url, opts: opts) }
            return nil
        case "stop": ui { App.shared.player?.stop() }; return nil
        case "pause": ui { App.shared.player?.pause(true) }; return nil
        case "resume": ui { App.shared.player?.pause(false) }; return nil
        case "seekBy": let v = n(0); ui { App.shared.player?.seekBy(v) }; return nil
        case "seekTo": let v = n(0); ui { App.shared.player?.seekTo(v) }; return nil
        case "setRect":
            let r = (try? JSONSerialization.jsonObject(with: Data(s(0).utf8))) as? [String: Any]
            ui { App.shared.player?.setRect(r) }
            return nil
        case "setResize": let m = s(0); ui { App.shared.player?.setResize(m) }; return nil
        case "setBuffer": let v = Int(n(0)); ui { App.shared.player?.setBuffer(v) }; return nil
        case "setSpeed": let v = n(0); ui { App.shared.player?.setSpeed(v) }; return nil
        case "tracks": return main { App.shared.player?.tracks() } ?? "{\"audio\":[],\"text\":[]}"
        case "selectTrack": let (t, i) = (s(0), s(1)); ui { App.shared.player?.selectTrack(t, i) }; return nil

        // ---------- other apps ----------
        case "apps":
            var out: [[String: String]] = []
            for (bid, nm) in [("org.videolan.vlc", "VLC"), ("com.colliderli.iina", "IINA"), ("com.firecore.infuse", "Infuse")] {
                if NSWorkspace.shared.urlForApplication(withBundleIdentifier: bid) != nil { out.append(["pkg": bid, "name": nm, "role": "player"]) }
            }
            out.append(["pkg": "browser", "name": "Web browser", "role": "download"])
            return json(out)
        case "openWith":
            let pkg = s(0)
            guard let url = URL(string: s(1)) else { return "false" }
            DispatchQueue.main.async {
                if !pkg.isEmpty, pkg != "browser", let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: pkg) {
                    NSWorkspace.shared.open([url], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration(), completionHandler: nil)
                } else {
                    NSWorkspace.shared.open(url)
                }
            }
            return "true"
        case "copy":
            let t = s(0)
            ui { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(t, forType: .string) }
            return nil
        case "openUrl":
            if let u = URL(string: s(0)) { DispatchQueue.main.async { NSWorkspace.shared.open(u) } }
            return nil
        case "head":
            let rid = id(), url = s(1)
            work.async {
                do {
                    let (size, type) = try Net.head(url)
                    self.emit("head", ["id": rid, "ok": true, "size": size, "type": type])
                } catch {
                    self.emit("head", ["id": rid, "ok": false, "error": "Couldn’t reach the file"])
                }
            }
            return nil
        case "call":
            let rid = id(), method = s(1), url = s(2), headers = s(3), body = s(4)
            work.async {
                do {
                    guard let u = URL(string: url) else { throw URLError(.badURL) }
                    var req = URLRequest(url: u); req.httpMethod = method; req.timeoutInterval = 30
                    if let h = (try? JSONSerialization.jsonObject(with: Data(headers.utf8))) as? [String: Any] {
                        for (k, v) in h { req.setValue("\(v)", forHTTPHeaderField: k) }
                    }
                    if !body.isEmpty && method != "GET" { req.httpBody = Data(body.utf8) }
                    let (d, r) = try Net.request(req)
                    if r.statusCode >= 400 { throw Net.HttpError(code: r.statusCode) }
                    self.put(rid, Net.text(d))
                    self.emit("call", ["id": rid, "ok": true])
                } catch {
                    self.emit("call", ["id": rid, "ok": false, "error": error.localizedDescription])
                }
            }
            return nil

        // ---------- subtitles ----------
        case "subtitleHash":
            let rid = id(), url = s(1)
            work.async {
                let r = try? Net.subtitleHash(url)
                self.emit("head", ["id": rid, "ok": true, "hash": r?.0 ?? "", "size": r?.1 ?? 0])
            }
            return nil
        case "loadSubtitle":
            let url = s(0)
            work.async {
                do {
                    let d = try Net.get(url, timeout: 30)
                    let ext = ["srt", "vtt", "ass", "ssa"].first { url.lowercased().contains(".\($0)") } ?? "srt"
                    let dir = App.caches.appendingPathComponent("subs", isDirectory: true)
                    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                    let f = dir.appendingPathComponent("\(Int(Date().timeIntervalSince1970 * 1000)).\(ext)")
                    try d.write(to: f)
                    DispatchQueue.main.async { App.shared.player?.addSubtitle(f) }
                } catch {
                    self.emit("toast", ["text": "Couldn’t download the subtitles"])
                }
            }
            return nil

        // ---------- phone remote (TV only) and updates ----------
        case "companion":
            return "null"
        case "installUpdate":
            updater.install(s(0)) { e, d in self.emit(e, d) }
            return nil

        default:
            return nil
        }
    }
}

/// Downloads the new app, swaps it in place of this one and restarts.
final class Updater: NSObject, URLSessionDownloadDelegate {
    private var report: ((String, [String: Any]) -> Void)?
    private var busy = false
    private var lastPct = -1

    func install(_ url: String, report: @escaping (String, [String: Any]) -> Void) {
        guard !busy, let u = URL(string: url) else { return }
        let app = Bundle.main.bundleURL
        let parent = app.deletingLastPathComponent()
        if app.path.contains("/AppTranslocation/") || !FileManager.default.isWritableFile(atPath: parent.path) {
            report("update", ["state": "error", "msg": "Move Lumen TV into your Applications folder first, then try again."])
            return
        }
        busy = true
        self.report = report
        lastPct = -1
        let s = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        s.downloadTask(with: u).resume()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else { return }
        let pct = Int(totalBytesWritten * 100 / totalBytesExpectedToWrite)
        if pct != lastPct { lastPct = pct; report?("update", ["state": "downloading", "pct": pct]) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let e = error { busy = false; report?("update", ["state": "error", "msg": e.localizedDescription]) }
        session.finishTasksAndInvalidate()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let fm = FileManager.default
        let work = App.caches.appendingPathComponent("update-\(UUID().uuidString)", isDirectory: true)
        do {
            try fm.createDirectory(at: work, withIntermediateDirectories: true)
            let zip = work.appendingPathComponent("update.zip")
            try fm.moveItem(at: location, to: zip)
            let unzip = Process()
            unzip.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            unzip.arguments = ["-x", "-k", zip.path, work.path]
            try unzip.run(); unzip.waitUntilExit()
            guard let newApp = try fm.contentsOfDirectory(at: work, includingPropertiesForKeys: nil).first(where: { $0.pathExtension == "app" }) else {
                throw NSError(domain: "update", code: 1, userInfo: [NSLocalizedDescriptionKey: "The download didn’t contain the app"])
            }
            report?("update", ["state": "installing"])
            let app = Bundle.main.bundleURL.path
            let script = work.appendingPathComponent("swap.sh")
            let sh = """
            #!/bin/sh
            while kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do sleep 0.3; done
            rm -rf "\(app).old"
            mv "\(app)" "\(app).old" && mv "\(newApp.path)" "\(app)" && rm -rf "\(app).old"
            xattr -dr com.apple.quarantine "\(app)" 2>/dev/null
            open "\(app)"
            """
            try sh.write(to: script, atomically: true, encoding: .utf8)
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/bin/sh")
            p.arguments = [script.path]
            try p.run()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { NSApp.terminate(nil) }
        } catch {
            busy = false
            report?("update", ["state": "error", "msg": error.localizedDescription])
        }
    }
}
