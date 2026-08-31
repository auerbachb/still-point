import Foundation

/// The minute-marker bell, as pure sample math (#711).
///
/// Lives outside `AudioEngine`'s `#if os(macOS)` split on purpose: the engine's
/// real synthesis path compiles for the device only, so a waveform written
/// inside it is unreachable to `swift test`. Keeping it here means the sound the
/// app actually ships is covered by the shared suite on every PR.
///
/// Mirrors `CHIME_PARTIALS` in `src/lib/audio.ts` — keep the two in sync so both
/// clients ring the same bell.
public enum ChimeSynth {
    /// One partial of the struck bell.
    public struct Partial: Sendable, Equatable {
        /// Pitch in Hz. Fixed, rather than the old 1200 -> 800Hz glide, which is
        /// what lets Web Audio and this generator produce the same waveform.
        public let frequency: Double
        /// Gain reached at the end of the attack.
        public let peak: Double
        /// Seconds from onset to near-silence.
        public let decay: Double

        public init(frequency: Double, peak: Double, decay: Double) {
            self.frequency = frequency
            self.peak = peak
            self.decay = decay
        }
    }

    /// Length of the whole bell.
    ///
    /// The old chime was a 0.5s strike replayed once per remaining minute at
    /// 400ms spacing, so a 20-minute sit opened with a 7.7s, 19-strike run —
    /// the "song" that read as disruptive. This is a single 0.25s strike:
    /// exactly half of one old strike, and no repeats at all.
    public static let duration = 0.25

    /// Onset ramp — long enough to take the click off the strike, short enough
    /// to still read as one.
    public static let attack = 0.004

    /// Floor the exponential tail lands on; the same near-silence the tick and
    /// completion sounds decay to.
    public static let silence = 0.001

    /// The 2.7x upper partial is deliberately inharmonic (bell, not organ pipe)
    /// and dies inside the first ~90ms, leaving the fundamental to ring out.
    /// The peaks sum to 0.15 — the peak the old single strike used — so the
    /// marker is no louder than it was before.
    public static let partials: [Partial] = [
        Partial(frequency: 880, peak: 0.115, decay: ChimeSynth.duration),
        Partial(frequency: 2376, peak: 0.035, decay: 0.09),
    ]

    /// Gain of one partial `t` seconds after the strike: a linear attack into an
    /// exponential tail, matching what the Web Audio gain automation produces.
    public static func gain(of partial: Partial, at t: Double) -> Double {
        guard t > 0 else { return 0 }
        if t < attack { return partial.peak * (t / attack) }
        let progress = min((t - attack) / (partial.decay - attack), 1.0)
        return partial.peak * pow(silence / partial.peak, progress)
    }

    /// The bell's amplitude `t` seconds after the strike.
    ///
    /// Called once per frame from the audio render thread, so it allocates
    /// nothing: `partials` is a static array, iterated in place.
    public static func sample(at t: Double) -> Float {
        var sample = 0.0
        for partial in partials {
            sample += sin(2.0 * .pi * partial.frequency * t) * gain(of: partial, at: t)
        }
        return Float(sample)
    }
}
