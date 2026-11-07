import Foundation

/// #712 — pure decision logic for the session haptic cues.
///
/// Haptics exist for the sitter who keeps their eyes closed and wants no sound
/// at all: the phone marks each minute and the end of the sit by feel instead.
/// It is opt-in and off by default — a sit that has never asked for vibration
/// must stay perfectly still.
///
/// The rules for *when* a cue fires and *how strong* it should be live here so
/// `swift test` can hold them. The UIKit generators that actually vibrate stay
/// in the app target, which this package cannot import.
///
/// Free of UIKit / CoreHaptics so it compiles and runs under `swift test` on macOS.
public enum HapticCueLogic {

    /// The moments a sit announces by feel.
    public enum Cue: String, Sendable, Hashable, CaseIterable {
        /// A ten-second mark just passed — the firm buzz. Since #1179 a whole
        /// minute plays `minuteBurst` instead; the name predates that.
        case minuteMarker
        /// #1175: another second of the sit passed — the every-second interval.
        case secondPulse
        /// #1179: a whole-minute mark, as one rapid tap per whole minute left.
        /// The tap count travels on `Firing.taps`.
        case minuteBurst
        /// The sit ran its full length.
        case sessionEnd
    }

    /// #1179: the minute countdown burst's tuning, in one place so the owner
    /// can retune it after a device test.
    public struct MinuteBurstTuning: Equatable, Sendable {
        /// Seconds from one tap's onset to the next — rapid, yet countable.
        public let tapSpacingSeconds: Double
        /// Most taps one burst plays, or nil for no cap (one per whole minute).
        public let maxTaps: Int?

        public init(tapSpacingSeconds: Double, maxTaps: Int?) {
            self.tapSpacingSeconds = tapSpacingSeconds
            self.maxTaps = maxTaps
        }

        /// The taps owed with `wholeMinutesRemaining` whole minutes left.
        public func tapCount(wholeMinutesRemaining: Int) -> Int {
            let minutes = max(0, wholeMinutesRemaining)
            guard let maxTaps else { return minutes }
            return min(minutes, max(1, maxTaps))
        }

        /// How long a burst of `taps` holds the haptic engine, onset of the
        /// first tap to one spacing past the last. A finer cue that falls
        /// inside it is suppressed by `layeredCue`, so it cannot muddle the
        /// count the sitter is following.
        public func playingSeconds(taps: Int) -> Double {
            Double(max(0, taps)) * tapSpacingSeconds
        }
    }

    /// #1179: the one tunable constant behind the burst — about 120 ms apart,
    /// no cap, so 30 minutes left is 30 taps (about 3.6 s). Web mirrors it as
    /// `MINUTE_BURST` in `src/lib/haptics.ts`.
    public static let minuteBurst = MinuteBurstTuning(tapSpacingSeconds: 0.12, maxTaps: nil)

    /// One cue to play, with how many taps when it is a minute burst.
    ///
    /// Every cue but the burst plays exactly once, so `taps` is 1 for those.
    public struct Firing: Hashable, Sendable {
        public let cue: Cue
        public let taps: Int

        public init(cue: Cue, taps: Int = 1) {
            self.cue = cue
            self.taps = cue == .minuteBurst ? max(1, taps) : 1
        }

        public static let secondPulse = Firing(cue: .secondPulse)
        public static let minuteMarker = Firing(cue: .minuteMarker)
        public static let sessionEnd = Firing(cue: .sessionEnd)

        public static func minuteBurst(taps: Int) -> Firing {
            Firing(cue: .minuteBurst, taps: taps)
        }
    }

    /// How a cue should feel.
    ///
    /// The end of a sit has to be tellable from a marker with your eyes shut,
    /// and the every-second pulse from both, so no two cues share a value —
    /// that inequality is the point of the type, and `HapticCueLogicTests`
    /// asserts it directly.
    public enum Intensity: String, Sendable, Equatable, CaseIterable {
        /// #1175: a single tiny tap, light enough to repeat every second.
        case pulse
        /// A firm buzz for each ten-second mark.
        case marker
        /// #1179: the crisp, rapid taps of the minute countdown burst.
        case burst
        /// The end of the sit — a different shape again.
        case pronounced
    }

    /// Maps a cue to the strength the app target should play it at.
    public static func intensity(for cue: Cue) -> Intensity {
        switch cue {
        case .secondPulse:  return .pulse
        case .minuteMarker: return .marker
        case .minuteBurst:  return .burst
        case .sessionEnd:   return .pronounced
        }
    }

