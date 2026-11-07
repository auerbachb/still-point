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
        // #1179: a whole minute with one minute left is a one-tap burst.
        #expect(
            HapticCueLogic.layeredRepeatingCue(
                hapticsEnabled: true,
                update: first,
                durationSeconds: 120,
                interval: .minute,
                nowSeconds: 60,
                isAbandoned: false
            ) == .minuteBurst(taps: 1)
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
        let crossed = HapticCueLogic.RepeatingHapticUpdate(completedIndex: 1, crossedBoundary: true)
        #expect(
            HapticCueLogic.layeredRepeatingCue(
                hapticsEnabled: false,
                update: crossed,
                durationSeconds: 300,
                interval: .minute,
                nowSeconds: 60,
                isAbandoned: false
            ) == nil
        )
        let second = HapticCueLogic.RepeatingHapticUpdate(completedIndex: 61, crossedBoundary: true)
        #expect(
            HapticCueLogic.layeredRepeatingCue(
                hapticsEnabled: true,
                update: second,
                durationSeconds: 300,
                interval: .everySecond,
                nowSeconds: 61,
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

    // MARK: - Every second (#1175)

    @Test func testOneSecondIsAValidInterval() {
        #expect(HapticCueLogic.Interval.seconds(validating: 1) == 1)
        #expect(HapticCueLogic.Interval.seconds(validating: 10) == 10)
        #expect(HapticCueLogic.Interval.seconds(validating: 60) == 60)
        #expect(HapticCueLogic.Interval.seconds(validating: 2) == nil)
        #expect(HapticCueLogic.Interval.everySecond.seconds == 1)
    }

    @Test func testOneSecondIntervalFiresOnEachCompletedSecond() {
        let first = update(elapsed: 1, duration: 5, interval: 1, last: 0)
        #expect(first.crossedBoundary)
        #expect(first.completedIndex == 1)

        let mid = update(elapsed: 1.5, duration: 5, interval: 1, last: 1)
        #expect(!mid.crossedBoundary)
        #expect(mid.completedIndex == 1)

        let second = update(elapsed: 2.02, duration: 5, interval: 1, last: 1)
        #expect(second.crossedBoundary)
        #expect(second.completedIndex == 2)
    }

    @Test func testOneSecondIntervalJumpFiresOnceAndDoesNotReplay() {
        let jumped = update(elapsed: 4.3, duration: 10, interval: 1, last: 1)
        #expect(jumped.crossedBoundary)
        #expect(jumped.completedIndex == 4)

        let next = update(elapsed: 4.8, duration: 10, interval: 1, last: jumped.completedIndex)
        #expect(!next.crossedBoundary)
        #expect(next.completedIndex == 4)
    }

    @Test func testOneSecondIntervalNeverLandsOnTheEndTick() {
        let end = update(elapsed: 5, duration: 5, interval: 1, last: 4)
        #expect(!end.crossedBoundary)
        #expect(end.completedIndex == 4)

        let seeded = HapticCueLogic.completedHapticIntervalIndex(
            elapsedSeconds: 5,
            durationSeconds: 5,
            intervalSeconds: 1
        )
        #expect(seeded == 4)
    }

    /// Off-minute, off-ten boundaries play each interval's own finest cue.
    @Test func testEachIntervalPlaysItsOwnFinestCue() {
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 61, durationSeconds: 300, interval: .everySecond) == .secondPulse)
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 70, durationSeconds: 300, interval: .tenSeconds) == .minuteMarker)
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 60, durationSeconds: 300, interval: .minute) == .minuteBurst(taps: 4))
    }

    // MARK: - Layering (#1179)

    /// Coincident boundaries play only the coarsest cue: burst > buzz > pulse.
    @Test func testACoincidentBoundaryPlaysOnlyTheHighestPriorityCue() {
        // 4:00 left in a 10-minute sit: minute, ten-second and second at once.
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 360, durationSeconds: 600, interval: .everySecond) == .minuteBurst(taps: 4))
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 360, durationSeconds: 600, interval: .tenSeconds) == .minuteBurst(taps: 4))
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 360, durationSeconds: 600, interval: .minute) == .minuteBurst(taps: 4))
        // A ten-second mark under every-second plays the buzz, not the pulse.
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 370, durationSeconds: 600, interval: .everySecond) == .minuteMarker)
    }

    /// Finer marks never play under a coarser interval.
    @Test func testACoarserIntervalNeverPlaysTheFinerCues() {
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 61, durationSeconds: 600, interval: .tenSeconds) == nil)
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 70, durationSeconds: 600, interval: .minute) == nil)
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 61, durationSeconds: 600, interval: .minute) == nil)
    }

    /// The burst taps the whole minutes left, with no cap: a long sit taps 30
    /// times at 30:00 left, and the final minute opens with a single tap.
    @Test func testTheBurstTapsOncePerWholeMinuteRemaining() {
        let hour = 3600
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 60, durationSeconds: hour, interval: .minute) == .minuteBurst(taps: 59))
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 1800, durationSeconds: hour, interval: .minute) == .minuteBurst(taps: 30))
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 3540, durationSeconds: hour, interval: .everySecond) == .minuteBurst(taps: 1))
        // Into the final minute: buzz and pulse only, then the end.
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 3550, durationSeconds: hour, interval: .everySecond) == .minuteMarker)
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 3599, durationSeconds: hour, interval: .everySecond) == .secondPulse)
    }

    /// A finer cue never lands while a burst is still playing, so the count
    /// is never muddled; the burst itself stays uncapped.
    @Test func testFinerCuesWaitForAPlayingBurstToFinish() {
        let hour = 3600
        // 30 minutes left: a 30-tap burst plays for 3.6 s.
        #expect(HapticCueLogic.minuteBurst.playingSeconds(taps: 30) > 3.5)
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 1801, durationSeconds: hour, interval: .everySecond) == nil)
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 1803, durationSeconds: hour, interval: .everySecond) == nil)
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 1804, durationSeconds: hour, interval: .everySecond) == .secondPulse)
        // 9 taps (1.08 s) outlast the next second; 8 taps (0.96 s) do not.
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 3061, durationSeconds: hour, interval: .everySecond) == nil)
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 3121, durationSeconds: hour, interval: .everySecond) == .secondPulse)
        // A two-hour sit: the 119-tap burst (14.3 s) swallows the :10 buzz, not the :20.
        let twoHours = 7200
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 60, durationSeconds: twoHours, interval: .tenSeconds) == .minuteBurst(taps: 119))
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 70, durationSeconds: twoHours, interval: .tenSeconds) == nil)
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 80, durationSeconds: twoHours, interval: .tenSeconds) == .minuteMarker)
    }

    /// 0:00 is the end cue's moment, never a 0-tap burst.
    @Test func testTheEndOfTheSitIsNeverABurst() {
        for interval in HapticCueLogic.Interval.allCases {
            #expect(HapticCueLogic.layeredCue(boundarySeconds: 300, durationSeconds: 300, interval: interval) == nil)
        }
    }

    /// A minute mark with less than a whole minute left (bonus seconds) is no
    /// burst; it falls through to the finer layers the interval allows.
    @Test func testAMinuteMarkWithoutAWholeMinuteLeftFallsThrough() {
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 60, durationSeconds: 90, interval: .minute) == nil)
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 60, durationSeconds: 90, interval: .tenSeconds) == .minuteMarker)
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 60, durationSeconds: 90, interval: .everySecond) == .minuteMarker)
        // 5:30 sit: 4:30 left at the first minute is four whole minutes.
        #expect(HapticCueLogic.layeredCue(boundarySeconds: 60, durationSeconds: 330, interval: .minute) == .minuteBurst(taps: 4))
    }

    /// #1176 still applies: a boundary first seen long after it passed is dropped.
    @Test func testALateBoundaryIsDropped() {
        let crossed = HapticCueLogic.RepeatingHapticUpdate(completedIndex: 2, crossedBoundary: true)
        let fire = { (now: Double) in
            HapticCueLogic.layeredRepeatingCue(
                hapticsEnabled: true,
                update: crossed,
                durationSeconds: 600,
                interval: .minute,
                nowSeconds: now,
                isAbandoned: false
            )
        }
        #expect(fire(120.02) == .minuteBurst(taps: 8))
        #expect(fire(120 + CueDeliveryLogic.maxLatenessSeconds) == .minuteBurst(taps: 8))
        #expect(fire(125) == nil)
    }

    /// The tap count and spacing come from one tunable constant.
    @Test func testTheBurstTuningIsOneConstantAndItsCapApplies() {
        #expect(HapticCueLogic.minuteBurst.tapSpacingSeconds >= 0.1)
        #expect(HapticCueLogic.minuteBurst.tapSpacingSeconds <= 0.15)
        #expect(HapticCueLogic.minuteBurst.maxTaps == nil)
        #expect(HapticCueLogic.minuteBurst.tapCount(wholeMinutesRemaining: 30) == 30)
        let capped = HapticCueLogic.MinuteBurstTuning(tapSpacingSeconds: 0.12, maxTaps: 10)
        #expect(capped.tapCount(wholeMinutesRemaining: 30) == 10)
        #expect(capped.tapCount(wholeMinutesRemaining: 3) == 3)
        #expect(capped.tapCount(wholeMinutesRemaining: 0) == 0)
    }

    @Test func testAFiringCarriesTapsOnlyForTheBurst() {
        #expect(HapticCueLogic.Firing(cue: .minuteMarker, taps: 5).taps == 1)
        #expect(HapticCueLogic.Firing.minuteBurst(taps: 0).taps == 1)
        #expect(HapticCueLogic.Firing.minuteBurst(taps: 7).taps == 7)
    }

    @Test func testEverySecondIntervalRoundTrips() throws {
        let original = AudioEngine.SoundPrefs(
            tick: false, chime: true, completion: true, haptics: true, hapticInterval: .everySecond
        )
        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: encoded)
        #expect(decoded.hapticInterval == .everySecond)
    }

    @Test func testUnknownIntervalDecodesAsEveryMinute() throws {
        let json = """
        {"tick":false,"chime":true,"completion":true,"voiceCountdown":false,"haptics":true,"hapticInterval":"everyHour"}
        """
        let data = try #require(json.data(using: .utf8))
        let prefs = try JSONDecoder().decode(AudioEngine.SoundPrefs.self, from: data)
        #expect(prefs.hapticInterval == .minute)
    }
}
