import AVFoundation
import Foundation

/// Synthesized audio matching the web app's Web Audio API sounds.
/// All sounds are generated programmatically — no external files needed.
public final class AudioEngine: @unchecked Sendable {
    public static let shared = AudioEngine()

    private var engine: AVAudioEngine?
    private let sampleRate: Double = 44100

    private init() {
        configureAudioSession()
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            print("AudioEngine: Failed to configure audio session: \(error)")
        }
    }

    // MARK: - Tick (800Hz sine, 60ms, gain 0.06 → 0.001)

    public func playTick() {
        playSynthesized(duration: 0.06) { phase in
            let frequency = 800.0
            let t = phase / self.sampleRate
            let totalDuration = 0.06
            let progress = min(t / totalDuration, 1.0)
            // Exponential ramp from 0.06 to 0.001
            let gain = 0.06 * pow(0.001 / 0.06, progress)
            return Float(sin(2.0 * .pi * frequency * t) * gain)
        }
    }

    // MARK: - Chime (1200→800Hz sine, repeated `count` times, 400ms spacing)

    public func playChime(count: Int) {
        let totalDuration = Double(count) * 0.4 + 0.1
        playSynthesized(duration: totalDuration) { phase in
            let t = phase / self.sampleRate
            var sample: Float = 0

            for i in 0..<count {
                let offset = Double(i) * 0.4
                let localT = t - offset
                guard localT >= 0 && localT < 0.5 else { continue }

                // Frequency: exponential ramp 1200 → 800 over 300ms
                let freqProgress = min(localT / 0.3, 1.0)
                let freq = 1200.0 * pow(800.0 / 1200.0, freqProgress)

                // Gain: exponential ramp 0.15 → 0.001 over 500ms
                let gainProgress = min(localT / 0.5, 1.0)
                let gain = 0.15 * pow(0.001 / 0.15, gainProgress)

                sample += Float(sin(2.0 * .pi * freq * localT) * gain)
            }

            return sample
        }
    }

    // MARK: - Completion (528Hz + 660Hz, gain 0.2 hold 800ms then ramp to 0.001 at 2.5s)

    public func playCompletion() {
        let totalDuration = 2.5
        playSynthesized(duration: totalDuration) { phase in
            let t = phase / self.sampleRate
            var sample: Float = 0

            for freq in [528.0, 660.0] {
                let gain: Double
                if t < 0.8 {
                    gain = 0.2
                } else {
                    let rampProgress = (t - 0.8) / (2.5 - 0.8)
                    gain = 0.2 * pow(0.001 / 0.2, min(rampProgress, 1.0))
                }
                sample += Float(sin(2.0 * .pi * freq * t) * gain)
            }

            return sample
        }
    }

    // MARK: - Synthesizer Core

    private func playSynthesized(duration: Double, generator: @escaping (Double) -> Float) {
        let engine = AVAudioEngine()
        let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!

        let totalFrames = Int(duration * sampleRate)
        var currentPhase: Double = 0

        let sourceNode = AVAudioSourceNode { _, _, frameCount, audioBufferList -> OSStatus in
            let ablPointer = UnsafeMutableAudioBufferListPointer(audioBufferList)
            let buffer = ablPointer[0]
            let frames = Int(frameCount)
            guard let data = buffer.mData?.assumingMemoryBound(to: Float.self) else {
                return noErr
            }

            for frame in 0..<frames {
                if Int(currentPhase) + frame >= totalFrames {
                    data[frame] = 0
                } else {
                    data[frame] = generator(currentPhase + Double(frame))
                }
            }

            currentPhase += Double(frames)
            return noErr
        }

        engine.attach(sourceNode)
        engine.connect(sourceNode, to: engine.mainMixerNode, format: format)

        do {
            try engine.start()
        } catch {
            print("AudioEngine: Failed to start engine: \(error)")
            return
        }

        // Stop after duration
        DispatchQueue.main.asyncAfter(deadline: .now() + duration + 0.1) {
            engine.stop()
        }
    }

    // MARK: - Sound Preferences

    public struct SoundPrefs: Codable, Equatable {
        public var tick: Bool
        public var chime: Bool
        public var completion: Bool

        public static let defaults = SoundPrefs(tick: false, chime: true, completion: true)
    }

    private static let prefsKey = "stillpoint_sound_prefs"

    public static func loadPrefs() -> SoundPrefs {
        guard let data = UserDefaults.standard.data(forKey: prefsKey),
              let prefs = try? JSONDecoder().decode(SoundPrefs.self, from: data) else {
            return .defaults
        }
        return prefs
    }

    public static func savePrefs(_ prefs: SoundPrefs) {
        if let data = try? JSONEncoder().encode(prefs) {
            UserDefaults.standard.set(data, forKey: prefsKey)
        }
    }
}
