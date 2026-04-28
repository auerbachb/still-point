import SwiftUI
import SwiftData
import StillPointShared

@main
struct StillPointApp: App {
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
        guard let appSupport = try? fm.url(for: .applicationSupportDirectory,
                                           in: .userDomainMask,
                                           appropriateFor: nil,
                                           create: false) else { return }
        for suffix in ["", "-shm", "-wal"] {
            let url = appSupport.appendingPathComponent("default.store\(suffix)")
            try? fm.removeItem(at: url)
        }
    }
}
