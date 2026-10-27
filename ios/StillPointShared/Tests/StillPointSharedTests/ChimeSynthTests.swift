import Foundation
import Testing
@testable import StillPointShared

/// Covers the minute-marker bell (#711): one strike, half the old length.
///
/// `AudioEngine`'s synthesis path only compiles for the device, so these run
/// against `ChimeSynth` — the same math the engine's render callback calls.
struct ChimeSynthTests {
    private let sampleRate = 48_000.0

    /// Peak absolute amplitude in `[from, to)`.
    private func peakAmplitude(from: Double, to: Double) -> Double {
        var peak = 0.0
        var frame = Int(from * sampleRate)
        let lastFrame = Int(to * sampleRate)
        while frame < lastFrame {
            peak = max(peak, abs(Double(ChimeSynth.sample(at: Double(frame) / sampleRate))))
            frame += 1
        }
        return peak
    }

    @Test func testBellIsHalfTheLengthOfOneOldStrike() {
        // The old chime's strike ran 0.5s (and repeated once per remaining
        // minute); this is one strike of exactly half that.
        #expect(abs(ChimeSynth.duration - 0.25) <= 1e-9)
    }

    @Test func testBellNeverRestrikes() {
        // A repeat would show up as the envelope rising again — the old chime
        // struck every 0.4s. Track the peak per 5ms window and require it never
        // climbs once the attack is over. The 2% slack absorbs interference
        // between the two partials; a real restrike jumps by ~100x.
        let window = 0.005
        var previous = peakAmplitude(from: ChimeSynth.attack, to: ChimeSynth.attack + window)
        var start = ChimeSynth.attack + window

        while start + window <= ChimeSynth.duration {
            let current = peakAmplitude(from: start, to: start + window)
            #expect(current <= previous * 1.02, "Envelope rose at \(start)s — the bell struck more than once")
            previous = current
            start += window
        }
    }

    @Test func testBellOpensWithASoftAttackRatherThanAClick() {
        // Gain climbs from silence across the attack instead of jumping to peak.
        let partial = ChimeSynth.partials[0]
        #expect(abs(ChimeSynth.gain(of: partial, at: 0) - 0) <= 1e-12)
        #expect(abs(ChimeSynth.gain(of: partial, at: ChimeSynth.attack / 2) - partial.peak / 2) <= 1e-9)
        #expect(abs(ChimeSynth.gain(of: partial, at: ChimeSynth.attack) - partial.peak) <= 1e-9)
    }

    @Test func testBellIsNoLouderThanTheOldStrike() {
        // The old strike peaked at 0.15; the partials share that budget.
        let combinedPeak = ChimeSynth.partials.reduce(0.0) { $0 + $1.peak }
        #expect(abs(combinedPeak - 0.15) <= 1e-9)
        #expect(peakAmplitude(from: 0, to: ChimeSynth.duration) <= 0.15)
    }

    @Test func testBellDecaysToNearSilenceByTheEnd() {
        // Every partial lands on the silence floor no later than the note's end,
        // so playback stops on a decayed tail rather than a cut-off tone.
        for partial in ChimeSynth.partials {
            #expect(partial.decay <= ChimeSynth.duration)
            #expect(abs(ChimeSynth.gain(of: partial, at: partial.decay) - ChimeSynth.silence) <= 1e-9)
        }
        #expect(peakAmplitude(from: 0.24, to: ChimeSynth.duration) < 0.005)
    }

    @Test func testUpperPartialIsInharmonicSoItReadsAsABell() {
        // A whole-number ratio would read as an organ pipe; the bell's shimmer
        // comes from the upper partial sitting off the harmonic series and
        // dying well before the fundamental.
        let fundamental = ChimeSynth.partials[0]
        let upper = ChimeSynth.partials[1]
        let ratio = upper.frequency / fundamental.frequency

        #expect(abs(ratio - ratio.rounded()) > 0.1)
        #expect(upper.decay < fundamental.decay)
        #expect(upper.peak < fundamental.peak)
    }
}
