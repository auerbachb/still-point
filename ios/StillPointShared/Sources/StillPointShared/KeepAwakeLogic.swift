import Foundation

/// #1176: whether a sit keeps the screen awake, decided without UIKit.
///
/// The owner expects a sit to behave like a video: the screen stays on for the
/// whole sit. `SessionIdleTimerController` (app target) owns
/// `UIApplication.isIdleTimerDisabled` and re-applies this decision whenever it
/// could have lapsed: the scene becoming active, an audio interruption ending,
/// a pause resuming, a cue-mode change, an overlay over the sit closing. This
/// type holds the rule itself so `swift test` can pin it.
///
/// Cue mode is deliberately not an input. A haptic sit makes no continuous
/// sound, so nothing else keeps the app in the foreground. It needs the screen
/// held exactly as much as a tick sit does.
///
/// The iOS limit stands: a side-button lock suspends the app whatever this
/// returns, and no haptic or bell can fire until the sitter reopens it.
public enum KeepAwakeLogic {

    /// One window's sit state, as the controller tracks it.
    public struct Registration: Equatable, Sendable {
        /// The window's owner is still alive.
        public var isAlive: Bool
        /// The window's scene is foreground-active.
        public var sceneForegroundActive: Bool
        /// A solo, breath-counting or focus sit is running in it.
        public var localSessionRunning: Bool
        /// A Buddy sit is in the server's `active` state in it.
        public var buddySessionActive: Bool

        public init(
            isAlive: Bool = true,
            sceneForegroundActive: Bool,
            localSessionRunning: Bool,
            buddySessionActive: Bool
        ) {
            self.isAlive = isAlive
            self.sceneForegroundActive = sceneForegroundActive
            self.localSessionRunning = localSessionRunning
            self.buddySessionActive = buddySessionActive
        }

        /// This window has a running sit on screen.
        public var holdsSitOnScreen: Bool {
            isAlive && sceneForegroundActive && (localSessionRunning || buddySessionActive)
        }
    }

    /// Whether the system idle timer should be disabled: the keep-awake
    /// preference is on (#730: on unless the user turned it off) and some
    /// foreground window is running a sit, of any kind and in any cue mode.
    public static func shouldDisableIdleTimer(
        preferenceEnabled: Bool,
        registrations: [Registration]
    ) -> Bool {
        preferenceEnabled && registrations.contains { $0.holdsSitOnScreen }
    }
}
