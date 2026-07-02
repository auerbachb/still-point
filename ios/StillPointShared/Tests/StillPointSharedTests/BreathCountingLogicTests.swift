import XCTest
@testable import StillPointShared

final class BreathCountingLogicTests: XCTestCase {

    // MARK: - breathCount(forTaps:)

    func testBreathCountZeroTaps() {
        XCTAssertEqual(BreathCounting.breathCount(forTaps: 0), 0)
    }

    func testBreathCountOneTap() {
        // 1 tap = inhale registered, no complete breath yet
        XCTAssertEqual(BreathCounting.breathCount(forTaps: 1), 0)
    }

    func testBreathCountTwoTaps() {
        // 2 taps = 1 full breath (inhale + exhale)
        XCTAssertEqual(BreathCounting.breathCount(forTaps: 2), 1)
    }

    func testBreathCountFiveTaps() {
        // 5 taps = 2 full breaths (4 taps) + 1 pending inhale
        XCTAssertEqual(BreathCounting.breathCount(forTaps: 5), 2)
    }

    func testBreathCountEvenTaps() {
        XCTAssertEqual(BreathCounting.breathCount(forTaps: 10), 5)
    }

    // MARK: - phase(forTaps:)

    func testPhaseAtZeroTapsIsInhale() {
        // No taps yet → next action is inhale
        XCTAssertEqual(BreathCounting.phase(forTaps: 0), .inhale)
    }

    func testPhaseAfterOneTapIsExhale() {
        // 1 tap recorded (inhale done) → next is exhale
        XCTAssertEqual(BreathCounting.phase(forTaps: 1), .exhale)
    }

    func testPhaseAfterTwoTapsIsInhale() {
        // 2 taps (full breath done) → next is inhale
        XCTAssertEqual(BreathCounting.phase(forTaps: 2), .inhale)
    }

    func testPhaseAlternatesCorrectly() {
        // Even = inhale, odd = exhale
        for taps in 0...10 {
            let expected: BreathPhase = taps % 2 == 0 ? .inhale : .exhale
            XCTAssertEqual(
                BreathCounting.phase(forTaps: taps), expected,
                "phase(forTaps: \(taps)) should be \(expected)"
            )
        }
    }

    // MARK: - elapsedSeconds(since:now:)

    func testElapsedSecondsZero() {
        let now = Date()
        XCTAssertEqual(BreathCounting.elapsedSeconds(since: now, now: now), 0)
    }

    func testElapsedSecondsPositive() {
        let start = Date()
        let later = start.addingTimeInterval(65)
        XCTAssertEqual(BreathCounting.elapsedSeconds(since: start, now: later), 65)
    }

    func testElapsedSecondsClampedToZeroForNegativeDiff() {
        // now is before start — should clamp to 0, not return negative
        let start = Date()
        let before = start.addingTimeInterval(-5)
        XCTAssertEqual(BreathCounting.elapsedSeconds(since: start, now: before), 0)
    }

    func testElapsedSecondsAcrossOneMinute() {
        let start = Date()
        let later = start.addingTimeInterval(90)
        XCTAssertEqual(BreathCounting.elapsedSeconds(since: start, now: later), 90)
    }

    func testElapsedSecondsTruncatesNotRounds() {
        // 59.9 seconds → 59, not 60
        let start = Date()
        let later = start.addingTimeInterval(59.9)
        XCTAssertEqual(BreathCounting.elapsedSeconds(since: start, now: later), 59)
    }

    // MARK: - elapsedDisplay(_:)

    func testElapsedDisplayZero() {
        XCTAssertEqual(BreathCounting.elapsedDisplay(0), "0:00")
    }

    func testElapsedDisplayOneMinuteFiveSeconds() {
        XCTAssertEqual(BreathCounting.elapsedDisplay(65), "1:05")
    }

    func testElapsedDisplayTenMinutes() {
        XCTAssertEqual(BreathCounting.elapsedDisplay(600), "10:00")
    }

    func testElapsedDisplayNineSeconds() {
        XCTAssertEqual(BreathCounting.elapsedDisplay(9), "0:09")
    }

    func testElapsedDisplayOneHour() {
        XCTAssertEqual(BreathCounting.elapsedDisplay(3600), "60:00")
    }

    func testElapsedDisplayClampedNegative() {
        // Negative input is treated as 0
        XCTAssertEqual(BreathCounting.elapsedDisplay(-5), "0:00")
    }

    // MARK: - Shared cross-platform fixtures (#421)

    // The same golden set is asserted by web breathCountForTaps / phaseForTaps /
    // elapsedDisplay. Only non-negative taps are shared (web clamps negatives, iOS
    // does not), so those stay in the per-suite tests above.
    func testSharedBreathCountingFixtures() throws {
        let fixture = try SharedFixtures.load("breathCounting.json", as: BreathCountingFixture.self)

        for testCase in fixture.breathCount {
            XCTAssertEqual(BreathCounting.breathCount(forTaps: testCase.taps), testCase.expected, "breathCount(\(testCase.taps))")
        }
        for testCase in fixture.phase {
            let expected: BreathPhase = testCase.expected == "inhale" ? .inhale : .exhale
            XCTAssertEqual(BreathCounting.phase(forTaps: testCase.taps), expected, "phase(\(testCase.taps))")
        }
        for testCase in fixture.elapsedDisplay {
            XCTAssertEqual(BreathCounting.elapsedDisplay(testCase.seconds), testCase.expected, "elapsedDisplay(\(testCase.seconds))")
        }
    }
}
