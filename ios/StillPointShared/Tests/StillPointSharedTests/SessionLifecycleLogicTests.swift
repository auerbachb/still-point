import Foundation
import Testing
@testable import StillPointShared

/// #1024 — whether a solo sit may start, resume or end. Moved here from
/// `SessionTickLogicTests` with the gates themselves, unchanged.
struct SessionLifecycleLogicTests {

    @Test func testStartPicksUpAPausedOrRunningSit() {
        #expect(SessionLifecycleLogic.isResume(pausedElapsed: 125.5, totalSeconds: 300, isPaused: true, isActive: false))
        // Paused before the first tick landed.
        #expect(SessionLifecycleLogic.isResume(pausedElapsed: 0, totalSeconds: 300, isPaused: true, isActive: false))
        // Started again while already running.
        #expect(SessionLifecycleLogic.isResume(pausedElapsed: 0, totalSeconds: 300, isPaused: false, isActive: true))
        // Clock part-way through, neither paused nor running.
        #expect(SessionLifecycleLogic.isResume(pausedElapsed: 42, totalSeconds: 300, isPaused: false, isActive: false))
    }

    @Test func testStartBeginsAgainForANewSitOrOnceTheClockHasRunOut() {
        #expect(!SessionLifecycleLogic.isResume(pausedElapsed: 0, totalSeconds: 300, isPaused: false, isActive: false))
        #expect(!SessionLifecycleLogic.isResume(pausedElapsed: 300, totalSeconds: 300, isPaused: true, isActive: false))
        #expect(!SessionLifecycleLogic.isResume(pausedElapsed: 300, totalSeconds: 300, isPaused: false, isActive: true))
    }

    /// #848: Pause then End Early leaves a paused clock that `isResume` would
    /// pick back up, so an ended sit has to refuse the start before that.
    @Test func testASitThatHasEndedNeverStartsAgain() {
        #expect(SessionLifecycleLogic.isResume(pausedElapsed: 125.5, totalSeconds: 300, isPaused: true, isActive: false))
        // Ran out, or ended early.
        #expect(!SessionLifecycleLogic.canStart(isComplete: true, isAbandoned: false))
        // Abandoned.
        #expect(!SessionLifecycleLogic.canStart(isComplete: true, isAbandoned: true))
        #expect(!SessionLifecycleLogic.canStart(isComplete: false, isAbandoned: true))
    }

    @Test func testASitThatHasNotEndedMayStart() {
        // Not yet begun, running, or paused.
        #expect(SessionLifecycleLogic.canStart(isComplete: false, isAbandoned: false))
    }

    @Test func testASitThatHasEndedCannotBeEndedAgain() {
        // Ran out, or ended early.
        #expect(!SessionLifecycleLogic.canEndSession(isComplete: true, isAbandoned: false))
        // Abandoned.
        #expect(!SessionLifecycleLogic.canEndSession(isComplete: true, isAbandoned: true))
        #expect(!SessionLifecycleLogic.canEndSession(isComplete: false, isAbandoned: true))
    }

    @Test func testASitThatHasNotEndedMayBeEnded() {
        // Not yet begun, running, or paused.
        #expect(SessionLifecycleLogic.canEndSession(isComplete: false, isAbandoned: false))
    }
}
