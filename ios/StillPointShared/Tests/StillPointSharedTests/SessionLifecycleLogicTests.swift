import XCTest
@testable import StillPointShared

/// #1024 — whether a solo sit may start, resume or end. Moved here from
/// `SessionTickLogicTests` with the gates themselves, unchanged.
final class SessionLifecycleLogicTests: XCTestCase {

    func testStartPicksUpAPausedOrRunningSit() {
        XCTAssertTrue(SessionLifecycleLogic.isResume(pausedElapsed: 125.5, totalSeconds: 300, isPaused: true, isActive: false))
        // Paused before the first tick landed.
        XCTAssertTrue(SessionLifecycleLogic.isResume(pausedElapsed: 0, totalSeconds: 300, isPaused: true, isActive: false))
        // Started again while already running.
        XCTAssertTrue(SessionLifecycleLogic.isResume(pausedElapsed: 0, totalSeconds: 300, isPaused: false, isActive: true))
        // Clock part-way through, neither paused nor running.
        XCTAssertTrue(SessionLifecycleLogic.isResume(pausedElapsed: 42, totalSeconds: 300, isPaused: false, isActive: false))
    }

    func testStartBeginsAgainForANewSitOrOnceTheClockHasRunOut() {
        XCTAssertFalse(SessionLifecycleLogic.isResume(pausedElapsed: 0, totalSeconds: 300, isPaused: false, isActive: false))
        XCTAssertFalse(SessionLifecycleLogic.isResume(pausedElapsed: 300, totalSeconds: 300, isPaused: true, isActive: false))
        XCTAssertFalse(SessionLifecycleLogic.isResume(pausedElapsed: 300, totalSeconds: 300, isPaused: false, isActive: true))
    }

    /// #848: Pause then End Early leaves a paused clock that `isResume` would
    /// pick back up, so an ended sit has to refuse the start before that.
    func testASitThatHasEndedNeverStartsAgain() {
        XCTAssertTrue(SessionLifecycleLogic.isResume(pausedElapsed: 125.5, totalSeconds: 300, isPaused: true, isActive: false))
        // Ran out, or ended early.
        XCTAssertFalse(SessionLifecycleLogic.canStart(isComplete: true, isAbandoned: false))
        // Abandoned.
        XCTAssertFalse(SessionLifecycleLogic.canStart(isComplete: true, isAbandoned: true))
        XCTAssertFalse(SessionLifecycleLogic.canStart(isComplete: false, isAbandoned: true))
    }

    func testASitThatHasNotEndedMayStart() {
        // Not yet begun, running, or paused.
        XCTAssertTrue(SessionLifecycleLogic.canStart(isComplete: false, isAbandoned: false))
    }

    func testASitThatHasEndedCannotBeEndedAgain() {
        // Ran out, or ended early.
        XCTAssertFalse(SessionLifecycleLogic.canEndSession(isComplete: true, isAbandoned: false))
        // Abandoned.
        XCTAssertFalse(SessionLifecycleLogic.canEndSession(isComplete: true, isAbandoned: true))
        XCTAssertFalse(SessionLifecycleLogic.canEndSession(isComplete: false, isAbandoned: true))
    }

    func testASitThatHasNotEndedMayBeEnded() {
        // Not yet begun, running, or paused.
        XCTAssertTrue(SessionLifecycleLogic.canEndSession(isComplete: false, isAbandoned: false))
    }
}
