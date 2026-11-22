import Cocoa
import WebKit
import MediaPlayer
import UniformTypeIdentifiers
import Speech
import AVFoundation

class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var backendProcess: Process?
    var speechRecognizer: SFSpeechRecognizer?
    var speechAudioEngine: AVAudioEngine?
    var speechRecognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    var speechRecognitionTask: SFSpeechRecognitionTask?
    let serverURL = URL(string: "http://127.0.0.1:8000")!
    let workspacePath: String = {
        let bundleParent = Bundle.main.bundleURL.deletingLastPathComponent().path
        if FileManager.default.fileExists(atPath: "\(bundleParent)/backend/main.py") {
            return bundleParent
        }
        let cwd = FileManager.default.currentDirectoryPath
        if FileManager.default.fileExists(atPath: "\(cwd)/backend/main.py") {
            return cwd
        }
        let defaultPath = "/Users/aaradhya/Documents/Programming/random"
        if FileManager.default.fileExists(atPath: "\(defaultPath)/backend/main.py") {
            return defaultPath
        }
        return bundleParent
    }()
    let appVersion: String = {
        if let ver = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String, !ver.isEmpty {
            return ver
        }
        return "7.7.0"
    }()
    let githubRepo = "AaradhyaNegi009/UpBeat"

    var updateTimer: Timer?
    var isUpdating = false
    var backgroundActivity: NSObjectProtocol?
    var pendingDeepLinks: [String] = []
    var isMainAppLoaded = false
    var hasInstalledSpeechTap = false
    var cachedArtworkUrl = ""
    var cachedArtworkImage: NSImage?

    var statusItem: NSStatusItem!
    var playPauseMenuItem: NSMenuItem!
    var trackTitleMenuItem: NSMenuItem!
    var currentTrackTitle = "UpBeat"
    var currentArtist = ""
    var isPlayingAudio = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.appearance = NSAppearance(named: .darkAqua)

        // Prevent macOS App Nap from throttling or suspending background playback
        backgroundActivity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiatedAllowingIdleSystemSleep, .latencyCritical],
            reason: "UpBeat Background Music Playback"
        )

        setupMenu()
        setupStatusBarItem()
        setupRemoteCommands()

        let screenRect = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1360, height: 860)
        let width: CGFloat = min(1380, screenRect.width * 0.92)
        let height: CGFloat = min(860, screenRect.height * 0.90)
        let rect = NSRect(
            x: screenRect.origin.x + (screenRect.width - width) / 2,
            y: screenRect.origin.y + (screenRect.height - height) / 2,
            width: width,
            height: height
        )

        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "UpBeat"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(calibratedRed: 0.051, green: 0.051, blue: 0.059, alpha: 1.0)
        window.minSize = NSSize(width: 900, height: 600)
        window.delegate = self

        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        if #available(macOS 10.15, *) {
            config.allowsAirPlayForMediaPlayback = true
        }
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.userContentController.add(self, name: "upbeatNative")

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15 UpBeatMac/\(appVersion)"

        window.contentView?.addSubview(webView)
        showStartupSplash()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        ensureBackendAndLoad()

        // Background check for updates 6 seconds after launch, then every 3 hours
        DispatchQueue.main.asyncAfter(deadline: .now() + 6.0) { [weak self] in
            self?.checkForUpdates(silent: true)
        }
        updateTimer = Timer.scheduledTimer(withTimeInterval: 10800, repeats: true) { [weak self] _ in
            self?.checkForUpdates(silent: true)
        }
    }

    func setupStatusBarItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.title = "♫"
            button.toolTip = "UpBeat Music Studio"
        }

        let menu = NSMenu()
        trackTitleMenuItem = NSMenuItem(title: "UpBeat: Ready", action: nil, keyEquivalent: "")
        trackTitleMenuItem.isEnabled = false
        menu.addItem(trackTitleMenuItem)
        menu.addItem(NSMenuItem.separator())

        playPauseMenuItem = NSMenuItem(title: "Play", action: #selector(togglePlayFromMenu), keyEquivalent: " ")
        menu.addItem(playPauseMenuItem)

        menu.addItem(NSMenuItem(title: "Next Track", action: #selector(nextTrackFromMenu), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Previous Track", action: #selector(prevTrackFromMenu), keyEquivalent: ""))

        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Open UpBeat Window", action: #selector(showMainWindow), keyEquivalent: "o")
        menu.addItem(withTitle: "Quit UpBeat", action: #selector(quitApp), keyEquivalent: "q")

        statusItem.menu = menu
    }

    @objc func togglePlayFromMenu() {
        webView.evaluateJavaScript("window.UpBeatControls?.togglePlay?.()")
    }

    @objc func nextTrackFromMenu() {
        webView.evaluateJavaScript("window.UpBeatControls?.next?.()")
    }

    @objc func prevTrackFromMenu() {
        webView.evaluateJavaScript("window.UpBeatControls?.prev?.()")
    }

    @objc func showMainWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func quitApp() {
        NSApplication.shared.terminate(nil)
    }

    func setupRemoteCommands() {
        let commandCenter = MPRemoteCommandCenter.shared()

        commandCenter.playCommand.isEnabled = true
        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.webView.evaluateJavaScript("window.UpBeatControls?.play?.()")
            return .success
        }

        commandCenter.pauseCommand.isEnabled = true
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.webView.evaluateJavaScript("window.UpBeatControls?.pause?.()")
            return .success
        }

        commandCenter.togglePlayPauseCommand.isEnabled = true
        commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.webView.evaluateJavaScript("window.UpBeatControls?.togglePlay?.()")
            return .success
        }

        commandCenter.nextTrackCommand.isEnabled = true
        commandCenter.nextTrackCommand.addTarget { [weak self] _ in
            self?.webView.evaluateJavaScript("window.UpBeatControls?.next?.()")
            return .success
        }

        commandCenter.previousTrackCommand.isEnabled = true
        commandCenter.previousTrackCommand.addTarget { [weak self] _ in
            self?.webView.evaluateJavaScript("window.UpBeatControls?.prev?.()")
            return .success
        }

        commandCenter.changePlaybackPositionCommand.isEnabled = true
        commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            if let pos = event as? MPChangePlaybackPositionCommandEvent {
                self?.webView.evaluateJavaScript("window.UpBeatControls?.seekTo?.(\(pos.positionTime))")
                return .success
            }
            return .commandFailed
        }
    }

    private func jsLiteral(_ value: String) -> String {
        if let data = try? JSONSerialization.data(withJSONObject: [value]),
           let json = String(data: data, encoding: .utf8),
           json.count >= 2 {
            return String(json.dropFirst().dropLast())
        }
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
        return "\"\(escaped)\""
    }

    private func isAllowedArtworkHost(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        let host = (url.host ?? "").lowercased()
        if scheme == "http" && (host == "127.0.0.1" || host == "localhost") {
            return true
        }
        guard scheme == "https" else { return false }
        let allowedHosts: Set<String> = [
            "i.ytimg.com",
            "i1.ytimg.com",
            "yt3.ggpht.com",
            "lh3.googleusercontent.com"
        ]
        return allowedHosts.contains(host)
    }

    func updateNowPlayingInfo(title: String, artist: String, thumbnailUrl: String, duration: Double, currentTime: Double, isPlaying: Bool) {
        var info = [String: Any]()
        info[MPMediaItemPropertyTitle] = title
        info[MPMediaItemPropertyArtist] = artist.isEmpty ? "UpBeat" : artist
        info[MPMediaItemPropertyAlbumTitle] = "UpBeat"
        if duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        }
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0

        if !thumbnailUrl.isEmpty, thumbnailUrl == cachedArtworkUrl, let img = cachedArtworkImage {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
        } else if !thumbnailUrl.isEmpty,
                  thumbnailUrl != cachedArtworkUrl,
                  let artURL = URL(string: thumbnailUrl),
                  isAllowedArtworkHost(artURL) {
            cachedArtworkUrl = thumbnailUrl
            cachedArtworkImage = nil
            var artReq = URLRequest(url: artURL)
            artReq.timeoutInterval = 4.0
            URLSession.shared.dataTask(with: artReq) { [weak self] data, response, _ in
                guard let self = self,
                      let http = response as? HTTPURLResponse,
                      http.statusCode == 200,
                      let d = data,
                      let img = NSImage(data: d) else { return }
                DispatchQueue.main.async {
                    guard self.cachedArtworkUrl == thumbnailUrl else { return }
                    self.cachedArtworkImage = img
                    var currentInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? info
                    currentInfo[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
                    MPNowPlayingInfoCenter.default().nowPlayingInfo = currentInfo
                }
            }.resume()
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "upbeatNative",
              let body = message.body as? [String: Any] else { return }

        if let action = body["action"] as? String {
            if action == "retryBackend" {
                DispatchQueue.main.async { [weak self] in
                    self?.ensureBackendAndLoad()
                }
                return
            } else if action == "pickProfilePhoto" {
                DispatchQueue.main.async { [weak self] in
                    self?.presentNativeProfilePhotoPicker()
                }
                return
            } else if action == "startSpeechRecognition" {
                let lang = (body["lang"] as? String) ?? "en-US"
                DispatchQueue.main.async { [weak self] in
                    self?.startNativeSpeechRecognition(lang: lang)
                }
                return
            } else if action == "stopSpeechRecognition" {
                DispatchQueue.main.async { [weak self] in
                    self?.stopNativeSpeechRecognition()
                }
                return
            }
        }

        let isPlaying = (body["isPlaying"] as? Bool) ?? false
        let title = (body["title"] as? String) ?? "UpBeat"
        let artist = (body["artist"] as? String) ?? ""
        let thumbnail = (body["thumbnail"] as? String) ?? ""
        let duration = (body["duration"] as? Double) ?? 0
        let currentTime = (body["currentTime"] as? Double) ?? 0

        self.isPlayingAudio = isPlaying
        self.currentTrackTitle = title
        self.currentArtist = artist

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if let button = self.statusItem?.button {
                if isPlaying {
                    let cleanTitle = title.count > 18 ? String(title.prefix(18)) + "…" : title
                    button.title = "▶ \(cleanTitle)"
                } else {
                    button.title = "♫"
                }
            }
            self.trackTitleMenuItem?.title = artist.isEmpty ? title : "\(title) — \(artist)"
            self.playPauseMenuItem?.title = isPlaying ? "Pause" : "Play"

            self.updateNowPlayingInfo(
                title: title,
                artist: artist,
                thumbnailUrl: thumbnail,
                duration: duration,
                currentTime: currentTime,
                isPlaying: isPlaying
            )
        }
    }

    // Keep app running in background when window is closed (like Spotify / Apple Music)
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        return true
    }

    private func isAllowedDeepLink(_ url: URL) -> Bool {
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "upbeat" {
            return true
        }
        if scheme == "http" || scheme == "https" {
            let str = url.absoluteString
            return str.contains("addFriend=") || str.contains("jam=")
        }
        return false
    }

    func queueDeepLink(_ url: URL) {
        guard isAllowedDeepLink(url) else { return }
        let urlString = url.absoluteString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !urlString.isEmpty else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.pendingDeepLinks.append(urlString)
            if self.isMainAppLoaded {
                self.flushPendingDeepLinks(attempt: 0)
            }
        }
    }

    func flushPendingDeepLinks(attempt: Int = 0) {
        guard isMainAppLoaded, !pendingDeepLinks.isEmpty, webView != nil else { return }
        let batch = pendingDeepLinks
        var js = "(function() { var root = document.getElementById('root'); if (!root || root.childElementCount === 0) return 'retry';"
        for link in batch {
            js += " window.dispatchEvent(new CustomEvent('upbeat-deep-link', { detail: \(jsLiteral(link)) }));"
        }
        js += " return 'ok'; })();"

        webView.evaluateJavaScript(js) { [weak self] result, _ in
            guard let self = self else { return }
            if let status = result as? String, status == "ok" {
                self.pendingDeepLinks.removeFirst(min(batch.count, self.pendingDeepLinks.count))
            } else if attempt < 30 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                    self?.flushPendingDeepLinks(attempt: attempt + 1)
                }
            }
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            queueDeepLink(url)
        }
    }

    func setupMenu() {
        let mainMenu = NSMenu()

        // App Menu
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About UpBeat (v\(appVersion))", action: #selector(showAboutPanel), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Check for Updates...", action: #selector(menuCheckForUpdates), keyEquivalent: "u")
        appMenu.addItem(withTitle: "Update Studio Now", action: #selector(menuRunSelfUpdate), keyEquivalent: "U")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Reload Studio", action: #selector(reloadPage), keyEquivalent: "r")
        appMenu.addItem(withTitle: "Hard Refresh", action: #selector(hardReloadPage), keyEquivalent: "R")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit UpBeat", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu

        // File Menu
        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "Open UpBeat Downloads Folder", action: #selector(openDownloadsFolder), keyEquivalent: "O")
        fileMenu.addItem(withTitle: "Open Backend Log", action: #selector(openBackendLog), keyEquivalent: "L")
        fileMenuItem.submenu = fileMenu

        // Edit Menu (Cmd+C, Cmd+V, Cmd+A, Cmd+X in text fields)
        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu

        // View Menu
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Actual Size", action: #selector(resetZoom), keyEquivalent: "0")
        viewMenu.addItem(withTitle: "Zoom In", action: #selector(zoomIn), keyEquivalent: "+")
        viewMenu.addItem(withTitle: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-")
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(withTitle: "Toggle Full Screen", action: #selector(toggleFullScreen), keyEquivalent: "f")
        viewMenuItem.submenu = viewMenu

        NSApp.mainMenu = mainMenu
    }

    @objc func showAboutPanel() {
        let alert = NSAlert()
        alert.messageText = "UpBeat v\(appVersion)"
        alert.informativeText = "Version \(appVersion)\nCreated for modern music curation with zero-token search, offline playback on Mac & Android, YouTube Music streaming, and Safari sync."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Check for Updates")
        let res = alert.runModal()
        if res == .alertSecondButtonReturn {
            checkForUpdates(silent: false)
        }
    }

    @objc func reloadPage() {
        webView.reload()
    }

    @objc func hardReloadPage() {
        webView.reloadFromOrigin()
    }

    @objc func resetZoom() {
        webView.pageZoom = 1.0
    }

    @objc func zoomIn() {
        webView.pageZoom += 0.1
    }

    @objc func zoomOut() {
        webView.pageZoom = max(0.5, webView.pageZoom - 0.1)
    }

    @objc func toggleFullScreen() {
        window.toggleFullScreen(nil)
    }

    @objc func menuCheckForUpdates() {
        checkForUpdates(silent: false)
    }

    @objc func menuRunSelfUpdate() {
        runSelfUpdate(userTriggered: true)
    }

    private func runProcessWithTimeout(
        executable: String,
        arguments: [String],
        currentDirectory: String,
        timeoutSeconds: TimeInterval,
        environmentOverrides: [String: String] = [:]
    ) -> (status: Int32, output: String, timedOut: Bool) {
        let proc = Process()
        let pipe = Pipe()
        proc.executableURL = URL(fileURLWithPath: executable)
        proc.arguments = arguments
        proc.currentDirectoryURL = URL(fileURLWithPath: currentDirectory)
        var env = ProcessInfo.processInfo.environment
        for (k, v) in environmentOverrides {
            env[k] = v
        }
        proc.environment = env
        proc.standardOutput = pipe
        proc.standardError = pipe

        let sem = DispatchSemaphore(value: 0)
        proc.terminationHandler = { _ in
            sem.signal()
        }

        do {
            try proc.run()
        } catch {
            return (-1, "", false)
        }

        let waitResult = sem.wait(timeout: .now() + timeoutSeconds)
        if waitResult == .timedOut {
            proc.terminate()
            _ = sem.wait(timeout: .now() + 1.0)
            return (-1, "", true)
        }

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let out = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return (proc.terminationStatus, out, false)
    }

    func checkForUpdates(silent: Bool) {
        if isUpdating { return }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            var hasGitUpdate = false
            var latestGitMsg = ""

            // 1. Check local git repo if available (bounded with timeouts & non-interactive env)
            let gitPath = "\(self.workspacePath)/.git"
            if FileManager.default.fileExists(atPath: gitPath) {
                let fetchRes = self.runProcessWithTimeout(
                    executable: "/usr/bin/git",
                    arguments: ["fetch", "origin", "main"],
                    currentDirectory: self.workspacePath,
                    timeoutSeconds: 12.0,
                    environmentOverrides: ["GIT_TERMINAL_PROMPT": "0"]
                )

                if !fetchRes.timedOut && fetchRes.status == 0 {
                    let diffRes = self.runProcessWithTimeout(
                        executable: "/usr/bin/git",
                        arguments: ["log", "HEAD..origin/main", "--oneline", "-n", "3"],
                        currentDirectory: self.workspacePath,
                        timeoutSeconds: 5.0,
                        environmentOverrides: ["GIT_TERMINAL_PROMPT": "0"]
                    )
                    if !diffRes.timedOut && diffRes.status == 0 && !diffRes.output.isEmpty {
                        hasGitUpdate = true
                        latestGitMsg = diffRes.output
                    }
                }
            }

            // 2. Check remote version via GitHub Raw CDN (Zero API rate limit)
            let releaseURL = URL(string: "https://raw.githubusercontent.com/\(self.githubRepo)/main/frontend/package.json?t=\(Int(Date().timeIntervalSince1970))")!
            var req = URLRequest(url: releaseURL, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 4.0)
            req.setValue("UpBeat-MacUpdater", forHTTPHeaderField: "User-Agent")

            let sem = DispatchSemaphore(value: 0)
            var releaseTag = ""

            URLSession.shared.dataTask(with: req) { data, _, _ in
                if let d = data,
                   let json = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                   let ver = json["version"] as? String {
                    releaseTag = ver.hasPrefix("v") ? ver : "v\(ver)"
                }
                sem.signal()
            }.resume()
            _ = sem.wait(timeout: .now() + 4.5)

            let hasReleaseUpdate = !releaseTag.isEmpty && self.isNewerVersion(remote: releaseTag, current: self.appVersion)

            DispatchQueue.main.async {
                if hasGitUpdate || hasReleaseUpdate {
                    let alert = NSAlert()
                    alert.messageText = "New UpBeat Update Available"
                    var detail = "A newer version of UpBeat is ready to install.\n\n"
                    if !latestGitMsg.isEmpty {
                        detail += "Latest changes:\n\(latestGitMsg)\n\n"
                    } else if !releaseTag.isEmpty {
                        detail += "Release: \(releaseTag)\n\n"
                    }
                    detail += "Would you like to recompile and update now?"
                    alert.informativeText = detail
                    alert.addButton(withTitle: "Update Now")
                    alert.addButton(withTitle: "Later")

                    let response = alert.runModal()
                    if response == .alertFirstButtonReturn {
                        self.runSelfUpdate(userTriggered: true)
                    }
                } else if !silent {
                    let alert = NSAlert()
                    alert.messageText = "UpBeat is Up to Date"
                    alert.informativeText = "You are running UpBeat v\(self.appVersion).\n\nNo newer updates found on GitHub (\(releaseTag.isEmpty ? "latest" : releaseTag))."
                    alert.addButton(withTitle: "OK")
                    alert.runModal()
                }
            }
        }
    }

    private func isNewerVersion(remote: String, current: String) -> Bool {
        let cleanRemote = remote.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))
        let cleanCurrent = current.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))
        let rParts = cleanRemote.split(separator: ".").compactMap { Int($0.prefix(while: { $0.isNumber })) }
        let cParts = cleanCurrent.split(separator: ".").compactMap { Int($0.prefix(while: { $0.isNumber })) }
        let maxLen = max(rParts.count, cParts.count)
        for i in 0..<maxLen {
            let r = i < rParts.count ? rParts[i] : 0
            let c = i < cParts.count ? cParts[i] : 0
            if r > c { return true }
            if r < c { return false }
        }
        return false
    }

    func relaunchApp() {
        let bundlePath = Bundle.main.bundleURL.path
        let launcher = Process()
        launcher.executableURL = URL(fileURLWithPath: "/bin/sh")
        launcher.arguments = ["-c", "sleep 0.5 && open -n \"$1\"", "_", bundlePath]
        try? launcher.run()
        NSApplication.shared.terminate(nil)
    }

    func runSelfUpdate(userTriggered: Bool) {
        if isUpdating { return }
        isUpdating = true

        let scriptPath = "\(workspacePath)/macos/update.sh"
        guard FileManager.default.fileExists(atPath: scriptPath) else {
            isUpdating = false
            let errAlert = NSAlert()
            errAlert.messageText = "Update Script Missing"
            errAlert.informativeText = "Could not find \(scriptPath)"
            errAlert.runModal()
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            let proc = Process()
            let pipe = Pipe()

            var env = ProcessInfo.processInfo.environment
            let extraPaths = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
            let existingPath = env["PATH"] ?? ""
            env["PATH"] = "\(extraPaths):\(existingPath)"
            proc.environment = env

            proc.executableURL = URL(fileURLWithPath: "/bin/bash")
            proc.arguments = [scriptPath]
            proc.currentDirectoryURL = URL(fileURLWithPath: self.workspacePath)
            proc.standardOutput = pipe
            proc.standardError = pipe

            do {
                try proc.run()
                proc.waitUntilExit()
                let success = proc.terminationStatus == 0

                DispatchQueue.main.async {
                    self.isUpdating = false
                    if success {
                        let finishAlert = NSAlert()
                        finishAlert.messageText = "UpBeat Updated Successfully"
                        finishAlert.informativeText = "The latest UpBeat native app and frontend have been compiled. Restart UpBeat now to load the updated binary."
                        finishAlert.addButton(withTitle: "Restart Now")
                        finishAlert.addButton(withTitle: "Later")
                        if finishAlert.runModal() == .alertFirstButtonReturn {
                            self.relaunchApp()
                        } else {
                            self.webView.reload()
                        }
                    } else {
                        let errData = pipe.fileHandleForReading.readDataToEndOfFile()
                        let errText = String(data: errData, encoding: .utf8) ?? "Unknown error"
                        let errAlert = NSAlert()
                        errAlert.messageText = "Update Failed"
                        errAlert.informativeText = String(errText.suffix(400))
                        errAlert.addButton(withTitle: "OK")
                        errAlert.runModal()
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self.isUpdating = false
                    let errAlert = NSAlert()
                    errAlert.messageText = "Failed to Run Updater"
                    errAlert.informativeText = "\(error)"
                    errAlert.runModal()
                }
            }
        }
    }

    func showStartupSplash() {
        let splashHTML = """
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              height: 100vh;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              background-color: #0b0c10;
              color: #f1f5f9;
              font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif;
              user-select: none;
              overflow: hidden;
            }
            .container {
              display: flex;
              flex-direction: column;
              align-items: center;
              text-align: center;
              padding: 32px;
              max-width: 440px;
            }
            .logo-icon {
              width: 58px;
              height: 58px;
              border-radius: 16px;
              background: linear-gradient(135deg, #6366f1 0%, #ec4899 100%);
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 28px;
              box-shadow: 0 10px 25px -5px rgba(99, 102, 241, 0.45);
              margin-bottom: 24px;
              animation: pulse 2.2s infinite ease-in-out;
            }
            @keyframes pulse {
              0% { transform: scale(1); box-shadow: 0 10px 25px -5px rgba(99, 102, 241, 0.45); }
              50% { transform: scale(1.06); box-shadow: 0 16px 36px -5px rgba(236, 72, 153, 0.55); }
              100% { transform: scale(1); box-shadow: 0 10px 25px -5px rgba(99, 102, 241, 0.45); }
            }
            h1 {
              font-size: 20px;
              font-weight: 700;
              letter-spacing: -0.02em;
              margin-bottom: 8px;
              color: #ffffff;
            }
            p.sub {
              font-size: 13px;
              color: #94a3b8;
              margin-bottom: 24px;
              line-height: 1.5;
            }
            .loader-bar {
              width: 140px;
              height: 3px;
              background: rgba(255, 255, 255, 0.08);
              border-radius: 9999px;
              overflow: hidden;
              position: relative;
            }
            .loader-progress {
              position: absolute;
              top: 0;
              left: 0;
              height: 100%;
              width: 40%;
              background: linear-gradient(90deg, #6366f1, #ec4899);
              border-radius: 9999px;
              animation: loading 1.4s infinite ease-in-out;
            }
            @keyframes loading {
              0% { left: -40%; width: 40%; }
              50% { left: 30%; width: 60%; }
              100% { left: 100%; width: 40%; }
            }
            .retry-box {
              margin-top: 20px;
              display: none;
              animation: fadeIn 0.3s ease;
            }
            @keyframes fadeIn {
              from { opacity: 0; transform: translateY(6px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .retry-btn {
              background: rgba(255, 255, 255, 0.08);
              border: 1px solid rgba(255, 255, 255, 0.15);
              color: #f1f5f9;
              padding: 8px 18px;
              border-radius: 8px;
              font-size: 13px;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s;
            }
            .retry-btn:hover {
              background: rgba(255, 255, 255, 0.14);
              border-color: rgba(255, 255, 255, 0.25);
            }
            .diag {
              margin-top: 12px;
              font-family: monospace;
              font-size: 11px;
              color: #ef4444;
              max-width: 380px;
              word-break: break-all;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo-icon">♫</div>
            <h1>UpBeat Studio</h1>
            <p class="sub" id="status-text">Connecting to local audio engine...</p>
            <div class="loader-bar" id="loader"><div class="loader-progress"></div></div>
            <div class="retry-box" id="retry-box">
              <button class="retry-btn" onclick="retry()">Reconnect</button>
              <div class="diag" id="diag-msg"></div>
            </div>
          </div>
          <script>
            function setStatus(text, showRetry, errorText) {
              document.getElementById('status-text').innerText = text;
              if (showRetry) {
                document.getElementById('loader').style.display = 'none';
                document.getElementById('retry-box').style.display = 'block';
                if (errorText) document.getElementById('diag-msg').innerText = errorText;
              }
            }
            function retry() {
              document.getElementById('retry-box').style.display = 'none';
              document.getElementById('loader').style.display = 'block';
              document.getElementById('status-text').innerText = 'Reconnecting...';
              try {
                window.webkit.messageHandlers.upbeatNative.postMessage({action: 'retryBackend'});
              } catch(e) {
                window.location.reload();
              }
            }
            setTimeout(function() {
              if (document.getElementById('loader').style.display !== 'none') {
                setStatus('Engine startup taking longer than usual...', true, 'Click Reconnect if server is booting.');
              }
            }, 8000);
          </script>
        </body>
        </html>
        """
        isMainAppLoaded = false
        webView.loadHTMLString(splashHTML, baseURL: nil)
    }

    @objc func openBackendLog() {
        let logsDir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Logs")
            .appendingPathComponent("UpBeat")
        let logFile = logsDir.appendingPathComponent("backend.log")
        NSWorkspace.shared.open(logFile)
    }

    func ensureBackendAndLoad() {
        let statusURL = URL(string: "http://127.0.0.1:8000/api/status")!
        var req = URLRequest(url: statusURL)
        req.timeoutInterval = 1.2

        URLSession.shared.dataTask(with: req) { [weak self] _, response, _ in
            guard let self = self else { return }
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                DispatchQueue.main.async {
                    self.webView.load(URLRequest(url: self.serverURL))
                }
            } else {
                self.startBackendProcess()
            }
        }.resume()
    }

    func startBackendProcess() {
        if let proc = backendProcess, proc.isRunning {
            pollBackend(attemptsLeft: 40)
            return
        }

        let logsDir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Logs")
            .appendingPathComponent("UpBeat")
        try? FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true, attributes: nil)
        let logFile = logsDir.appendingPathComponent("backend.log")
        if !FileManager.default.fileExists(atPath: logFile.path) {
            FileManager.default.createFile(atPath: logFile.path, contents: nil, attributes: nil)
        }
        let logHandle = try? FileHandle(forWritingTo: logFile)
        logHandle?.seekToEndOfFile()

        let proc = Process()
        let venvPython = "\(workspacePath)/.venv/bin/python"
        let venvUvicorn = "\(workspacePath)/.venv/bin/uvicorn"

        var env = ProcessInfo.processInfo.environment
        env["VIRTUAL_ENV"] = "\(workspacePath)/.venv"
        env["PATH"] = "\(workspacePath)/.venv/bin:/usr/local/bin:/usr/bin:/bin:\(env["PATH"] ?? "")"
        env["PYTHONPATH"] = workspacePath
        proc.environment = env

        if FileManager.default.fileExists(atPath: venvUvicorn) {
            proc.executableURL = URL(fileURLWithPath: venvUvicorn)
            proc.arguments = ["backend.main:app", "--host", "127.0.0.1", "--port", "8000"]
        } else if FileManager.default.fileExists(atPath: venvPython) {
            proc.executableURL = URL(fileURLWithPath: venvPython)
            proc.arguments = ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000"]
        } else if FileManager.default.fileExists(atPath: "\(workspacePath)/backend/main.py") {
            proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            proc.arguments = ["python3", "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000"]
        } else {
            DispatchQueue.main.async {
                self.webView.evaluateJavaScript("setStatus('Local UpBeat backend not found', true, \(self.jsLiteral("Missing backend at \(self.workspacePath)")))")
            }
            return
        }
        proc.currentDirectoryURL = URL(fileURLWithPath: workspacePath)

        if let handle = logHandle {
            proc.standardOutput = handle
            proc.standardError = handle
        }

        do {
            try proc.run()
            self.backendProcess = proc
        } catch {
            print("Failed to launch backend: \(error)")
        }

        pollBackend(attemptsLeft: 50)
    }

    func pollBackend(attemptsLeft: Int) {
        let statusURL = URL(string: "http://127.0.0.1:8000/api/status")!
        var req = URLRequest(url: statusURL)
        req.timeoutInterval = 1.0

        URLSession.shared.dataTask(with: req) { [weak self] _, response, error in
            guard let self = self else { return }
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                DispatchQueue.main.async {
                    self.webView.load(URLRequest(url: self.serverURL))
                }
            } else if attemptsLeft > 0 {
                DispatchQueue.global().asyncAfter(deadline: .now() + 0.4) {
                    self.pollBackend(attemptsLeft: attemptsLeft - 1)
                }
            } else {
                DispatchQueue.main.async {
                    let errDetail = error?.localizedDescription ?? "Port 8000 not responding"
                    self.webView.evaluateJavaScript("setStatus('Unable to connect to UpBeat Engine', true, \(self.jsLiteral(errDetail)))")
                }
            }
        }.resume()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let url = webView.url,
              let host = url.host?.lowercased(),
              host == "127.0.0.1" || host == "localhost" else {
            return
        }
        isMainAppLoaded = true
        flushPendingDeepLinks(attempt: 0)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let nsErr = error as NSError
        if nsErr.code != NSURLErrorCancelled {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
                guard let self = self else { return }
                self.ensureBackendAndLoad()
            }
        }
    }

    func presentNativeProfilePhotoPicker() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if #available(macOS 11.0, *) {
            panel.allowedContentTypes = [.image]
        } else {
            panel.allowedFileTypes = ["png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "tiff", "bmp"]
        }
        panel.message = "Choose a profile picture for UpBeat"
        panel.prompt = "Choose Photo"
        panel.level = .modalPanel
        NSApp.activate(ignoringOtherApps: true)

        panel.begin { [weak self] response in
            guard let self = self else { return }
            guard response == .OK, let fileURL = panel.url else {
                DispatchQueue.main.async {
                    self.webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('upbeat-native-photo-cancelled'));", completionHandler: nil)
                }
                return
            }

            var finalDataUrl: String? = nil
            if let image = NSImage(contentsOf: fileURL) {
                let maxDim: CGFloat = 320
                var w = image.size.width
                var h = image.size.height
                if w > h {
                    if w > maxDim {
                        h = (h * maxDim) / w
                        w = maxDim
                    }
                } else {
                    if h > maxDim {
                        w = (w * maxDim) / h
                        h = maxDim
                    }
                }
                let newSize = NSSize(width: max(1, w), height: max(1, h))
                let rep = NSBitmapImageRep(
                    bitmapDataPlanes: nil,
                    pixelsWide: Int(newSize.width),
                    pixelsHigh: Int(newSize.height),
                    bitsPerSample: 8,
                    samplesPerPixel: 4,
                    hasAlpha: true,
                    isPlanar: false,
                    colorSpaceName: .deviceRGB,
                    bytesPerRow: 0,
                    bitsPerPixel: 0
                )
                if let rep = rep {
                    NSGraphicsContext.saveGraphicsState()
                    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
                    image.draw(in: NSRect(origin: .zero, size: newSize), from: NSRect(origin: .zero, size: image.size), operation: .copy, fraction: 1.0)
                    NSGraphicsContext.restoreGraphicsState()
                    if let jpegData = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.88]) {
                        finalDataUrl = "data:image/jpeg;base64,\(jpegData.base64EncodedString())"
                    }
                }
            }

            if finalDataUrl == nil, let raw = try? Data(contentsOf: fileURL) {
                let mime = fileURL.pathExtension.lowercased() == "png" ? "image/png" : "image/jpeg"
                finalDataUrl = "data:\(mime);base64,\(raw.base64EncodedString())"
            }

            if let dataUrl = finalDataUrl {
                DispatchQueue.main.async {
                    let payload: [String: String] = ["dataUrl": dataUrl]
                    if let json = try? JSONSerialization.data(withJSONObject: payload),
                       let jsonStr = String(data: json, encoding: .utf8) {
                        let js = "window.dispatchEvent(new CustomEvent('upbeat-native-photo-selected', { detail: \(jsonStr) }));"
                        self.webView.evaluateJavaScript(js, completionHandler: nil)
                    }
                }
            }
        }
    }

    @available(macOS 12.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let host = origin.host.lowercased()
        if host == "127.0.0.1" || host == "localhost" {
            decisionHandler(.grant)
        } else {
            decisionHandler(.deny)
        }
    }

    func startNativeSpeechRecognition(lang: String = "en-US") {
        stopNativeSpeechRecognition()

        SFSpeechRecognizer.requestAuthorization { [weak self] authStatus in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard authStatus == .authorized else {
                    let errStr = authStatus == .denied ? "Speech recognition permission denied" : "Speech recognition unavailable"
                    let js = "window.onUpBeatSpeechError && window.onUpBeatSpeechError(\(self.jsLiteral(errStr)));"
                    self.webView.evaluateJavaScript(js, completionHandler: nil)
                    return
                }

                if #available(macOS 10.14, *) {
                    AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
                        DispatchQueue.main.async {
                            guard let self = self else { return }
                            guard granted else {
                                let js = "window.onUpBeatSpeechError && window.onUpBeatSpeechError('Microphone permission denied');"
                                self.webView.evaluateJavaScript(js, completionHandler: nil)
                                return
                            }
                            self.beginAudioEngineRecognition(lang: lang)
                        }
                    }
                } else {
                    self.beginAudioEngineRecognition(lang: lang)
                }
            }
        }
    }

    private func beginAudioEngineRecognition(lang: String) {
        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang)) ?? SFSpeechRecognizer()
        self.speechRecognizer = recognizer

        let audioEngine = AVAudioEngine()
        self.speechAudioEngine = audioEngine

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        guard recordingFormat.channelCount > 0, recordingFormat.sampleRate > 0 else {
            let js = "window.onUpBeatSpeechError && window.onUpBeatSpeechError('No audio input device available');"
            self.webView.evaluateJavaScript(js, completionHandler: nil)
            stopNativeSpeechRecognition()
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        self.speechRecognitionRequest = request

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            request.append(buffer)
        }
        hasInstalledSpeechTap = true

        audioEngine.prepare()
        do {
            try audioEngine.start()
            let js = "window.onUpBeatSpeechStart && window.onUpBeatSpeechStart();"
            self.webView.evaluateJavaScript(js, completionHandler: nil)
        } catch {
            let js = "window.onUpBeatSpeechError && window.onUpBeatSpeechError('Audio recording failed to start');"
            self.webView.evaluateJavaScript(js, completionHandler: nil)
            stopNativeSpeechRecognition()
            return
        }

        self.speechRecognitionTask = recognizer?.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let r = result {
                let text = r.bestTranscription.formattedString.replacingOccurrences(of: "\n", with: " ")
                let isFinal = r.isFinal
                let js = "window.onUpBeatSpeechResult && window.onUpBeatSpeechResult(\(self.jsLiteral(text)), \(isFinal));"
                DispatchQueue.main.async {
                    self.webView.evaluateJavaScript(js, completionHandler: nil)
                }
            }
            if error != nil || (result?.isFinal ?? false) {
                DispatchQueue.main.async {
                    self.stopNativeSpeechRecognition()
                }
            }
        }
    }

    func stopNativeSpeechRecognition() {
        speechAudioEngine?.stop()
        if hasInstalledSpeechTap {
            speechAudioEngine?.inputNode.removeTap(onBus: 0)
            hasInstalledSpeechTap = false
        }
        speechRecognitionRequest?.endAudio()
        speechRecognitionTask?.cancel()
        speechRecognitionTask = nil
        speechRecognitionRequest = nil
        speechAudioEngine = nil
        speechRecognizer = nil

        let js = "window.onUpBeatSpeechEnd && window.onUpBeatSpeechEnd();"
        self.webView.evaluateJavaScript(js, completionHandler: nil)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.message = "Choose a file for UpBeat"
        panel.prompt = "Select"
        panel.level = .modalPanel
        NSApp.activate(ignoringOtherApps: true)

        panel.begin { response in
            if response == .OK {
                completionHandler(panel.urls)
            } else {
                completionHandler(nil)
            }
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if url.path.contains("/download/") {
                // Let WKWebView handle in-app download
                return nil
            }
            let scheme = url.scheme?.lowercased() ?? ""
            if scheme == "upbeat" {
                queueDeepLink(url)
            } else if scheme == "http" || scheme == "https" {
                NSWorkspace.shared.open(url)
            }
        }
        return nil
    }

    @available(macOS 11.3, *)
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        if let url = navigationAction.request.url {
            let scheme = url.scheme?.lowercased() ?? ""
            if scheme == "upbeat" {
                queueDeepLink(url)
                decisionHandler(.cancel, preferences)
                return
            }
            let allowedSchemes: Set<String> = ["http", "https", "about", "blob", "data"]
            if !allowedSchemes.contains(scheme) {
                decisionHandler(.cancel, preferences)
                return
            }
            if url.path.contains("/download/") {
                decisionHandler(.download, preferences)
                return
            }
        }
        decisionHandler(.allow, preferences)
    }

    @available(macOS 11.3, *)
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let url = navigationResponse.response.url, url.path.contains("/download/") {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    @available(macOS 11.3, *)
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    @available(macOS 11.3, *)
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    @available(macOS 11.3, *)
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let downloadsBase = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!
        let upbeatDownloadsDir = downloadsBase.appendingPathComponent("UpBeat")
        if !FileManager.default.fileExists(atPath: upbeatDownloadsDir.path) {
            try? FileManager.default.createDirectory(at: upbeatDownloadsDir, withIntermediateDirectories: true, attributes: nil)
        }
        let dest = upbeatDownloadsDir.appendingPathComponent(suggestedFilename)
        var finalDest = dest
        var counter = 1
        let ext = dest.pathExtension
        let base = dest.deletingPathExtension().lastPathComponent
        while FileManager.default.fileExists(atPath: finalDest.path) {
            let candidateName = ext.isEmpty ? "\(base) (\(counter))" : "\(base) (\(counter)).\(ext)"
            finalDest = upbeatDownloadsDir.appendingPathComponent(candidateName)
            counter += 1
        }
        completionHandler(finalDest)
    }

    @objc func openDownloadsFolder() {
        let downloadsBase = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!
        let upbeatDownloadsDir = downloadsBase.appendingPathComponent("UpBeat")
        if !FileManager.default.fileExists(atPath: upbeatDownloadsDir.path) {
            try? FileManager.default.createDirectory(at: upbeatDownloadsDir, withIntermediateDirectories: true, attributes: nil)
        }
        NSWorkspace.shared.open(upbeatDownloadsDir)
    }

    @available(macOS 11.3, *)
    func downloadDidFinish(_ download: WKDownload) {
        NSSound(named: "Glass")?.play()
        NSApp.requestUserAttention(.informationalRequest)
    }

    func applicationWillTerminate(_ notification: Notification) {
        updateTimer?.invalidate()
        if let act = backgroundActivity {
            ProcessInfo.processInfo.endActivity(act)
        }
        if let proc = backendProcess, proc.isRunning {
            proc.terminate()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
