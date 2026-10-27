import Foundation
import Testing
@testable import StillPointShared

struct HapticIntervalTests {

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

    @Test func testSixtySecondIntervalFiresOnEachCompletedMinuteIncludingShortSits() {
        let first = update(elapsed: 60, duration: 120, interval: 60, last: 0)
        #expect(first.crossedBoundary)
        #expect(first.completedIndex == 1)
        #expect(
            HapticCueLogic.repeatingCue(
                hapticsEnabled: true,
                crossedBoundary: first.crossedBoundary,
                isAbandoned: false
            ) == .minuteMarker
        )

        let second = update(elapsed: 120, duration: 180, interval: 60, last: 1)
        #expect(second.crossedBoundary)
        #expect(second.completedIndex == 2)

        // 90s never used minute blocks and has no full minute left at the mark.
        let short = update(elapsed: 60, duration: 90, interval: 60, last: 0)
        #expect(short.crossedBoundary)
    }

    @Test func testTenSecondIntervalFiresOnEachCompletedTenSeconds() {
        let first = update(elapsed: 10, duration: 25, interval: 10, last: 0)
        #expect(first.crossedBoundary)
        #expect(first.completedIndex == 1)

        let second = update(elapsed: 20, duration: 25, interval: 10, last: 1)
        #expect(second.crossedBoundary)
        #expect(second.completedIndex == 2)
    }

    @Test func testSitNoLongerThanTheIntervalDoesNotRepeat() {
        let exactlyMinute = update(elapsed: 60, duration: 60, interval: 60, last: 0)
        #expect(!exactlyMinute.crossedBoundary)

        let shorter = update(elapsed: 30, duration: 45, interval: 60, last: 0)
        #expect(!shorter.crossedBoundary)
    }

    @Test func testCompletionTickDoesNotAlsoFireTheRepeatingCue() {
        let end = update(elapsed: 120, duration: 120, interval: 60, last: 1)
        #expect(!end.crossedBoundary)
        #expect(end.completedIndex == 1)
    }

    @Test func testAJumpFiresOnceAndDoesNotReplaySkippedMarks() {
        let jumped = update(elapsed: 25, duration: 40, interval: 10, last: 0)
        #expect(jumped.crossedBoundary)
        #expect(jumped.completedIndex == 2)

        let next = update(elapsed: 26, duration: 40, interval: 10, last: jumped.completedIndex)
        #expect(!next.crossedBoundary)
    }

    @Test func testOtherIntervalsAreRejected() {
        let thirty = update(elapsed: 30, duration: 90, interval: 30, last: 0)
        #expect(!thirty.crossedBoundary)
        #expect(thirty.completedIndex == 0)
    }

    @Test func testRepeatingCueStaysSilentWhenHapticsAreOffOrTheSitIsAbandoned() {
        #expect(
            HapticCueLogic.repeatingCue(
                hapticsEnabled: false,
                crossedBoundary: true,
                isAbandoned: false
            ) == nil
        )
        #expect(
            HapticCueLogic.repeatingCue(
                hapticsEnabled: true,
                crossedBoundary: true,
                isAbandoned: true
            ) == nil
        )
    }

    @Test func testMissingIntervalDecodesAsEveryMinute() throws {
        let json = """
        {"tick":false,"chime":true,"completion":true,"voiceCountdown":false,"haptics":true}
        """
        let data = try #require(json.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)
        #expect(prefs.hapticInterval == .minute)
        #expect(prefs.hapticInterval.seconds == 60)
    }

    @Test func testTenSecondIntervalRoundTrips() throws {
        let original = AudioEngine.SoundPrefs(
            tick: false, chime: true, completion: true, haptics: true, hapticInterval: .tenSeconds
        )
        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: encoded)
        #expect(decoded.hapticInterval == .tenSeconds)
    }
}
