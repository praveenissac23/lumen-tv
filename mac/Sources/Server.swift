import Foundation
import Darwin

/// Tiny HTTP server on 127.0.0.1 only. It serves the interface files, downscaled thumbnails,
/// and the bridge: the page calls POST /native/<method>?t=<token> with a JSON array of arguments
/// (synchronous XHR, so methods can return values exactly like Android's window.Native).
final class Server {
    private let token: String
    private let bridge: Bridge
    private var fd: Int32 = -1
    private let thumbs = Thumbs()

    init(token: String, bridge: Bridge) { self.token = token; self.bridge = bridge }

    func start() -> Int? {
        for port in [47613, 47614, 47615, 47616, 0] {
            let s = socket(AF_INET, SOCK_STREAM, 0)
            if s < 0 { continue }
            var yes: Int32 = 1
            setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
            var addr = sockaddr_in()
            addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            addr.sin_family = sa_family_t(AF_INET)
            addr.sin_port = in_port_t(UInt16(port).bigEndian)
            addr.sin_addr.s_addr = inet_addr("127.0.0.1")
            let ok = withUnsafePointer(to: &addr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
            }
            if ok != 0 || listen(s, 128) != 0 { close(s); continue }
            var bound = sockaddr_in(); var len = socklen_t(MemoryLayout<sockaddr_in>.size)
            _ = withUnsafeMutablePointer(to: &bound) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(s, $0, &len) } }
            fd = s
            let actual = Int(UInt16(bigEndian: bound.sin_port))
            let t = Thread { [weak self] in self?.acceptLoop(s) }
            t.name = "lumen-server"; t.start()
            return actual
        }
        return nil
    }

    func stop() { if fd >= 0 { close(fd); fd = -1 } }

    private func acceptLoop(_ s: Int32) {
        while true {
            let c = accept(s, nil, nil)
            if c < 0 { if fd < 0 { return }; continue }
            var yes: Int32 = 1
            setsockopt(c, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size))
            DispatchQueue.global(qos: .userInitiated).async { self.handle(c) }
        }
    }

    // ---------- one request per connection ----------
    private func handle(_ c: Int32) {
        defer { close(c) }
        let cap = 65536
        var buf = [UInt8](repeating: 0, count: cap)
        var data = Data()
        var headerEnd: Range<Data.Index>? = nil
        let sep = Data([13, 10, 13, 10])
        while headerEnd == nil {
            let n = read(c, &buf, cap)
            if n <= 0 { return }
            data.append(buf, count: n)
            headerEnd = data.range(of: sep)
            if data.count > 1_000_000 && headerEnd == nil { return }
        }
        guard let he = headerEnd, let head = String(data: data[data.startIndex..<he.lowerBound], encoding: .utf8) else { return }
        let lines = head.components(separatedBy: "\r\n")
        let parts = lines[0].split(separator: " ")
        guard parts.count >= 2 else { return }
        let method = String(parts[0]), target = String(parts[1])
        var length = 0
        for l in lines.dropFirst() {
            let kv = l.split(separator: ":", maxSplits: 1)
            if kv.count == 2 && kv[0].lowercased() == "content-length" { length = Int(kv[1].trimmingCharacters(in: .whitespaces)) ?? 0 }
        }
        var body = Data(data[he.upperBound...])
        while body.count < length {
            let want = min(cap, length - body.count)
            let n = read(c, &buf, want)
            if n <= 0 { break }
            body.append(buf, count: n)
        }
        let comps = URLComponents(string: "http://x" + target)
        let path = comps?.path ?? "/"
        let query = Dictionary((comps?.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })

        if path.hasPrefix("/native/") && method == "POST" {
            guard query["t"] == token else { respond(c, 403, "text/plain", Data("forbidden".utf8)); return }
            let name = String(path.dropFirst("/native/".count))
            let args = (try? JSONSerialization.jsonObject(with: body)) as? [Any] ?? []
            let result = bridge.call(name, args)
            if let r = result { respond(c, 200, "text/plain; charset=utf-8", Data(r.utf8)) }
            else { respond(c, 204, "text/plain", Data()) }
            return
        }
        if path == "/thumb" {
            let w = Int(query["w"] ?? "") ?? 320
            if let src = query["u"], let r = thumbs.serve(src, width: w) {
                respond(c, 200, r.type, r.data, cache: true)
            } else { respond(c, 404, "text/plain", Data()) }
            return
        }
        serveFile(c, path)
    }

    private func serveFile(_ c: Int32, _ rawPath: String) {
        var p = rawPath.removingPercentEncoding ?? rawPath
        if p == "/" || p.isEmpty { p = "/index.html" }
        if p.contains("..") { respond(c, 400, "text/plain", Data()); return }
        let url = App.webRoot.appendingPathComponent(String(p.dropFirst()))
        guard let d = try? Data(contentsOf: url) else { respond(c, 404, "text/plain", Data("not found".utf8)); return }
        let types = ["html": "text/html; charset=utf-8", "js": "application/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
                     "woff2": "font/woff2", "png": "image/png", "jpg": "image/jpeg", "svg": "image/svg+xml", "mp4": "video/mp4", "json": "application/json"]
        respond(c, 200, types[url.pathExtension.lowercased()] ?? "application/octet-stream", d)
    }

    private func respond(_ c: Int32, _ code: Int, _ type: String, _ body: Data, cache: Bool = false) {
        let reason = [200: "OK", 204: "No Content", 400: "Bad Request", 403: "Forbidden", 404: "Not Found"][code] ?? "OK"
        var h = "HTTP/1.1 \(code) \(reason)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nConnection: close\r\n"
        h += cache ? "Cache-Control: max-age=2592000\r\n" : "Cache-Control: no-store\r\n"
        h += "\r\n"
        var out = Data(h.utf8); out.append(body)
        out.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            guard let base = raw.baseAddress else { return }
            var sent = 0
            while sent < raw.count {
                let n = write(c, base + sent, raw.count - sent)
                if n <= 0 { break }
                sent += n
            }
        }
    }
}
