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

    /// The two moments a sit announces by feel.
    public enum Cue: String, Sendable, Equatable, CaseIterable {
        /// A minute block just completed — the same instant the bell strikes.
        case minuteMarker
        /// The sit ran its full length.
        case sessionEnd
    }

    /// How a cue should feel.
    ///
    /// The end of a sit has to be tellable from a minute marker with your eyes
    /// shut, so the two never share a value — that inequality is the point of
    /// the type, and `HapticCueLogicTests` asserts it directly.
    public enum Intensity: String, Sendable, Equatable, CaseIterable {
        /// A single light tap.
        case gentle
        /// A stronger, distinctly different pattern.
        case pronounced
    }

    /// Maps a cue to the strength the app target should play it at.
    public static func intensity(for cue: Cue) -> Intensity {
        switch cue {
        case .minuteMarker: return .gentle
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

    /// How often the repeating haptic fires. Only these two values exist.
    public enum Interval: String, Codable, CaseIterable, Sendable, Equatable {
        case minute
        case tenSeconds

        public var seconds: Int {
            switch self {
            case .minute: return 60
            case .tenSeconds: return 10
            }
        }

        public static func seconds(validating raw: Int) -> Int? {
            raw == 10 || raw == 60 ? raw : nil
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

    /// The repeating cue, or nil. The end cue stays on `sessionEndCue`.
    public static func repeatingCue(
        hapticsEnabled: Bool,
        crossedBoundary: Bool,
        isAbandoned: Bool
    ) -> Cue? {
        guard hapticsEnabled, crossedBoundary, !isAbandoned else { return nil }
        return .minuteMarker
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