    /// The cue owed when a minute block has just completed, or nil for stillness.
    ///
    /// Deliberately *not* gated on the chime preference or on voice-countdown
    /// suppression: haptics is the channel for someone who has turned sound off,
    /// so silencing the bell must not silence the buzz.
    ///
    /// It *is* gated on `fullMinuteRemains` — the bell's own rule (#711) — so
    /// both channels mark the same instants and a marker never lands a few
    /// seconds before the end cue, which would read as one stuttered buzz
    /// rather than two distinct events.
    ///
    /// - Parameters:
    ///   - hapticsEnabled: The `haptics` sound preference.
    ///   - crossedMinuteBoundary: A new minute block completed on this tick.
    ///   - fullMinuteRemains: At least one whole minute is still to go
    ///     (`MinuteChimeUpdate.chimeCount != nil`).
    ///   - isAbandoned: The sitter discarded the sit; nothing should fire after.
    public static func minuteMarkerCue(
        hapticsEnabled: Bool,
        crossedMinuteBoundary: Bool,
        fullMinuteRemains: Bool,
        isAbandoned: Bool
    ) -> Cue? {
        guard hapticsEnabled,
              crossedMinuteBoundary,
              fullMinuteRemains,
              !isAbandoned
        else { return nil }
        return .minuteMarker
    }

    /// How often the repeating haptic fires — the *finest* cue the sitter
    /// picked. Since #1179 every coarser cue still plays on top of it; see
    /// `layeredCue`. Only these three values exist.
    public enum Interval: String, Codable, CaseIterable, Sendable, Equatable {
        case minute
        case tenSeconds
        /// #1175: the tiny pulse, once a second.
        case everySecond

        public var seconds: Int {
            switch self {
            case .minute: return 60
            case .tenSeconds: return 10
            case .everySecond: return 1
            }
        }

        public static func seconds(validating raw: Int) -> Int? {
            raw == 1 || raw == 10 || raw == 60 ? raw : nil
        }
    }

    /// Highest completed interval strictly before the end of the sit.
    ///
    /// An elapsed time already at the duration counts the last mark before the
    /// end, so seeding at the completion tick does not treat the end itself as
    /// a repeating boundary.
    public static func completedHapticIntervalIndex(
        elapsedSeconds: Double,
        durationSeconds: Int,
        intervalSeconds: Int
    ) -> Int {
        guard Interval.seconds(validating: intervalSeconds) != nil,
              elapsedSeconds >= 0,
              durationSeconds > 0
        else { return 0 }
        let capped = min(elapsedSeconds, Double(durationSeconds) - 0.000_000_1)
        return Int(floor(max(0, capped) / Double(intervalSeconds)))
    }

    public struct RepeatingHapticUpdate: Equatable, Sendable {
        public let completedIndex: Int
        public let crossedBoundary: Bool

        public init(completedIndex: Int, crossedBoundary: Bool) {
            self.completedIndex = completedIndex
            self.crossedBoundary = crossedBoundary
        }
    }

    /// Session-origin repeating haptic. Independent of minute blocks.
    ///
    /// A sit has to be longer than one interval. The boundary that lands on the
    /// end of the sit is not a repeating cue — that tick belongs to the end
    /// buzz. A jump across several boundaries fires once and moves the cursor
    /// to the latest one, so earlier marks are not replayed.
    public static func repeatingHapticUpdate(
        elapsedSeconds: Double,
        durationSeconds: Int,
        intervalSeconds: Int,
        lastCompletedIndex: Int
    ) -> RepeatingHapticUpdate {
        guard Interval.seconds(validating: intervalSeconds) != nil,
              durationSeconds > intervalSeconds,
              elapsedSeconds >= 0
        else {
            return RepeatingHapticUpdate(
                completedIndex: lastCompletedIndex,
                crossedBoundary: false
            )
        }

        if elapsedSeconds >= Double(durationSeconds) {
            let finalIndex = completedHapticIntervalIndex(
                elapsedSeconds: Double(durationSeconds),
                durationSeconds: durationSeconds,
                intervalSeconds: intervalSeconds
            )
            return RepeatingHapticUpdate(
                completedIndex: max(lastCompletedIndex, finalIndex),
                crossedBoundary: false
            )
        }

        let completedIndex = Int(floor(elapsedSeconds / Double(intervalSeconds)))
        let boundary = completedIndex * intervalSeconds
        let crossed = completedIndex > lastCompletedIndex
            && completedIndex >= 1
            && boundary < durationSeconds
        return RepeatingHapticUpdate(
            completedIndex: max(lastCompletedIndex, completedIndex),
            crossedBoundary: crossed
        )
    }

