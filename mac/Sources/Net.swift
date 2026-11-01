import Foundation
import AppKit
import ImageIO

/// Blocking HTTP helpers for background threads (the bridge answers from worker threads).
enum Net {
    static let userAgent = "VLC/3.0.20 LibVLC/3.0.20"   // many IPTV servers only accept player user agents

    struct HttpError: Error, LocalizedError {
        let code: Int
        var errorDescription: String? { "HTTP \(code)" }
    }

    static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.httpAdditionalHeaders = ["User-Agent": userAgent]
        c.timeoutIntervalForRequest = 45
        c.timeoutIntervalForResource = 1800
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.urlCache = nil
        c.httpMaximumConnectionsPerHost = 6
        return URLSession(configuration: c)
    }()

    static func request(_ req: URLRequest) throws -> (Data, HTTPURLResponse) {
        let sem = DispatchSemaphore(value: 0)
        var d: Data? = nil, r: URLResponse? = nil, err: Error? = nil
        session.dataTask(with: req) { a, b, c in d = a; r = b; err = c; sem.signal() }.resume()
        sem.wait()
        if let e = err { throw e }
        guard let http = r as? HTTPURLResponse, let body = d else { throw URLError(.badServerResponse) }
        return (body, http)
    }

    static func get(_ url: String, timeout: Double = 45) throws -> Data {
        guard let u = URL(string: url) else { throw URLError(.badURL) }
        var req = URLRequest(url: u)
        req.timeoutInterval = timeout
        let (d, r) = try request(req)
        if r.statusCode >= 400 { throw HttpError(code: r.statusCode) }
        return d
    }

    static func text(_ d: Data) -> String {
        String(data: d, encoding: .utf8) ?? String(data: d, encoding: .isoLatin1) ?? ""
    }

    /// Downloads to a temporary file (for big catalogue and guide files).
    static func download(_ url: String, timeout: Double = 300) throws -> URL {
        guard let u = URL(string: url) else { throw URLError(.badURL) }
        var req = URLRequest(url: u)
        req.timeoutInterval = timeout
        let sem = DispatchSemaphore(value: 0)
        var out: URL? = nil, err: Error? = nil, code = 0
        let dest = App.caches.appendingPathComponent("dl-\(UUID().uuidString)")
        session.downloadTask(with: req) { loc, resp, e in
            err = e
            code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if let loc = loc {
                do { try FileManager.default.moveItem(at: loc, to: dest); out = dest } catch { err = error }
            }
            sem.signal()
        }.resume()
        sem.wait()
        if let e = err { throw e }
        if code >= 400 { try? FileManager.default.removeItem(at: dest); throw HttpError(code: code) }
        guard let f = out else { throw URLError(.cannotCreateFile) }
        return f
    }

    /// Size and type of a remote file (HEAD, falling back to a one-byte range request).
    static func head(_ url: String) throws -> (Int64, String) {
        guard let u = URL(string: url) else { throw URLError(.badURL) }
        var req = URLRequest(url: u); req.httpMethod = "HEAD"; req.timeoutInterval = 20
        if let res = try? request(req), res.1.statusCode < 400, res.1.expectedContentLength > 0 {
            return (res.1.expectedContentLength, res.1.mimeType ?? "")
        }
        var g = URLRequest(url: u); g.setValue("bytes=0-0", forHTTPHeaderField: "Range"); g.timeoutInterval = 20
        let (_, r) = try request(g)
        if r.statusCode >= 400 { throw HttpError(code: r.statusCode) }
        if let cr = r.value(forHTTPHeaderField: "Content-Range"), let total = cr.split(separator: "/").last, let n = Int64(total) {
            return (n, r.mimeType ?? "")
        }
        return (r.expectedContentLength, r.mimeType ?? "")
    }

    static func range(_ url: String, _ from: Int64, _ to: Int64) throws -> Data {
        guard let u = URL(string: url) else { throw URLError(.badURL) }
        var g = URLRequest(url: u); g.setValue("bytes=\(from)-\(to)", forHTTPHeaderField: "Range"); g.timeoutInterval = 30
        let (d, r) = try request(g)
        if r.statusCode >= 400 { throw HttpError(code: r.statusCode) }
        return d
    }

    /// OpenSubtitles hash: file size + 64-bit sums of the first and last 64 KB.
    static func subtitleHash(_ url: String) throws -> (String, Int64) {
        let (size, _) = try head(url)
        guard size > 131072 else { throw URLError(.cannotParseResponse) }
        let a = try range(url, 0, 65535)
        let b = try range(url, size - 65536, size - 1)
        var h = UInt64(bitPattern: size)
        for chunk in [a.prefix(65536), b.prefix(65536)] {
            let bytes = [UInt8](chunk)
            var i = 0
            while i + 8 <= bytes.count {
                var v: UInt64 = 0
                for k in 0..<8 { v |= UInt64(bytes[i + k]) << (8 * UInt64(k)) }
                h = h &+ v
                i += 8
            }
        }
        return (String(format: "%016llx", h), size)
    }
}

/// Channel logos and posters, downscaled once and cached on disk.
final class Thumbs {
    private let dir = App.caches.appendingPathComponent("thumbs", isDirectory: true)
    private let gate = DispatchSemaphore(value: 8)

    init() {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        DispatchQueue.global(qos: .background).async { [dir] in
            let cutoff = Date().addingTimeInterval(-30 * 86400)
            let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
            for f in files {
                if let d = (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate, d < cutoff {
                    try? FileManager.default.removeItem(at: f)
                }
            }
        }
    }

    func serve(_ src: String, width: Int) -> (data: Data, type: String)? {
        let w = max(48, min(1280, width))
        let key = String(format: "%08x", UInt32(truncatingIfNeeded: src.hashValueStable)) + "_\(w)_\(src.count)"
        let jpg = dir.appendingPathComponent(key + ".jpg"), png = dir.appendingPathComponent(key + ".png")
        if let d = try? Data(contentsOf: jpg) { return (d, "image/jpeg") }
        if let d = try? Data(contentsOf: png) { return (d, "image/png") }
        gate.wait(); defer { gate.signal() }
        var fetchURL = src
        if src.contains("image.tmdb.org/t/p/"), let r = src.range(of: #"/t/p/[^/]+/"#, options: .regularExpression) {
            let size = w <= 185 ? "w185" : w <= 342 ? "w342" : w <= 500 ? "w500" : "w780"
            fetchURL = src.replacingCharacters(in: r, with: "/t/p/\(size)/")
        }
        var got: Data? = try? Net.get(fetchURL, timeout: 8)
        if got == nil && fetchURL != src { got = try? Net.get(src, timeout: 8) }
        guard let raw = got, raw.count < 8_000_000,
              let isrc = CGImageSourceCreateWithData(raw as CFData, nil) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: w * 3 / 2,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(isrc, 0, opts as CFDictionary) else { return nil }
        let rep = NSBitmapImageRep(cgImage: cg)
        let alpha: Bool
        switch cg.alphaInfo { case .none, .noneSkipFirst, .noneSkipLast: alpha = false; default: alpha = true }
        if alpha, let d = rep.representation(using: .png, properties: [:]) {
            try? d.write(to: png, options: .atomic); return (d, "image/png")
        }
        guard let d = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.82]) else { return nil }
        try? d.write(to: jpg, options: .atomic)
        return (d, "image/jpeg")
    }
}

extension String {
    /// Same value on every launch (Swift's hashValue is randomised per process).
    var hashValueStable: UInt64 {
        var h: UInt64 = 1469598103934665603
        for b in utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
        return h
    }
}
