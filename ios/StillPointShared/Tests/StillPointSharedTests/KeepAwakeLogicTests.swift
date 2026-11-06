import Foundation
import Testing
@testable import StillPointShared

/// #1176: the screen stays awake for the whole sit, in every sit type and
/// every cue mode, while the keep-awake preference is on.
struct KeepAwakeLogicTests {

    private func window(
        foreground: Bool = true,
        local: Bool = false,
        buddy: Bool = false,
        alive: Bool = true
    ) -> KeepAwakeLogic.Registration {
        KeepAwakeLogic.Registration(
            isAlive: alive,
            sceneForegroundActive: foreground,
            localSessionRunning: local,
            buddySessionActive: buddy
        )
    }

    /// Solo, breath-counting and focus sits all register as a local sit, and a
    /// Buddy sit registers on its own flag. Every one holds the screen.
    @Test func testEverySitTypeHoldsTheScreen() {
        #expect(KeepAwakeLogic.shouldDisableIdleTimer(preferenceEnabled: true, registrations: [window(local: true)]))
        #expect(KeepAwakeLogic.shouldDisableIdleTimer(preferenceEnabled: true, registrations: [window(buddy: true)]))
    }

    /// Cue mode is not an input, so a haptic sit is held exactly like a tick
    /// one: the registration a sit makes is the same in every mode.
    @Test func testCueModeNeverChangesTheDecision() {
        for mode in CueMode.allCases {
            let prefs = CueModeLogic.applying(mode, to: AudioEngine.SoundPrefs(tick: true, chime: true, completion: true))
            #expect(CueModeLogic.mode(of: prefs) == mode)
            #expect(KeepAwakeLogic.shouldDisableIdleTimer(preferenceEnabled: true, registrations: [window(local: true)]))
        }
    }

    @Test func testThePreferenceOffReleasesTheScreen() {
        #expect(!KeepAwakeLogic.shouldDisableIdleTimer(preferenceEnabled: false, registrations: [window(local: true)]))
    }

    /// A paused sit, a background scene or a dead window does not hold it.
    @Test func testOnlyARunningForegroundSitHoldsTheScreen() {
        #expect(!KeepAwakeLogic.shouldDisableIdleTimer(preferenceEnabled: true, registrations: [window(local: false)]))
        #expect(!KeepAwakeLogic.shouldDisableIdleTimer(preferenceEnabled: true, registrations: [window(foreground: false, local: true)]))
        #expect(!KeepAwakeLogic.shouldDisableIdleTimer(preferenceEnabled: true, registrations: [window(local: true, alive: false)]))
        #expect(!KeepAwakeLogic.shouldDisableIdleTimer(preferenceEnabled: true, registrations: []))
    }

    /// Multi-window: one foreground window with a running sit is enough, and a
    /// second idle window cannot release it.
    @Test func testAnyWindowWithARunningSitHoldsTheScreen() {
        #expect(KeepAwakeLogic.shouldDisableIdleTimer(
            preferenceEnabled: true,
            registrations: [window(foreground: false), window(local: true)]
        ))
    }
}
