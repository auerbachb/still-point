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
}
