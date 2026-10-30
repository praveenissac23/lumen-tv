import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// Programme guide in SQLite, same tables and answers as the Android EpgStore.
final class EpgStore {
    private var db: OpaquePointer?
    private(set) var importing = false

    init() {
        let path = App.support.appendingPathComponent("epg.db").path
        sqlite3_open_v2(path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil)
        exec("PRAGMA journal_mode=WAL")
        exec("CREATE TABLE IF NOT EXISTS prog (ch TEXT NOT NULL, s INTEGER NOT NULL, e INTEGER NOT NULL, t TEXT NOT NULL, d TEXT NOT NULL DEFAULT '')")
        exec("CREATE INDEX IF NOT EXISTS prog_idx ON prog(ch, s)")
        exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)")
    }

    @discardableResult
    private func exec(_ sql: String) -> Bool { sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK }

    private func query(_ sql: String, _ args: [Any], _ row: (OpaquePointer) -> Void) {
        var st: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &st, nil) == SQLITE_OK, let s = st else { return }
        defer { sqlite3_finalize(s) }
        for (i, a) in args.enumerated() {
            let idx = Int32(i + 1)
            if let n = a as? Int64 { sqlite3_bind_int64(s, idx, n) }
            else if let n = a as? Int { sqlite3_bind_int64(s, idx, Int64(n)) }
            else { sqlite3_bind_text(s, idx, "\(a)", -1, SQLITE_TRANSIENT) }
        }
        while sqlite3_step(s) == SQLITE_ROW { row(s) }
    }

    private func str(_ s: OpaquePointer, _ i: Int32) -> String {
        guard let c = sqlite3_column_text(s, i) else { return "" }
        return String(cString: c)
    }

    private func prog(_ s: OpaquePointer, offset: Int32 = 0) -> [Any] {
        [sqlite3_column_int64(s, offset), sqlite3_column_int64(s, offset + 1), str(s, offset + 2), str(s, offset + 3)]
    }

    func importedAt() -> Int64 {
        var v: Int64 = 0
        query("SELECT v FROM meta WHERE k='importedAt'", []) { s in v = Int64(self.str(s, 0)) ?? 0 }
        return v
    }

    func count() -> Int64 {
        var v: Int64 = 0
        query("SELECT COUNT(*) FROM prog", []) { s in v = sqlite3_column_int64(s, 0) }
        return v
    }

    func nowNext(_ ids: [String], at: Int64) -> [String: Any] {
        var out: [String: Any] = [:]
        for id in ids {
            var cur: Any = NSNull(), nxt: Any = NSNull()
            query("SELECT s, e, t, d FROM prog WHERE ch = ? AND s <= ? AND e > ? ORDER BY s DESC LIMIT 1", [id, at, at]) { s in cur = self.prog(s) }
            query("SELECT s, e, t, d FROM prog WHERE ch = ? AND s > ? ORDER BY s LIMIT 1", [id, at]) { s in nxt = self.prog(s) }
            out[id] = [cur, nxt]
        }
        return out
    }

    func range(_ ids: [String], from: Int64, to: Int64) -> [String: Any] {
        var out: [String: Any] = [:]
        for id in ids {
            var list: [Any] = []
            query("SELECT s, e, t, d FROM prog WHERE ch = ? AND e > ? AND s < ? ORDER BY s LIMIT 400", [id, from, to]) { s in list.append(self.prog(s)) }
            out[id] = list
        }
        return out
    }

    func search(_ q: String, from: Int64, to: Int64, limit: Int) -> [Any] {
        let words = q.lowercased().split(whereSeparator: { $0 == " " || $0 == "\t" }).prefix(4).map(String.init)
        if words.isEmpty { return [] }
        var sql = "SELECT ch, s, e, t, d FROM prog WHERE e > ? AND s < ?"
        var args: [Any] = [from, to]
        for w in words {
            sql += " AND t LIKE ? ESCAPE '\\'"
            let esc = w.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "%", with: "\\%").replacingOccurrences(of: "_", with: "\\_")
            args.append("%" + esc + "%")
        }
        sql += " ORDER BY s LIMIT \(max(1, min(200, limit)))"
        var out: [Any] = []
        query(sql, args) { s in var row: [Any] = [self.str(s, 0)]; row += self.prog(s, offset: 1); out.append(row) }
        return out
    }

    /// Downloads and imports an XMLTV guide; returns programmes kept.
    func importGuide(url: String, from: Int64, to: Int64, wanted: Set<String>?, progress: @escaping (Int) -> Void) throws -> Int {
        importing = true
        defer { importing = false }
        let file = try Net.download(url, timeout: 600)
        defer { try? FileManager.default.removeItem(at: file) }
        exec("DROP TABLE IF EXISTS prog_new")
        exec("CREATE TABLE prog_new (ch TEXT NOT NULL, s INTEGER NOT NULL, e INTEGER NOT NULL, t TEXT NOT NULL, d TEXT NOT NULL DEFAULT '')")
        var st: OpaquePointer?
        guard sqlite3_prepare_v2(db, "INSERT INTO prog_new(ch, s, e, t, d) VALUES (?, ?, ?, ?, ?)", -1, &st, nil) == SQLITE_OK, let ins = st else {
            throw NSError(domain: "epg", code: 1, userInfo: [NSLocalizedDescriptionKey: "Guide database error"])
        }
        defer { sqlite3_finalize(ins) }
        guard let stream = InputStream(url: file) else { throw URLError(.cannotOpenFile) }
        let p = XmltvParser(from: from, to: to, wanted: wanted)
        var total = 0
        exec("BEGIN")
        p.onProgramme = { ch, s, e, t, d in
            sqlite3_reset(ins)
            sqlite3_bind_text(ins, 1, ch, -1, SQLITE_TRANSIENT)
            sqlite3_bind_int64(ins, 2, s)
            sqlite3_bind_int64(ins, 3, e)
            sqlite3_bind_text(ins, 4, t, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(ins, 5, d, -1, SQLITE_TRANSIENT)
            sqlite3_step(ins)
            total += 1
            if total % 5000 == 0 { self.exec("COMMIT"); self.exec("BEGIN"); progress(total) }
            return total < 2_000_000
        }
        let parser = XMLParser(stream: stream)
        parser.delegate = p
        let ok = parser.parse()
        exec("COMMIT")
        if !ok && total == 0 {
            exec("DROP TABLE IF EXISTS prog_new")
            throw NSError(domain: "epg", code: 2, userInfo: [NSLocalizedDescriptionKey: parser.parserError?.localizedDescription ?? "The guide file couldn’t be read"])
        }
        exec("BEGIN")
        exec("DROP TABLE IF EXISTS prog")
        exec("CREATE INDEX prog_idx ON prog_new(ch, s)")
        exec("ALTER TABLE prog_new RENAME TO prog")
        exec("INSERT OR REPLACE INTO meta(k, v) VALUES ('importedAt', '\(Int64(Date().timeIntervalSince1970 * 1000))')")
        exec("COMMIT")
        return total
    }
}

