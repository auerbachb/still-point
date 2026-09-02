import Foundation
import Observation

/// #742: the process-wide, observable face of the wake-lock preference (#306, #730).
///
/// On iPad every `WindowGroup` scene builds its own `AppViewModel`, and the
/// preference used to be snapshotted into each one at `init()`. Nothing put those
/// copies back in step afterwards, so changing the setting in window A left window
/// B's Settings switch rendering the value it had read at launch — the user could
/// then tap a switch whose position disagreed with the stored choice.
///
/// The wake lock itself was never affected:
/// `SessionIdleTimerController.applyDesiredIdleTimerState()` resolves the stored
/// preference, never a view model's copy, so `isIdleTimerDisabled` was already
/// consistent the moment the preference changed. Only the rendered switch drifted.
///
/// The fix is to delete the copies rather than to synchronise them: one shared
/// `@Observable` object that every scene reads, so SwiftUI invalidates all of them
/// together.
///
/// `isEnabled` resolves `WakeLockPrefs` on every read rather than answering from a
/// cached mirror, so the rendered value cannot drift from storage even for a path
/// that writes the key without coming through `setEnabled` — the UI-test reset
/// (`UITestAPIStore`) is the one that does. `revision` exists only to carry the
/// invalidation, because `UserDefaults` is not something `@Observable` can track;
/// a write it misses costs a redraw, never a wrong answer.
@Observable
@MainActor
public final class WakeLockPreferenceStore {
    /// The one instance every scene reads. A second one would reintroduce the
    /// per-scene copies this type exists to remove, which is why `init` is
    /// package-internal: the tests build their own, and nothing else can.
    public static let shared = WakeLockPreferenceStore()

    /// Moves once per recorded change. `isEnabled` reads it, and that read is what
    /// puts the caller on the observation graph — dropping it would take every
    /// scene's `Toggle` back off and re-open #742.
    private var revision = 0

    init() {}

    /// `true` when the screen should stay awake for the length of an active sit.
    ///
    /// Reading never writes. An install that has never touched the setting still
    /// has no stored value afterwards, which is what keeps #730's "absence is the
    /// unset signal" resolvable — and what stops a freshly built scene from
    /// materialising the default into storage on someone else's behalf.
    public var isEnabled: Bool {
        // Read for its observation side effect alone; the resolve below is the
        // answer. `_ =` rather than a discarded expression so the intent is
        // explicit to the next reader.
        _ = revision
        return WakeLockPrefs.isKeepScreenAwakeEnabled
    }

    /// Records an explicit choice — and only an explicit *change*.
    ///
    /// A set that matches what is already resolved writes nothing. Re-writing
    /// would be a second write for a single tap, and on an untouched install it
    /// would turn "never set" into an explicit choice the user never made, which
    /// is the one thing #730's opt-out default depends on not happening.
    public func setEnabled(_ enabled: Bool) {
        guard enabled != WakeLockPrefs.isKeepScreenAwakeEnabled else { return }
        WakeLockPrefs.setKeepScreenAwakeEnabled(enabled)
        revision &+= 1
    }
}
