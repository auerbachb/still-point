import SwiftUI
import SwiftData
import StillPointShared
import os

@main
struct StillPointApp: App {
    private static let diagLog = Logger(subsystem: "com.brettonauerbach.stillpoint", category: "e2e-diag")

    init() {
        // Wipe SwiftData persistent files BEFORE `.modelContainer(...)` below
        // opens the SQLite database. Doing this from `APIClient.init` was too
        // late: the model container opens during `WindowGroup` scene
        // construction, which happens before `RootView.task { checkAuth }`
        // first touches `APIClient.shared`. Removing files after the
        // container opens leaves the in-memory ModelContainer attached to
        // stale SQLite state via Unix file handles.
        // Issue #276 — flagged in PR #277 review by both CodeAnt and Cursor.
        StillPointApp.resetSwiftDataIfRequested()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
        }
        .modelContainer(for: [User.self, Session.self, Thought.self])
    }

    /// Best-effort wipe of the SwiftData persistent store when the UI-test
    /// harness asks for a clean slate. Called from `init()` so it runs before
    /// `.modelContainer(...)` opens any SQLite files.
    private static func resetSwiftDataIfRequested() {
        let env = ProcessInfo.processInfo.environment
        let truthy: (String?) -> Bool = { value in
            guard let value else { return false }
            return ["1", "true", "yes", "on"].contains(value.lowercased())
        }
        guard truthy(env["SP_UI_TEST_MODE"]),
              truthy(env["SP_UI_TEST_RESET_STORE"]) else {
            return
        }
        let fm = FileManager.default
        let appSupport: URL
        do {
            appSupport = try fm.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: false
            )
        } catch {
            let nsError = error as NSError
            if nsError.domain == NSCocoaErrorDomain,
               nsError.code == NSFileNoSuchFileError {
                return
            }
            diagLog.error("[E2E-DIAG] failed to locate Application Support for SwiftData reset error=\(error.localizedDescription, privacy: .public)")
            return
        }
        for suffix in ["", "-shm", "-wal"] {
            let url = appSupport.appendingPathComponent("default.store\(suffix)")
            do {
                try fm.removeItem(at: url)
            } catch CocoaError.fileNoSuchFile {
                continue
            } catch {
                diagLog.error("[E2E-DIAG] failed to remove SwiftData file path=\(url.path, privacy: .public) error=\(error.localizedDescription, privacy: .public)")
            }
        }
    }
}
