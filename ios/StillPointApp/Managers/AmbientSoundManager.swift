#if targetEnvironment(simulator)

import Foundation
import StillPointShared

/// Simulator stub — mic capture requires real audio hardware.
@Observable
@MainActor
final class AmbientSoundManager {
    private(set) var isSupported = false
    private(set) var isRunning = false
    private(set) var didReceiveSample = false
    private(set) var summary: AmbientSoundSummary?

    func start(elapsedProvider: @escaping () -> Double) async {
        _ = elapsedProvider
        // No-op on simulator; isSupported = false signals the caller to skip opt-in.
    }

    func stop() {
        isRunning = false
    }

    func pause() {}
    func resume() {}
}

#else

import AVFoundation
import Foundation
import StillPointShared

/// On-device ambient sound level sampler for solo sits (#563).
///
/// Uses an AVAudioEngine input-node tap to compute RMS/dBFS per buffer.
/// Only summary statistics are retained — no raw audio is ever stored.
/// Coordinates with `AudioEngine.shared` so tick/chime/completion continue
/// to play while the mic is active.
@Observable
@MainActor
final class AmbientSoundManager {
    /// Always true on real devices (mic present); signals SettingsView to show the toggle.
    private(set) var isSupported = true
    /// True while the tap is installed and the capture engine is running.
    private(set) var isRunning = false
    /// True after the first buffer has been processed.
    private(set) var didReceiveSample = false
    /// Populated on `stop()` from the accumulated samples.
    private(set) var summary: AmbientSoundSummary?

    private var accumulator = AmbientSoundLevelLogic.Accumulator()
    private let captureEngine = AVAudioEngine()
    private var isPaused = false
    /// Monotonic counter incremented on every start attempt and on stop.
    /// Compared after the mic-permission await to detect lifecycle races.
    private var startGeneration = 0

    // MARK: - Lifecycle

    func start(elapsedProvider: @escaping () -> Double) async {
        _ = elapsedProvider // elapsed unused in level-only MVP
        guard !isRunning else { return }
        startGeneration &+= 1
        let generation = startGeneration
        guard await ensureMicAuthorized() else { return }
        // Re-validate after the await suspension: stop() may have been called while
        // the mic permission prompt was visible, in which case capture must not start.
        guard generation == startGeneration, !isRunning else { return }

        // Reconfigure the shared audio session to playAndRecord so mic input is
        // available while tick/chime/completion playback continues uninterrupted.
        AudioEngine.shared.setAmbientCaptureActive(true)
        // Wait for the serial queue to flush so the session category is .playAndRecord
        // before we install the tap — avoids an intermittent capture-start failure.
        await AudioEngine.shared.drainSerialQueue()

        accumulator = AmbientSoundLevelLogic.Accumulator()
        summary = nil
        isPaused = false

        let inputNode = captureEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            // Discard the buffer immediately after reading amplitude — no audio stored.
            guard buffer.frameLength > 0,
                  let channelData = buffer.floatChannelData?[0] else { return }
            let count = Int(buffer.frameLength)
            let samples = Array(UnsafeBufferPointer(start: channelData, count: count))
            let rms = AmbientSoundLevelLogic.rms(from: samples)
            let db = AmbientSoundLevelLogic.toDBFS(rms: rms)
            Task { @MainActor [weak self] in
                guard let self, self.isRunning, !self.isPaused else { return }
                self.accumulator.ingest(levelDB: db)
                self.didReceiveSample = true
            }
            // `buffer` is released here; no raw audio persists
        }

        do {
            try captureEngine.start()
            isRunning = true
        } catch {
            inputNode.removeTap(onBus: 0)
            AudioEngine.shared.setAmbientCaptureActive(false)
            print("AmbientSoundManager: Failed to start capture engine: \(error)")
        }
    }

    func stop() {
        startGeneration &+= 1 // Invalidate any pending start suspended at mic permission
        guard isRunning else { return }
        captureEngine.inputNode.removeTap(onBus: 0)
        captureEngine.stop()
        AudioEngine.shared.setAmbientCaptureActive(false)
        isRunning = false
        isPaused = false
        summary = accumulator.summary()
    }

    func pause() {
        guard isRunning, !isPaused else { return }
        captureEngine.pause()
        isPaused = true
    }

    func resume() {
        guard isRunning, isPaused else { return }
        do {
            try captureEngine.start()
            isPaused = false
        } catch {
            print("AmbientSoundManager: Failed to resume capture engine: \(error)")
        }
    }

    // MARK: - Permission

    private func ensureMicAuthorized() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            return true
        case .undetermined:
            return await AVAudioApplication.requestRecordPermission()
        case .denied:
            return false
        @unknown default:
            return false
        }
    }
}

#endif
