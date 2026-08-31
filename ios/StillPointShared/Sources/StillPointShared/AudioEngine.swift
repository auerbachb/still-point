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
    /// No-op on macOS / host builds; real coordination happens on-device only.
    public func setAmbientCaptureActive(_ active: Bool) {}
    /// No-op on macOS / host builds.
    public func drainSerialQueue() async {}
    /// No-op on macOS / host builds.
    public func preloadVoiceCountdown() {}
    /// No-op on macOS / host builds.
    public func playVoiceCountdown(seconds: Int) {}
    /// No-op on macOS / host builds.
    public func cancelVoiceCountdownPlayback() {}
}

#else

import AVFoundation
import UIKit

/// Synthesized audio matching the web app's Web Audio API sounds.
/// All sounds are generated programmatically — no external files needed.
/// Thread-safe: all public methods dispatch to a serial queue.
public final class AudioEngine: @unchecked Sendable {
    public static let shared = AudioEngine()

    private let serialQueue = DispatchQueue(
        label: "com.stillpoint.audioengine",
        qos: .userInteractive
    )
    /// Background queue for MP3 decoding so that preload and cache-miss decoding
    /// never block tick, chime, or completion calls on serialQueue.
    private let decodeQueue = DispatchQueue(
        label: "com.stillpoint.audioengine.decode",
        qos: .utility
    )
    /// Replaced wholesale by `rebuildEngine()` after a media-services reset or
    /// repeated start failures (#710), so this is a `var`. Every access happens
    /// on `serialQueue`.
    private var engine = AVAudioEngine()
    private let notificationCenter = NotificationCenter.default
    private var observerTokens: [NSObjectProtocol] = []
    private var wasRunningBeforeInterruption = false
    /// Set to true while AmbientSoundManager's capture engine is running so
    /// configureAudioSession() switches to .playAndRecord instead of .playback.
    private var isAmbientCaptureActive = false
    /// Incremented whenever `engine` is replaced. Deferred node cleanups capture
    /// the epoch they were scheduled under and skip themselves once it moves, so
    /// they never touch a node belonging to a discarded engine (#710).
    private var graphEpoch = 0
    /// Set when repeated `start()` failures survived a session reactivation. The
    /// rebuild happens at the top of the next sound, before a source node is
    /// attached — never mid-play, which would leave the replacement to be started
    /// bare (#262).
    private var needsEngineRebuild = false
    /// Consecutive failed `engine.start()` attempts; reset by any success.
    private var consecutiveStartFailures = 0

    private init() {
        configureAudioSession()
        installLifecycleObservers()
        // Do NOT call ensureEngineRunning() here. On iOS 26, AVAudioEngine.start()
        // raises an Objective-C NSException (caught by std::terminate -> abort,
        // not catchable by Swift try/catch) when invoked on a "bare" engine that
        // has no source node connected to mainMixerNode. The engine is started
        // safely inside playSynthesized() once a source node is attached + connected.
        // See issue #262 for the crash log.
    }

    /// Sets the category for the current capture state and activates the session.
    ///
    /// Category and activation are attempted independently on purpose (#710):
    /// they used to share one `do` block, so a category error — which happens
    /// when another app briefly holds the mic — skipped `setActive(true)`
    /// entirely and left the session inactive for the rest of the sit. A stale
    /// but active category still plays; an inactive session never does.
    @discardableResult
    private func configureAudioSession() -> Bool {
        let session = AVAudioSession.sharedInstance()
        var succeeded = true

        do {
            if isAmbientCaptureActive {
                // #563: mic tap active — use playAndRecord so tick/chime/completion
                // continue playing while we sample ambient level via a second engine.
                try session.setCategory(.playAndRecord, options: [.mixWithOthers, .defaultToSpeaker])
            } else {
                try session.setCategory(.playback, options: [.mixWithOthers])
            }
        } catch {
            succeeded = false
            print("AudioEngine: Failed to set audio session category: \(error)")
        }

        do {
            try session.setActive(true)
        } catch {
            succeeded = false
            print("AudioEngine: Failed to activate audio session: \(error)")
        }

        return succeeded
    }

