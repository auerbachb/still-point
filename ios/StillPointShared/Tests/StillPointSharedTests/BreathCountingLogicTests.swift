import Foundation
import Testing
@testable import StillPointShared

struct BreathCountingLogicTests {

    // MARK: - breathCount(forTaps:)

    @Test func testBreathCountZeroTaps() {
        #expect(BreathCounting.breathCount(forTaps: 0) == 0)
    }

    @Test func testBreathCountOneTap() {
        // 1 tap = inhale registered, no complete breath yet
        #expect(BreathCounting.breathCount(forTaps: 1) == 0)
    }

    @Test func testBreathCountTwoTaps() {
        // 2 taps = 1 full breath (inhale + exhale)
        #expect(BreathCounting.breathCount(forTaps: 2) == 1)
    }

    @Test func testBreathCountFiveTaps() {
        // 5 taps = 2 full breaths (4 taps) + 1 pending inhale
        #expect(BreathCounting.breathCount(forTaps: 5) == 2)
    }

    @Test func testBreathCountEvenTaps() {
        #expect(BreathCounting.breathCount(forTaps: 10) == 5)
    }

    // MARK: - phase(forTaps:)

    @Test func testPhaseAtZeroTapsIsInhale() {
        // No taps yet → next action is inhale
        #expect(BreathCounting.phase(forTaps: 0) == .inhale)
    }

    @Test func testPhaseAfterOneTapIsExhale() {
        // 1 tap recorded (inhale done) → next is exhale
        #expect(BreathCounting.phase(forTaps: 1) == .exhale)
    }

    @Test func testPhaseAfterTwoTapsIsInhale() {
        // 2 taps (full breath done) → next is inhale
        #expect(BreathCounting.phase(forTaps: 2) == .inhale)
    }

    @Test func testPhaseAlternatesCorrectly() {
        // Even = inhale, odd = exhale
        for taps in 0...10 {
            let expected: BreathPhase = taps % 2 == 0 ? .inhale : .exhale
            #expect(BreathCounting.phase(forTaps: taps) == expected, "phase(forTaps: \(taps)) should be \(expected)")
        }
    }

    // MARK: - elapsedSeconds(since:now:)

    @Test func testElapsedSecondsZero() {
        let now = Date()
        #expect(BreathCounting.elapsedSeconds(since: now, now: now) == 0)
    }

    @Test func testElapsedSecondsPositive() {
        let start = Date()
        let later = start.addingTimeInterval(65)
        #expect(BreathCounting.elapsedSeconds(since: start, now: later) == 65)
    }

    @Test func testElapsedSecondsClampedToZeroForNegativeDiff() {
        // now is before start — should clamp to 0, not return negative
        let start = Date()
        let before = start.addingTimeInterval(-5)
        #expect(BreathCounting.elapsedSeconds(since: start, now: before) == 0)
    }

    @Test func testElapsedSecondsAcrossOneMinute() {
        let start = Date()
        let later = start.addingTimeInterval(90)
        #expect(BreathCounting.elapsedSeconds(since: start, now: later) == 90)
    }

    @Test func testElapsedSecondsTruncatesNotRounds() {
        // 59.9 seconds → 59, not 60
        let start = Date()
        let later = start.addingTimeInterval(59.9)
        #expect(BreathCounting.elapsedSeconds(since: start, now: later) == 59)
    }

    // MARK: - elapsedDisplay(_:)

    @Test func testElapsedDisplayZero() {
        #expect(BreathCounting.elapsedDisplay(0) == "0:00")
    }

    @Test func testElapsedDisplayOneMinuteFiveSeconds() {
        #expect(BreathCounting.elapsedDisplay(65) == "1:05")
    }

    @Test func testElapsedDisplayTenMinutes() {
        #expect(BreathCounting.elapsedDisplay(600) == "10:00")
    }

    @Test func testElapsedDisplayNineSeconds() {
        #expect(BreathCounting.elapsedDisplay(9) == "0:09")
    }

    @Test func testElapsedDisplayOneHour() {
        #expect(BreathCounting.elapsedDisplay(3600) == "60:00")
    }

    @Test func testElapsedDisplayClampedNegative() {
        // Negative input is treated as 0
        #expect(BreathCounting.elapsedDisplay(-5) == "0:00")
    }

    // MARK: - Shared cross-platform fixtures (#421)

    // The same golden set is asserted by web breathCountForTaps / phaseForTaps /
    // elapsedDisplay. Only non-negative taps are shared (web clamps negatives, iOS
    // does not), so those stay in the per-suite tests above.
    @Test func testSharedBreathCountingFixtures() throws {
        let fixture = try SharedFixtures.load("breathCounting.json", as: BreathCountingFixture.self)

        for testCase in fixture.breathCount {
            #expect(BreathCounting.breathCount(forTaps: testCase.taps) == testCase.expected, "breathCount(\(testCase.taps))")
        }
        for testCase in fixture.phase {
            let expected: BreathPhase = testCase.expected == "inhale" ? .inhale : .exhale
            #expect(BreathCounting.phase(forTaps: testCase.taps) == expected, "phase(\(testCase.taps))")
        }
        for testCase in fixture.elapsedDisplay {
            #expect(BreathCounting.elapsedDisplay(testCase.seconds) == testCase.expected, "elapsedDisplay(\(testCase.seconds))")
        }
    }
}
