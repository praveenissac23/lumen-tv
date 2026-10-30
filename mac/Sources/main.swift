import Cocoa
import WebKit

/// Lumen TV for Mac: the same interface as the TV app, drawn by a WKWebView over a VLC video view.
/// The page talks to this app through a small HTTP server on 127.0.0.1 (see Server.swift / Bridge.swift).
final class RootView: NSView {
    override var isFlipped: Bool { true }          // top-left origin, like the web page
    override func layout() { super.layout(); App.shared?.player?.layout() }
}

final class App: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    static var shared: App!

    var window: NSWindow!
    var web: WKWebView!
    var videoView: NSView!
    var player: Player?
    var server: Server!
    var bridge: Bridge!
    let token = UUID().uuidString.replacingOccurrences(of: "-", with: "")
    private var activity: NSObjectProtocol?

    static let support: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let u = base.appendingPathComponent("LumenTV", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
    static let caches: URL = {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let u = base.appendingPathComponent("LumenTV", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
    static var webRoot: URL { Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true) }
    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0" }
    static var build: Int { Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1") ?? 1 }

    func applicationDidFinishLaunching(_ notification: Notification) {
        App.shared = self
        buildMenu()

        let frame = NSRect(x: 0, y: 0, width: 1280, height: 720)
        window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Lumen TV"
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = .black
        window.contentAspectRatio = NSSize(width: 16, height: 9)
        window.minSize = NSSize(width: 800, height: 450)
        window.collectionBehavior = [.fullScreenPrimary]
        window.setFrameAutosaveName("LumenMain")

        let root = RootView(frame: frame)
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor.black.cgColor
        root.layer?.masksToBounds = true

        // Video under the page
        videoView = NSView(frame: .zero)
        videoView.wantsLayer = true
        videoView.layer?.backgroundColor = NSColor.black.cgColor
        videoView.isHidden = true
        root.addSubview(videoView)

        // The interface on top, see-through where the video plays
        let cfg = WKWebViewConfiguration()
        let shim = (try? String(contentsOf: Bundle.main.url(forResource: "shim", withExtension: "js")!, encoding: .utf8)) ?? ""
        cfg.userContentController.addUserScript(WKUserScript(source: shim.replacingOccurrences(of: "__TOKEN__", with: token),
                                                             injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        web = WKWebView(frame: frame, configuration: cfg)
        web.setValue(false, forKey: "drawsBackground")
        if #available(macOS 12.0, *) { web.underPageBackgroundColor = .clear }
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.uiDelegate = self
        root.addSubview(web)

        window.contentView = root
        if !window.setFrameUsingName("LumenMain") { window.center() }
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(web)

        player = Player(view: videoView, emit: emit)
        bridge = Bridge()
        server = Server(token: token, bridge: bridge)
        guard let port = server.start() else {
            let a = NSAlert(); a.messageText = "Lumen TV couldn’t start"; a.informativeText = "No local port was free for the interface."; a.runModal()
            NSApp.terminate(nil); return
        }
        web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/index.html")!))
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        player?.stop()
        server?.stop()
    }

    /// Sends an event to the page: window.__nat(evt, data)
    func emit(_ evt: String, _ data: [String: Any]) {
        let json = (try? JSONSerialization.data(withJSONObject: data)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        let js = "window.__nat&&window.__nat(\"\(evt)\",\(json))"
        DispatchQueue.main.async { self.web?.evaluateJavaScript(js, completionHandler: nil) }
    }

    /// Keep the display awake while something plays.
    func keepAwake(_ on: Bool) {
        if on, activity == nil {
            activity = ProcessInfo.processInfo.beginActivity(options: [.idleDisplaySleepDisabled, .userInitiated], reason: "Playing video")
        } else if !on, let a = activity {
            ProcessInfo.processInfo.endActivity(a); activity = nil
        }
    }

    // Only our own pages load in the window; anything else opens in the browser.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = action.request.url, u.host == "127.0.0.1" || u.scheme == "about" { decisionHandler(.allow); return }
        if let u = action.request.url { NSWorkspace.shared.open(u) }
        decisionHandler(.cancel)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // ---------- menus ----------
    private func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Lumen TV", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Lumen TV", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Lumen TV", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        // Edit menu: copy/paste in text fields, and macOS adds "Start Dictation" here.
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View")
        let fs = NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.control, .command]
        view.addItem(fs)
        let fs2 = NSMenuItem(title: "Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs2.keyEquivalentModifierMask = [.command]
        view.addItem(fs2)
        view.addItem(withTitle: "Reload Interface", action: #selector(reloadPage), keyEquivalent: "r")
        viewItem.submenu = view

        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimise", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winItem.submenu = win
        NSApp.windowsMenu = win

        NSApp.mainMenu = main
    }

    @objc func reloadPage() { web.reload() }
}

let application = NSApplication.shared
let appDelegate = App()
application.delegate = appDelegate
application.setActivationPolicy(.regular)
application.run()