    /// Called by AmbientSoundManager before/after its capture engine runs.
    /// Switches the audio session between .playback and .playAndRecord so that
    /// synthesized sounds and mic capture can coexist without interrupting each other.
    public func setAmbientCaptureActive(_ active: Bool) {
        serialQueue.async { [weak self] in
            guard let self else { return }
            self.isAmbientCaptureActive = active
            self.configureAudioSession()
        }
    }

    /// Awaitable barrier that resolves after all currently-enqueued serial-queue work
    /// completes. Callers use this to ensure a prior `setAmbientCaptureActive(true)`
    /// has finished reconfiguring the audio session before installing a mic tap.
    public func drainSerialQueue() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            serialQueue.async { continuation.resume() }
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

        // #710: headphones, AirPods, CarPlay and speaker switches tear the route
        // down mid-sit. Nothing observed this, so the session stayed inactive and
        // every later tick was silent.
        let routeChangeToken = notificationCenter.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: nil
        ) { [weak self] notification in
            self?.handleRouteChange(notification)
        }

        // #710: the engine stops itself and breaks every connection into the main
        // mixer when the hardware format changes — including the .playback ⇄
        // .playAndRecord switch that ambient-level sampling performs mid-sit
        // (#563). Registered with `object: nil` so it survives `rebuildEngine()`
        // replacing the engine; the handler filters on engine identity instead,
        // since `object:` would bind this token to the engine instance that
        // existed at registration time.
        let configurationChangeToken = notificationCenter.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: nil,
            queue: nil
        ) { [weak self] notification in
            self?.handleConfigurationChange(notification)
        }

        // #710: the audio server restarting invalidates the engine and every node
        // it owns. Rare, but without this the app stays silent until relaunch.
        let mediaServicesResetToken = notificationCenter.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: AVAudioSession.sharedInstance(),
            queue: nil
        ) { [weak self] _ in
            self?.handleMediaServicesReset()
        }

        observerTokens = [
            interruptionToken,
            backgroundToken,
            foregroundToken,
            routeChangeToken,
            configurationChangeToken,
            mediaServicesResetToken
        ]
    }

    deinit {
        observerTokens.forEach(notificationCenter.removeObserver)
    }

    public func warmUp() {
        // Reactivates the audio session (covers post-background / post-interruption
        // cases); does NOT start the engine — that happens lazily inside
        // playSynthesized() after a source node is attached. See issue #262.
        serialQueue.async { [weak self] in
            self?.configureAudioSession()
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

    // MARK: - Voice Countdown Playback

    /// PCM buffers keyed by remaining-seconds value (1–60), populated by preload.
    private var voiceBufferCache: [Int: AVAudioPCMBuffer] = [:]
    /// Persistent player node for voice countdown; attached lazily on first play.
    private var voicePlayerNode: AVAudioPlayerNode?
    /// Incremented on every play or cancel to invalidate in-flight stale completions.
    private var voicePlaybackEpoch: Int = 0

    /// Preload all 60 voice-countdown clips into memory.
    /// Call when the toggle is enabled or the session starts with the toggle on.
    /// Decoding runs on decodeQueue so it never blocks tick, chime, or completion.
    public func preloadVoiceCountdown() {
        decodeQueue.async { [self] in self._preloadVoiceCountdown() }
    }

    private func _preloadVoiceCountdown() {
        for seconds in 1...60 {
            // Cache check on serialQueue to avoid data races.
            var alreadyCached = false
            serialQueue.sync { alreadyCached = self.voiceBufferCache[seconds] != nil }
            guard !alreadyCached else { continue }
            guard let url = Self.voiceCountdownURL(for: seconds),
                  let buffer = Self.loadPCMBuffer(from: url) else {
                print("AudioEngine: Failed to load voice countdown clip for \(seconds)s")
                continue
            }
            // Insert the decoded buffer on serialQueue.
            serialQueue.async { [self] in self.voiceBufferCache[seconds] = buffer }
        }
    }

    /// Play the voice countdown clip for the given remaining seconds (1–60).
    public func playVoiceCountdown(seconds: Int) {
        serialQueue.async { [self] in self._playVoiceCountdown(seconds: seconds) }
    }

    private func _playVoiceCountdown(seconds: Int) {
        guard seconds >= 1 && seconds <= 60 else { return }

        voicePlaybackEpoch += 1
        let epoch = voicePlaybackEpoch

        if let buffer = voiceBufferCache[seconds] {
            _doPlayVoiceBuffer(buffer)
        } else {
            // Decode off serialQueue so a cache miss cannot delay tick/chime/completion.
            decodeQueue.async { [self] in
                guard let url = Self.voiceCountdownURL(for: seconds),
                      let buffer = Self.loadPCMBuffer(from: url) else { return }
                self.serialQueue.async { [self] in
                    // Guard against stale epochs (cancel or a newer play arrived).
                    guard self.voicePlaybackEpoch == epoch else { return }
                    self.voiceBufferCache[seconds] = buffer
                    self._doPlayVoiceBuffer(buffer)
                }
            }
        }
    }

    /// Schedule and play `buffer` on the voice player node.
    /// Must be called on serialQueue.
    private func _doPlayVoiceBuffer(_ buffer: AVAudioPCMBuffer) {
        // #710: same pre-attach rebuild as playSynthesized(), and it must run
        // before voicePlayerNode is read — a rebuild drops that node.
        rebuildEngineIfNeeded()

        // Lazily create and attach the player node using the buffer's decoded format.
        let player: AVAudioPlayerNode
        if let existing = voicePlayerNode {
            player = existing
        } else {
            let node = AVAudioPlayerNode()
            player = node
            voicePlayerNode = node
            engine.attach(node)
            engine.connect(node, to: engine.mainMixerNode, format: buffer.format)
        }

        // #710: an AVAudioPlayerNode raises when started while its engine is not
        // running, so recovery has to succeed before scheduling. When it does not,
        // this clip is dropped and the next second's play retries from scratch.
        guard ensureEngineRunning() else { return }
        // .interrupts cancels any in-progress buffer and starts the new one immediately.
        player.scheduleBuffer(buffer, at: nil, options: .interrupts, completionHandler: nil)
        player.play()
    }

    /// Cancel any in-flight voice countdown playback.
    /// Call on pause, session completion, or session unmount.
    public func cancelVoiceCountdownPlayback() {
        serialQueue.async { [self] in self._cancelVoiceCountdownPlayback() }
    }

    private func _cancelVoiceCountdownPlayback() {
        voicePlaybackEpoch += 1
        voicePlayerNode?.stop()
    }

    // MARK: - Voice Countdown Asset Helpers

    private static func voiceCountdownURL(for seconds: Int) -> URL? {
        // Folder references from XcodeGen preserve the VoiceCountdown subdirectory.
        Bundle.main.url(forResource: "\(seconds)", withExtension: "mp3", subdirectory: "VoiceCountdown")
    }

    private static func loadPCMBuffer(from url: URL) -> AVAudioPCMBuffer? {
        do {
            let audioFile = try AVAudioFile(forReading: url)
            let frameCount = AVAudioFrameCount(audioFile.length)
            guard let buffer = AVAudioPCMBuffer(
                pcmFormat: audioFile.processingFormat,
                frameCapacity: frameCount
            ) else { return nil }
            try audioFile.read(into: buffer)
            return buffer
        } catch {
            print("AudioEngine: Error loading PCM buffer at \(url.lastPathComponent): \(error)")
            return nil
        }
    }

    // MARK: - Synthesizer Core

    /// Reference-type wrapper so the render callback captures a single mutable box
    /// instead of a stack-allocated var (avoids data race between audio thread and main).
    private final class PhaseBox {
        var value: Double = 0
    }

    /// Starts the engine if it is not already running, repairing the audio
    /// session and escalating to a graph rebuild when a start fails (#710).
    ///
    /// Before this, a single failed `start()` was printed and forgotten, so any
    /// transient disruption silenced every remaining sound of the sit. Returns
    /// whether the engine is running.
    ///
    /// Must be called on `serialQueue`, and only once a source node is attached
    /// and connected to `mainMixerNode` — starting a bare engine is the #262
    /// crash.
    @discardableResult
    private func ensureEngineRunning() -> Bool {
        if engine.isRunning {
            consecutiveStartFailures = 0
            return true
        }
        if startEngine(attempt: "initial") { return true }

        // Overwhelmingly the cause is an inactive audio session: an interruption
        // that ended without `.shouldResume`, a route change, or backgrounding.
        // The caller's source node is still attached and connected, so this retry
        // is not a bare start.
        configureAudioSession()
        if startEngine(attempt: "retry after session reactivation") { return true }

        // Reactivation did not help. Schedule the rebuild for the *next* sound:
        // replacing the engine here would discard the one this call's node is
        // attached to, leaving the replacement to be started bare (#262).
        if AudioRecoveryLogic.startFailureRecovery(
            consecutiveFailures: consecutiveStartFailures
        ) == .rebuildEngineBeforeNextSound {
            needsEngineRebuild = true
        }
        return false
    }

    /// One `engine.start()` attempt, maintaining the consecutive-failure count.
    /// Must be called on `serialQueue`.
    private func startEngine(attempt: String) -> Bool {
        do {
            try engine.start()
            consecutiveStartFailures = 0
            return true
        } catch {
            consecutiveStartFailures &+= 1
            print(
                "AudioEngine: engine.start() \(attempt) failed "
                    + "(\(consecutiveStartFailures) consecutive): \(error)"
            )
            return false
        }
    }

    /// Replaces `engine` with a fresh instance and forgets the old graph (#710).
    ///
    /// Used after a media-services reset — the audio server restarted, so every
    /// node the previous engine owned is invalid — and after start failures that
    /// session reactivation could not clear. The old engine is released without
    /// being stopped or detached from: after a reset those calls are not safe,
    /// and its pending node cleanups skip themselves via `graphEpoch`.
    ///
    /// Must be called on `serialQueue`, and never between attaching a source node
    /// and starting the engine — the replacement would be started bare (#262).
    private func rebuildEngine() {
        graphEpoch &+= 1
        voicePlayerNode = nil
        engine = AVAudioEngine()
        needsEngineRebuild = false
        consecutiveStartFailures = 0
    }

    /// Rebuild hook for the top of every play path, before any node is attached.
    /// Must be called on `serialQueue`.
    private func rebuildEngineIfNeeded() {
        guard needsEngineRebuild else { return }
        rebuildEngine()
    }

    /// Drops the persistent voice-countdown player so the next clip reattaches
    /// and reconnects it. Must be called on `serialQueue`.
    ///
    /// An `AVAudioEngineConfigurationChange` breaks every connection into the
    /// main mixer. The node survives but plays into nothing, which left the voice
    /// countdown silent for the rest of the sit (#710).
    private func discardVoicePlayerNode() {
        guard let node = voicePlayerNode else { return }
        voicePlayerNode = nil
        node.stop()
        engine.detach(node)
    }

    /// Current main-mixer output format, repairing the session first when the
    /// mixer reports an unusable one (#710).
    ///
    /// The mixer reports 0 Hz / 0 channels while the session is inactive. That
    /// value used to be passed straight to `engine.connect(...)`, so the recovery
    /// path itself produced silence. Returns nil when the format is still
    /// unusable after a repair — the caller skips that one sound and the next
    /// one, a second later, retries from scratch.
    private func usableRenderFormat() -> AVAudioFormat? {
        let format = engine.mainMixerNode.outputFormat(forBus: 0)
        if AudioRecoveryLogic.isUsableRenderFormat(
            sampleRate: format.sampleRate,
            channelCount: format.channelCount
        ) {
            return format
        }

        configureAudioSession()
        let repaired = engine.mainMixerNode.outputFormat(forBus: 0)
        guard AudioRecoveryLogic.isUsableRenderFormat(
            sampleRate: repaired.sampleRate,
            channelCount: repaired.channelCount
        ) else {
            print("AudioEngine: main mixer reports an unusable format; skipping this sound")
            return nil
        }
        return repaired
    }

    /// Maps AVFoundation's route-change reason onto the testable mirror. The
    /// switch is exhaustive over the platform enum, so a raw value this build
    /// does not know maps to nil and is treated as recoverable.
    private static func routeChangeReason(
        rawValue: UInt
    ) -> AudioRecoveryLogic.RouteChangeReason? {
        guard let reason = AVAudioSession.RouteChangeReason(rawValue: rawValue) else { return nil }
        switch reason {
        case .unknown: return .unknown
        case .newDeviceAvailable: return .newDeviceAvailable
        case .oldDeviceUnavailable: return .oldDeviceUnavailable
        case .categoryChange: return .categoryChange
        case .override: return .override
        case .wakeFromSleep: return .wakeFromSleep
        case .noSuitableRouteForCategory: return .noSuitableRouteForCategory
        case .routeConfigurationChange: return .routeConfigurationChange
        @unknown default: return nil
        }
    }

    private func handleRouteChange(_ notification: Notification) {
        let rawValue = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) ?? 0
        let reason = Self.routeChangeReason(rawValue: rawValue)
        guard AudioRecoveryLogic.shouldReactivateSession(afterRouteChange: reason) else { return }

        // Reactivate only. The engine is restarted lazily by the next
        // playSynthesized() once it has attached a fresh source node (#262).
        serialQueue.async { [weak self] in
            self?.configureAudioSession()
        }
    }

    private func handleConfigurationChange(_ notification: Notification) {
        // AVFoundation posts the affected engine as `notification.object`, and
        // this process runs two: ours and `AmbientSoundManager.captureEngine`
        // (#563). Captured here rather than on `serialQueue` so the comparison
        // uses the notification's own object, not a later one.
        //
        // A nil/unrecognized object is treated as ours on purpose: skipping
        // recovery is the #710 failure itself (silence for the rest of the sit),
        // while an unnecessary discard costs at most one re-created voice node.
        let postingEngine = notification.object as? AVAudioEngine

        serialQueue.async { [weak self] in
            guard let self else { return }
            // The hardware format changed. Reactivate the session unconditionally
            // — it is idempotent, and a format change that reached the capture
            // engine affects the shared session either way. No engine.start()
            // here — the graph has no source node attached (#262).
            //
            // This converges rather than looping: reconfiguring with a category
            // that is already set and a session that is already active changes no
            // I/O format, so it posts no further configuration change.
            self.configureAudioSession()

            // Only our engine tearing itself down invalidates the voice node.
            // Discarding it for a capture-engine notification would stop an
            // in-progress countdown clip for no reason.
            let isFromOwnEngine: Bool? = postingEngine.map { $0 === self.engine }
            guard AudioRecoveryLogic.shouldDiscardVoiceNode(
                onConfigurationChangeFromOwnEngine: isFromOwnEngine
            ) else { return }
            self.discardVoicePlayerNode()
        }
    }

    private func handleMediaServicesReset() {
        serialQueue.async { [weak self] in
            guard let self else { return }
            // The audio server restarted: the engine, its nodes and the session
            // configuration are all invalid. Rebuild from scratch, then
            // reconfigure. The next playSynthesized() attaches a source node and
            // starts the new engine safely (#262).
            self.rebuildEngine()
            self.configureAudioSession()
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
                // #710: reactivation used to be gated on `.shouldResume` AND the
                // engine having been running when the interruption began. Calls,
                // Siri, alarms and other apps' audio routinely end with neither —
                // and a sit whose engine was paused by backgrounding never has
                // the second — so the session stayed deactivated and every later
                // tick failed to start. The system deactivates the session for
                // the whole interruption regardless of those flags, so
                // reactivation is now unconditional; `setActive(true)` is
                // idempotent when it was not needed.
                self.reactivateSessionAfterInterruption()
                self.wasRunningBeforeInterruption = false
            @unknown default:
                break
            }
        }
    }

    private func reactivateSessionAfterInterruption() {
        // Reconfigure the session only. We deliberately do NOT call engine.start()
        // here — by the time we resume, the previously playing source node has
        // already been detached (see playSynthesized's asyncAfter cleanup), so
        // starting the engine bare would crash on iOS 26. The next playSynthesized
        // call will start the engine safely after attaching a fresh source node.
        // See issue #262.
        configureAudioSession()
    }

    private func handleDidEnterBackground() {
        serialQueue.async { [weak self] in
            guard let self, self.engine.isRunning else { return }
            self.engine.pause()
        }
    }

    private func handleWillEnterForeground() {
        // Reactivate the audio session; do NOT call engine.start() — see init()
        // and resumeAfterInterruptionIfNeeded() comments. The next playSynthesized
        // call will start the engine safely. Issue #262.
        serialQueue.async { [weak self] in
            self?.configureAudioSession()
        }
    }

    private func playSynthesized(
        duration: Double,
        generator: @escaping (_ phase: Double, _ sampleRate: Double) -> Float
    ) {
        // #710: clear a graph that earlier start failures condemned *before*
        // attaching, so the fresh engine is started with a source node connected
        // (#262 invariant).
        rebuildEngineIfNeeded()

        guard let renderFormat = usableRenderFormat() else { return }
        let renderSampleRate = renderFormat.sampleRate
        let totalFrames = Int(duration * renderSampleRate)
        let phase = PhaseBox()
        let epoch = graphEpoch

        let sourceNode = AVAudioSourceNode { _, _, frameCount, audioBufferList -> OSStatus in
            let ablPointer = UnsafeMutableAudioBufferListPointer(audioBufferList)
            let frames = Int(frameCount)
            guard !ablPointer.isEmpty else {
                return noErr
            }

            for frame in 0..<frames {
                let sample: Float
                if Int(phase.value) + frame >= totalFrames {
                    sample = 0
                } else {
                    sample = generator(phase.value + Double(frame), renderSampleRate)
                }

                for buffer in ablPointer {
                    guard let channelData = buffer.mData?.assumingMemoryBound(to: Float.self) else {
                        continue
                    }
                    let channels = Int(buffer.mNumberChannels)
                    if channels <= 1 {
                        channelData[frame] = sample
                    } else {
                        let frameOffset = frame * channels
                        for channel in 0..<channels {
                            channelData[frameOffset + channel] = sample
                        }
                    }
                }
            }

            phase.value += Double(frames)
            return noErr
        }

        engine.attach(sourceNode)
        engine.connect(sourceNode, to: engine.mainMixerNode, format: renderFormat)
        ensureEngineRunning()

        // Detach this sound node after playback while keeping the warm engine alive.
        // Skipped when the engine has since been replaced (#710): the node belongs
        // to the discarded graph and is released with it, and detaching it from the
        // new engine would raise.
        serialQueue.asyncAfter(deadline: .now() + duration + 0.1) { [weak self] in
            guard let self, self.graphEpoch == epoch else { return }
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
        /// #554: voice countdown — spoken numbers during the final 60 seconds.
        /// Mirrors the `voiceCountdown` toggle on web (persisted in localStorage).
        public var voiceCountdown: Bool

        public static let defaults = SoundPrefs(
            tick: false, chime: true, completion: true, voiceCountdown: false
        )

        /// Memberwise initialiser (required because we added a custom `init(from:)`).
        public init(tick: Bool, chime: Bool, completion: Bool, voiceCountdown: Bool = false) {
            self.tick = tick
            self.chime = chime
            self.completion = completion
            self.voiceCountdown = voiceCountdown
        }

        /// Custom decoder that merges over defaults — mirrors web's `{ ...DEFAULTS, ...stored }`.
        /// Prevents legacy persisted JSON (missing `voiceCountdown`) from wiping tick/chime/completion.
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            tick           = try c.decodeIfPresent(Bool.self, forKey: .tick)           ?? false
            chime          = try c.decodeIfPresent(Bool.self, forKey: .chime)          ?? true
            completion     = try c.decodeIfPresent(Bool.self, forKey: .completion)     ?? true
            voiceCountdown = try c.decodeIfPresent(Bool.self, forKey: .voiceCountdown) ?? false
        }
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

    /// Wipes the persisted sound-prefs entry. Used by UI-test reset paths so a
    /// previous test cannot leak its toggle state into a subsequent test run.
    public static func resetPersistedPrefs() {
        UserDefaults.standard.removeObject(forKey: prefsKey)
    }
}
