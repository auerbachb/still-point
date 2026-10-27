import Foundation

// Launch config for `UITestAPIStore`, read from the `SP_UI_TEST_*` environment.
// Split out of `UITestAPIStore.swift` (issue #1052) so new launch flags land here
// instead of in the fake backend's request handlers.

/// How `SP_UI_TEST_FORCE_SESSIONS_FAILURE` fails the sessions endpoints (#957).
enum UITestSessionsFailureMode: Equatable, Sendable {
    /// No forced failure.
    case none
    /// `getSessions` and `getTracksDoneToday` fail with a 503 on every call
    /// (`1`, `true`, `yes`, `on`).
    case always
    /// Only the first `getSessions` call in the process fails with a 503, and
    /// `getTracksDoneToday` never fails (`once`). Lets a UI test tap History's Retry
    /// and see the next load succeed.
    case once

    /// Reads the variable's value. Case-insensitive and not trimmed, like the other
    /// `SP_UI_TEST_*` flags. Any other value, or no value, is `none`.
    static func parse(_ value: String?) -> UITestSessionsFailureMode {
        guard let value else { return .none }
        if value.lowercased() == "once" { return .once }
        return UITestConfig.truthy(value) ? .always : .none
    }
}

struct UITestConfig: Sendable {
    let seedAuthenticated: Bool
    let resetStore: Bool
    let forceLaunchOffline: Bool
    let forceTokenExpired: Bool
    let sessionsFailureMode: UITestSessionsFailureMode
    /// #875: every `createSession` fails as a dead network does
    /// (`SP_UI_TEST_FORCE_CREATE_SESSION_FAILURE`), so a completed sit stays
    /// pending sync.
    let forceCreateSessionFailure: Bool
    let forceUsernameConflict: Bool
    /// Deterministic marketing/scenario data for Fastlane snapshot runs (Issue #325).
    let snapshotSeed: Bool
    /// #887: how long the held `me()` read waits, in seconds
    /// (`SP_UI_TEST_HOLD_ME_SECONDS`). `nil` when no read is held.
    let holdMeSeconds: Double?
    /// #887: the held `me()` read answers as the second account
    /// (`SP_UI_TEST_SECOND_ACCOUNT`).
    let secondAccount: Bool

    /// #896: a signed-in config with every forced failure off, for the package's
    /// unit tests of the fake server's rules.
    static let unitTest = UITestConfig(
        seedAuthenticated: true,
        resetStore: false,
        forceLaunchOffline: false,
        forceTokenExpired: false,
        sessionsFailureMode: .none,
        forceCreateSessionFailure: false,
        forceUsernameConflict: false,
        snapshotSeed: false,
        holdMeSeconds: nil,
        secondAccount: false
    )

    static func from(environment env: [String: String]) -> UITestConfig? {
        guard truthy(env["SP_UI_TEST_MODE"]) else { return nil }
        return UITestConfig(
            seedAuthenticated: truthy(env["SP_UI_TEST_SEED_AUTH"]),
            resetStore: truthy(env["SP_UI_TEST_RESET_STORE"]),
            forceLaunchOffline: truthy(env["SP_UI_TEST_FORCE_LAUNCH_OFFLINE"]),
            forceTokenExpired: truthy(env["SP_UI_TEST_FORCE_TOKEN_EXPIRED"]),
            sessionsFailureMode: UITestSessionsFailureMode.parse(env["SP_UI_TEST_FORCE_SESSIONS_FAILURE"]),
            forceCreateSessionFailure: truthy(env["SP_UI_TEST_FORCE_CREATE_SESSION_FAILURE"]),
            forceUsernameConflict: truthy(env["SP_UI_TEST_FORCE_USERNAME_CONFLICT"]),
            snapshotSeed: truthy(env["SP_UI_TEST_SNAPSHOT_SEED"]),
            holdMeSeconds: env["SP_UI_TEST_HOLD_ME_SECONDS"].flatMap(Double.init).flatMap { $0 > 0 ? $0 : nil },
            secondAccount: truthy(env["SP_UI_TEST_SECOND_ACCOUNT"])
        )
    }

    /// The values every boolean `SP_UI_TEST_*` flag accepts, case-insensitively.
    private static let truthyValues: Set<String> = ["1", "true", "yes", "on"]

    fileprivate static func truthy(_ value: String?) -> Bool {
        guard let value else { return false }
        return truthyValues.contains(value.lowercased())
    }
}