    /// #1179: whole minutes still to go at `elapsedSeconds` into the sit.
    public static func wholeMinutesRemaining(elapsedSeconds: Int, durationSeconds: Int) -> Int {
        max(0, durationSeconds - elapsedSeconds) / 60
    }

    /// #1179: the one cue a boundary of `interval` plays at `boundarySeconds`
    /// into the sit, or nil.
    ///
    /// The interval is the finest cue; every coarser one still plays, and a
    /// boundary that is several at once plays only the coarsest: minute
    /// burst, then ten-second buzz, then second pulse. The end of the sit
    /// outranks them all and is never a boundary here — it stays on
    /// `sessionEndCue`, so 0:00 is the end cue, not a 0-tap burst.
    ///
    /// A whole-minute mark plays the burst only while at least one whole
    /// minute remains — the bell's rule (#711). A mark with less left (a sit
    /// with bonus seconds) falls through to the next finer layer the interval
    /// allows, so every-minute mode stays still there.
    ///
    /// A finer cue (buzz or pulse) whose boundary falls while the latest
    /// minute burst is still playing (`MinuteBurstTuning.playingSeconds`) is
    /// suppressed: 30 minutes left is a 3.6 s burst, and a pulse each second
    /// on top of it would muddle the count. The burst itself is never capped.
    public static func layeredCue(
        boundarySeconds: Int,
        durationSeconds: Int,
        interval: Interval
    ) -> Firing? {
        guard boundarySeconds > 0,
              boundarySeconds < durationSeconds,
              boundarySeconds % interval.seconds == 0
        else { return nil }
        if boundarySeconds % 60 == 0 {
            let taps = minuteBurst.tapCount(
                wholeMinutesRemaining: wholeMinutesRemaining(
                    elapsedSeconds: boundarySeconds,
                    durationSeconds: durationSeconds
                )
            )
            if taps >= 1 { return .minuteBurst(taps: taps) }
        }
        if isInsidePlayingBurst(boundarySeconds: boundarySeconds, durationSeconds: durationSeconds) {
            return nil
        }
        if interval != .minute, boundarySeconds % 10 == 0 { return .minuteMarker }
        if interval == .everySecond { return .secondPulse }
        return nil
    }

    /// Whether `boundarySeconds` falls while the burst from the latest
    /// whole-minute mark before it is still playing.
    static func isInsidePlayingBurst(boundarySeconds: Int, durationSeconds: Int) -> Bool {
        let minuteMark = (boundarySeconds / 60) * 60
        guard minuteMark > 0, minuteMark < boundarySeconds else { return false }
        let taps = minuteBurst.tapCount(
            wholeMinutesRemaining: wholeMinutesRemaining(
                elapsedSeconds: minuteMark,
                durationSeconds: durationSeconds
            )
        )
        guard taps >= 1 else { return false }
        return Double(boundarySeconds - minuteMark) < minuteBurst.playingSeconds(taps: taps)
    }

    /// The repeating cue owed by `update`, layered per `layeredCue`, or nil.
    /// The end cue stays on `sessionEndCue`.
    ///
    /// #1176: on time or not at all. A boundary first seen more than
    /// `CueDeliveryLogic.maxLatenessSeconds` after it passed (the app was
    /// suspended through it) is dropped rather than buzzed at a random moment.
    ///
    /// - Parameters:
    ///   - update: This tick's `repeatingHapticUpdate`; the boundary is its
    ///     newest completed interval.
    ///   - nowSeconds: Elapsed seconds on this tick, on the sit's clock.
    public static func layeredRepeatingCue(
        hapticsEnabled: Bool,
        update: RepeatingHapticUpdate,
        durationSeconds: Int,
        interval: Interval,
        nowSeconds: Double,
        isAbandoned: Bool
    ) -> Firing? {
        guard hapticsEnabled, update.crossedBoundary, !isAbandoned else { return nil }
        let boundary = update.completedIndex * interval.seconds
        guard CueDeliveryLogic.isOnTime(dueAt: Double(boundary), now: nowSeconds) else { return nil }
        return layeredCue(boundarySeconds: boundary, durationSeconds: durationSeconds, interval: interval)
    }

