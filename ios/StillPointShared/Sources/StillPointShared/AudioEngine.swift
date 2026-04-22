import Foundation

#if os(macOS)

/// macOS / host builds: no AVFoundation playback; keeps the package testable with `swift test`.
public final class AudioEngine: @unchecked Sendable {
    public static let shared = AudioEngine()

    private init() {}

    public func warmUp() {}
    public func playTick() {}
    public func playChime(count: Int) {}
    public func playCompletion() {}
}

#else

import AVFoundation
import UIKit

/// Synthesized audio matching the web app's Web Audio API sounds.
/// All sounds are generated programmatically — no external files needed.
/// Thread-safe: all public methods dispatch to a serial queue.
public final class AudioEngine: @unchecked Sendable {
    public static let shared = AudioEngine()

    private let defaultSampleRate: Double = 44100
    private let serialQueue = DispatchQueue(
        label: "com.stillpoint.audioengine",
        qos: .userInteractive
    )
    private let engine = AVAudioEngine()
    private let notificationCenter = NotificationCenter.default
    private var observerTokens: [NSObjectProtocol] = []
    private var wasRunningBeforeInterruption = false
    private var wasRunningBeforeBackground = false
    private var pendingResumeAfterConfigurationChange = false

    private init() {
        configureAudioSession()
        installLifecycleObservers()
        serialQueue.async { [self] in
            ensureEngineRunning()
        }
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

    private func installLifecycleObservers() {
        let interruptionToken = notificationCenter.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: nil
        ) { [weak self] notification in
            self?.handleInterruption(notification)
        }

        let engineConfigChangeToken = notificationCenter.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: nil
        ) { [weak self] _ in
            self?.handleEngineConfigurationChange()
        }

        let backgroundToken = notificationCenter.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.handleDidEnterBackground()
        }

        let foregroundToken = notificationCenter.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.handleWillEnterForeground()
        }

        observerTokens = [
            interruptionToken,
            engineConfigChangeToken,
            backgroundToken,
            foregroundToken
        ]
    }

    deinit {
        observerTokens.forEach(notificationCenter.removeObserver)
    }

    public func warmUp() {
        serialQueue.async { [self] in
            ensureEngineRunning()
        }
    }

    // MARK: - Tick (800Hz sine, 60ms, gain 0.06 → 0.001)

    public func playTick() {
        serialQueue.async { [self] in self._playTick() }
    }

    private func _playTick() {
        playSynthesized(duration: 0.06) { phase, sampleRate in
            let frequency = 800.0
            let t = phase / sampleRate
            let totalDuration = 0.06
            let progress = min(t / totalDuration, 1.0)
            // Exponential ramp from 0.06 to 0.001
            let gain = 0.06 * pow(0.001 / 0.06, progress)
            return Float(sin(2.0 * .pi * frequency * t) * gain)
        }
    }

    // MARK: - Chime (1200→800Hz sine, repeated `count` times, 400ms spacing)

    public func playChime(count: Int) {
        serialQueue.async { [self] in self._playChime(count: count) }
    }

    private func _playChime(count: Int) {
        let totalDuration = Double(count) * 0.4 + 0.1
        playSynthesized(duration: totalDuration) { phase, sampleRate in
            let t = phase / sampleRate
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
        serialQueue.async { [self] in self._playCompletion() }
    }

    private func _playCompletion() {
        let totalDuration = 2.5
        playSynthesized(duration: totalDuration) { phase, sampleRate in
            let t = phase / sampleRate
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

    /// Reference-type wrapper so the render callback captures a single mutable box
    /// instead of a stack-allocated var (avoids data race between audio thread and main).
    private final class PhaseBox {
        var value: Double = 0
    }

    private func ensureEngineRunning() {
        guard !engine.isRunning else { return }
        do {
            try engine.start()
        } catch {
            print("AudioEngine: Failed to start engine: \(error)")
        }
    }

    private func handleInterruption(_ notification: Notification) {
        serialQueue.async { [weak self] in
            guard let self,
                  let info = notification.userInfo,
                  let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: typeValue) else {
                return
            }

            switch type {
            case .began:
                self.wasRunningBeforeInterruption = self.engine.isRunning
                if self.wasRunningBeforeInterruption {
                    self.engine.pause()
                }
            case .ended:
                let optionsValue = (info[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0
                let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
                let shouldResume = options.contains(.shouldResume)
                self.pendingResumeAfterConfigurationChange = shouldResume && self.wasRunningBeforeInterruption
                if self.pendingResumeAfterConfigurationChange {
                    self.resumeAfterInterruptionIfNeeded()
                }
                self.wasRunningBeforeInterruption = false
            @unknown default:
                break
            }
        }
    }

    private func handleEngineConfigurationChange() {
        serialQueue.async { [weak self] in
            guard let self, self.pendingResumeAfterConfigurationChange else { return }
            self.resumeAfterInterruptionIfNeeded()
        }
    }

    private func resumeAfterInterruptionIfNeeded() {
        configureAudioSession()
        ensureEngineRunning()
        if engine.isRunning {
            pendingResumeAfterConfigurationChange = false
        }
    }

    private func handleDidEnterBackground() {
        serialQueue.async { [weak self] in
            guard let self else { return }
            self.wasRunningBeforeBackground = self.engine.isRunning
            if self.wasRunningBeforeBackground {
                self.engine.pause()
            }
        }
    }

    private func handleWillEnterForeground() {
        serialQueue.async { [weak self] in
            guard let self else { return }
            self.configureAudioSession()
            let shouldRestart = self.wasRunningBeforeBackground || self.pendingResumeAfterConfigurationChange
            if shouldRestart {
                self.ensureEngineRunning()
            }
            self.wasRunningBeforeBackground = false
        }
    }

    private func playSynthesized(
        duration: Double,
        generator: @escaping (_ phase: Double, _ sampleRate: Double) -> Float
    ) {
        let renderFormat = engine.mainMixerNode.outputFormat(forBus: 0)
        let renderSampleRate = renderFormat.sampleRate > 0 ? renderFormat.sampleRate : defaultSampleRate
        let totalFrames = Int(duration * renderSampleRate)
        let phase = PhaseBox()

        let sourceNode = AVAudioSourceNode { _, _, frameCount, audioBufferList -> OSStatus in
            let ablPointer = UnsafeMutableAudioBufferListPointer(audioBufferList)
            let buffer = ablPointer[0]
            let frames = Int(frameCount)
            guard let data = buffer.mData?.assumingMemoryBound(to: Float.self) else {
                return noErr
            }

            for frame in 0..<frames {
                if Int(phase.value) + frame >= totalFrames {
                    data[frame] = 0
                } else {
                    data[frame] = generator(phase.value + Double(frame), renderSampleRate)
                }
            }

            phase.value += Double(frames)
            return noErr
        }

        engine.attach(sourceNode)
        engine.connect(sourceNode, to: engine.mainMixerNode, format: renderFormat)
        ensureEngineRunning()

        // Detach this sound node after playback while keeping the warm engine alive.
        serialQueue.asyncAfter(deadline: .now() + duration + 0.1) { [weak self] in
            guard let self else { return }
            self.engine.disconnectNodeOutput(sourceNode)
            self.engine.detach(sourceNode)
        }
    }
}

#endif

// MARK: - Sound Preferences (shared across platform implementations)

extension AudioEngine {
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