/// Streaming XMLTV reader: <programme channel start stop><title/><desc/></programme>
final class XmltvParser: NSObject, XMLParserDelegate {
    let from: Int64, to: Int64, wanted: Set<String>?
    var onProgramme: ((String, Int64, Int64, String, String) -> Bool)?
    private var ch = "", s: Int64 = 0, e: Int64 = 0, keep = false
    private var title: String? = nil, desc: String? = nil
    private var field = 0   // 1 title, 2 desc
    private var text = ""

    init(from: Int64, to: Int64, wanted: Set<String>?) { self.from = from; self.to = to; self.wanted = wanted }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        switch name {
        case "programme":
            ch = attributes["channel"] ?? ""
            keep = !ch.isEmpty && (wanted == nil || wanted!.contains(ch))
            if keep {
                s = XmltvParser.time(attributes["start"])
                e = XmltvParser.time(attributes["stop"])
                if e == 0 { e = s + 1800 }
                keep = s > 0 && e >= from && s <= to
            }
            title = nil; desc = nil; field = 0
        case "title": if keep && title == nil { field = 1; text = "" }
        case "desc": if keep && desc == nil { field = 2; text = "" }
        default: break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { if field != 0 { text += string } }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        switch name {
        case "title": if field == 1 { title = text; field = 0 }
        case "desc": if field == 2 { desc = String(text.prefix(160)); field = 0 }
        case "programme":
            if keep, let cb = onProgramme, !cb(ch, s, e, title ?? "", desc ?? "") { parser.abortParsing() }
            keep = false
        default: break
        }
    }

