import XCTest
@testable import StillPointShared

final class HapticIntervalTests: XCTestCase {

    private func update(
        elapsed: Double,
        duration: Int,
        interval: Int,
        last: Int
    ) -> HapticCueLogic.RepeatingHapticUpdate {
        HapticCueLogic.repeatingHapticUpdate(
            elapsedSeconds: elapsed,
            durationSeconds: duration,
            intervalSeconds: interval,
            lastCompletedIndex: last
        )
    }

    func testSixtySecondIntervalFiresOnEachCompletedMinuteIncludingShortSits() {
        let first = update(elapsed: 60, duration: 120, interval: 60, last: 0)
        XCTAssertTrue(first.crossedBoundary)
        XCTAssertEqual(first.completedIndex, 1)
        XCTAssertEqual(
            HapticCueLogic.repeatingCue(
                hapticsEnabled: true,
                crossedBoundary: first.crossedBoundary,
                isAbandoned: false
            ),
            .minuteMarker
        )

        let second = update(elapsed: 120, duration: 180, interval: 60, last: 1)
        XCTAssertTrue(second.crossedBoundary)
        XCTAssertEqual(second.completedIndex, 2)

        // 90s never used minute blocks and has no full minute left at the mark.
        let short = update(elapsed: 60, duration: 90, interval: 60, last: 0)
        XCTAssertTrue(short.crossedBoundary)
    }

    func testTenSecondIntervalFiresOnEachCompletedTenSeconds() {
        let first = update(elapsed: 10, duration: 25, interval: 10, last: 0)
        XCTAssertTrue(first.crossedBoundary)
        XCTAssertEqual(first.completedIndex, 1)

        let second = update(elapsed: 20, duration: 25, interval: 10, last: 1)
        XCTAssertTrue(second.crossedBoundary)
        XCTAssertEqual(second.completedIndex, 2)
    }

    func testSitNoLongerThanTheIntervalDoesNotRepeat() {
        let exactlyMinute = update(elapsed: 60, duration: 60, interval: 60, last: 0)
        XCTAssertFalse(exactlyMinute.crossedBoundary)

        let shorter = update(elapsed: 30, duration: 45, interval: 60, last: 0)
        XCTAssertFalse(shorter.crossedBoundary)
    }

    func testCompletionTickDoesNotAlsoFireTheRepeatingCue() {
        let end = update(elapsed: 120, duration: 120, interval: 60, last: 1)
        XCTAssertFalse(end.crossedBoundary)
        XCTAssertEqual(end.completedIndex, 1)
    }

    func testAJumpFiresOnceAndDoesNotReplaySkippedMarks() {
        let jumped = update(elapsed: 25, duration: 40, interval: 10, last: 0)
        XCTAssertTrue(jumped.crossedBoundary)
        XCTAssertEqual(jumped.completedIndex, 2)

        let next = update(elapsed: 26, duration: 40, interval: 10, last: jumped.completedIndex)
        XCTAssertFalse(next.crossedBoundary)
    }

    func testOtherIntervalsAreRejected() {
        let thirty = update(elapsed: 30, duration: 90, interval: 30, last: 0)
        XCTAssertFalse(thirty.crossedBoundary)
        XCTAssertEqual(thirty.completedIndex, 0)
    }

    func testRepeatingCueStaysSilentWhenHapticsAreOffOrTheSitIsAbandoned() {
        XCTAssertNil(HapticCueLogic.repeatingCue(
            hapticsEnabled: false,
            crossedBoundary: true,
            isAbandoned: false
        ))
        XCTAssertNil(HapticCueLogic.repeatingCue(
            hapticsEnabled: true,
            crossedBoundary: true,
            isAbandoned: true
        ))
    }

    func testMissingIntervalDecodesAsEveryMinute() throws {
        let json = """
        {"tick":false,"chime":true,"completion":true,"voiceCountdown":false,"haptics":true}
        """
        let data = try XCTUnwrap(json.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)
        XCTAssertEqual(prefs.hapticInterval, .minute)
        XCTAssertEqual(prefs.hapticInterval.seconds, 60)
    }

    func testTenSecondIntervalRoundTrips() throws {
        let original = AudioEngine.SoundPrefs(
            tick: false, chime: true, completion: true, haptics: true, hapticInterval: .tenSeconds
        )
        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: encoded)
        XCTAssertEqual(decoded.hapticInterval, .tenSeconds)
    }
}