    /// The cue owed as the timer runs out, or nil for stillness.
    ///
    /// Only a sit that ran its full length earns the end cue. Ending early keeps
    /// the data but was the sitter's own decision, and abandoning discards it —
    /// neither wants a congratulatory buzz. This mirrors the completion sound,
    /// which the view model also plays only on the natural-completion path.
    ///
    /// - Parameters:
    ///   - hapticsEnabled: The `haptics` sound preference.
    ///   - completedNaturally: The timer reached the full duration on its own.
    ///   - isAbandoned: The sitter discarded the sit.
    public static func sessionEndCue(
        hapticsEnabled: Bool,
        completedNaturally: Bool,
        isAbandoned: Bool
    ) -> Cue? {
        guard hapticsEnabled,
              completedNaturally,
              !isAbandoned
        else { return nil }
        return .sessionEnd
    }

    /// Timing events for one tick of a buddy sit (#736).
    ///
    /// Buddy sits do not keep a haptics-only clock. These signals are read from
    /// the same minute-block clock the bell uses (`SessionLogic.nextMinuteChimeUpdate`),
    /// so a later buddy chime and the buzz mark the same instants.
    public struct BuddyTimerCueSignals: Sendable, Equatable {
        /// A new minute block completed on this tick.
        public let crossedMinuteBoundary: Bool
        /// At least one whole minute is still to go (`MinuteChimeUpdate.chimeCount != nil`).
        public let fullMinuteRemains: Bool
        /// The shared timer reached the full duration on this tick, and has not
        /// already announced that.
        public let completedNaturally: Bool
        public let updatedCompletedBlockIndex: Int
        /// Sticky once natural completion has been reported, so a 1s timer
        /// waiting on the snapshot does not buzz again.
        public let sessionEndAlreadyEmitted: Bool
    }

    /// Derives the buddy sit's minute-boundary and natural-completion events.
    ///
    /// `remainingSeconds == 0` is the natural-completion path and suppresses the
    /// minute marker, matching solo: the end cue and a marker must not land on
    /// the same tick. A boundary inside the final minute still reports
    /// `crossedMinuteBoundary` with `fullMinuteRemains == false`, and
    /// `minuteMarkerCue` stays silent.
    ///
    /// - Parameters:
    ///   - remainingSeconds: Whole seconds left on the shared timer.
    ///   - durationSeconds: Planned length of the sit.
    ///   - lastCompletedBlockIndex: Highest minute block already observed.
    ///     Pass the index seeded from server elapsed when the window opens so
    ///     a sit joined mid-way does not replay markers that already passed.
    ///   - sessionEndAlreadyEmitted: True after natural completion has been
    ///     reported for this window, including when the window opened already
    ///     at full duration.
    public static func buddyTimerCueSignals(
        remainingSeconds: Int,
        durationSeconds: Int,
        lastCompletedBlockIndex: Int,
        sessionEndAlreadyEmitted: Bool
    ) -> BuddyTimerCueSignals {
        guard durationSeconds > 0, remainingSeconds >= 0 else {
            return BuddyTimerCueSignals(
                crossedMinuteBoundary: false,
                fullMinuteRemains: false,
                completedNaturally: false,
                updatedCompletedBlockIndex: lastCompletedBlockIndex,
                sessionEndAlreadyEmitted: sessionEndAlreadyEmitted
            )
        }

        if remainingSeconds == 0 {
            return BuddyTimerCueSignals(
                crossedMinuteBoundary: false,
                fullMinuteRemains: false,
                completedNaturally: !sessionEndAlreadyEmitted,
                updatedCompletedBlockIndex: lastCompletedBlockIndex,
                sessionEndAlreadyEmitted: true
            )
        }

        // A clock that steps backward after the end cue must not mark another
        // minute or announce the end a second time.
        if sessionEndAlreadyEmitted {
            return BuddyTimerCueSignals(
                crossedMinuteBoundary: false,
                fullMinuteRemains: false,
                completedNaturally: false,
                updatedCompletedBlockIndex: lastCompletedBlockIndex,
                sessionEndAlreadyEmitted: true
            )
        }

        let elapsed = Double(durationSeconds - remainingSeconds)
        let update = SessionLogic.nextMinuteChimeUpdate(
            elapsed: elapsed,
            totalSeconds: durationSeconds,
            lastCompletedBlockIndex: lastCompletedBlockIndex
        )
        let crossedMinuteBoundary = update.updatedCompletedBlockIndex > lastCompletedBlockIndex
        return BuddyTimerCueSignals(
            crossedMinuteBoundary: crossedMinuteBoundary,
            fullMinuteRemains: update.chimeCount != nil,
            completedNaturally: false,
            updatedCompletedBlockIndex: update.updatedCompletedBlockIndex,
            sessionEndAlreadyEmitted: false
        )
    }
}