    /// "20240101123000 +0400" -> Unix seconds
    static func time(_ v: String?) -> Int64 {
        guard let v = v else { return 0 }
        let b = Array(v.utf8)
        guard b.count >= 14 else { return 0 }
        func n(_ a: Int, _ z: Int) -> Int32 {
            var x: Int32 = 0
            for i in a..<z { let d = Int32(b[i]) - 48; if d < 0 || d > 9 { return -1 }; x = x * 10 + d }
            return x
        }
        var t = tm()
        t.tm_year = n(0, 4) - 1900; t.tm_mon = n(4, 6) - 1; t.tm_mday = n(6, 8)
        t.tm_hour = n(8, 10); t.tm_min = n(10, 12); t.tm_sec = n(12, 14)
        var secs = Int64(timegm(&t))
        let rest = String(decoding: b[14...], as: UTF8.self).trimmingCharacters(in: .whitespaces)
        if rest.count >= 5, let sign = rest.first, sign == "+" || sign == "-" {
            let digits = Array(rest.dropFirst().prefix(4))
            if digits.count == 4, let hh = Int(String(digits[0...1])), let mm = Int(String(digits[2...3])) {
                let off = Int64(hh * 3600 + mm * 60)
                secs += sign == "+" ? -off : off
            }
        }
        return secs
    }
}

/// Xtream catalogue lists reduced to the fields the interface uses (same mapping as Android's Catalog.kt).
enum Catalog {
    static let fields: [String: [String: String]] = [
        "live": ["stream_id": "id", "num": "num", "name": "name", "category_id": "cat", "stream_icon": "logo",
                 "epg_channel_id": "epg", "tv_archive": "arch", "tv_archive_duration": "archDays"],
        "movie": ["stream_id": "id", "name": "name", "category_id": "cat", "stream_icon": "img", "rating_5based": "r5",
                  "rating": "r", "year": "year", "releaseDate": "date", "added": "added", "container_extension": "ext"],
        "series": ["series_id": "id", "name": "name", "category_id": "cat", "cover": "img", "rating_5based": "r5",
                   "releaseDate": "date", "release_date": "date", "last_modified": "added", "plot": "plot", "genre": "genre"],
    ]

    static func fetch(url: String, kind: String, dest: URL) throws -> Int {
        let file = try Net.download(url, timeout: 600)
        defer { try? FileManager.default.removeItem(at: file) }
        let data = try Data(contentsOf: file, options: .mappedIfSafe)
        let map = fields[kind] ?? fields["series"]!
        var out: [[String: Any]] = []
        if let arr = (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) as? [Any] {
            out.reserveCapacity(arr.count)
            for item in arr {
                guard let o = item as? [String: Any] else { continue }
                var c: [String: Any] = [:]
                for (from, to) in map {
                    guard let v = o[from] else { continue }
                    if var s = v as? String {
                        if to == "plot" && s.count > 300 { s = String(s.prefix(300)) }
                        c[to] = s
                    } else if let n = v as? NSNumber {
                        if n.doubleValue.isFinite { c[to] = n }
                    }
                }
                out.append(c)
            }
        }
        let json = try JSONSerialization.data(withJSONObject: out)
        try json.write(to: dest, options: .atomic)
        return out.count
    }
}
