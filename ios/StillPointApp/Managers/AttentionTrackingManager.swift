#if targetEnvironment(simulator)

import Foundation
import StillPointShared

/// Simulator stub — ARKit face tracking requires a TrueDepth device.
@Observable
@MainActor
final class AttentionTrackingManager {
    private(set) var isSupported = false
    private(set) var isRunning = false
    private(set) var currentAttentionState = "attentive"
    private(set) var attentionLog: [AttentionEntry] = [AttentionEntry(time: 0, state: "attentive")]

    func start(elapsedProvider: @escaping () -> Double) {
        _ = elapsedProvider
        isRunning = false
    }

    func stop() {
        isRunning = false
    }

    func pause() {}

    func resume() {}
}

#else

import ARKit
import Foundation
import StillPointShared

/// ARKit face-tracking gaze attention sampler (#113). Uses `ARFaceAnchor.lookAtPoint`
/// — the only public API for gaze direction — with a 0.5s sustained-gaze debounce.
@Observable
@MainActor
final class AttentionTrackingManager: NSObject {
    private(set) var isSupported: Bool
    private(set) var isRunning = false
    private(set) var currentAttentionState = "attentive"
    private(set) var attentionLog: [AttentionEntry] = [AttentionEntry(time: 0, state: "attentive")]

    private let session = ARSession()
    private var elapsedProvider: (() -> Double)?
    private var sustained = AttentionTrackingLogic.SustainedState()
    private var isPaused = false

    override init() {
        isSupported = ARFaceTrackingConfiguration.isSupported
        super.init()
        session.delegate = self
    }

    func start(elapsedProvider: @escaping () -> Double) {
        guard isSupported, !isRunning else { return }
        self.elapsedProvider = elapsedProvider
        sustained = AttentionTrackingLogic.SustainedState()
        currentAttentionState = sustained.loggedState
        attentionLog = sustained.log
        isPaused = false

        let configuration = ARFaceTrackingConfiguration()
        configuration.isLightEstimationEnabled = false
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        isRunning = true
    }

    func stop() {
        guard isRunning else { return }
        session.pause()
        isRunning = false
        isPaused = false
        elapsedProvider = nil
    }

    func pause() {
        guard isRunning, !isPaused else { return }
        session.pause()
        isPaused = true
    }

    func resume() {
        guard isRunning, isPaused, isSupported else { return }
        let configuration = ARFaceTrackingConfiguration()
        configuration.isLightEstimationEnabled = false
        session.run(configuration)
        isPaused = false
    }

    fileprivate func handleLookAtPoint(_ lookAtPoint: SIMD3<Float>) {
        guard isRunning, !isPaused, let elapsedProvider else { return }

        let rawState = AttentionTrackingLogic.classifyGaze(
            lookAtX: lookAtPoint.x,
            lookAtY: lookAtPoint.y,
            lookAtZ: lookAtPoint.z
        )
        let now = ProcessInfo.processInfo.systemUptime
        let elapsed = elapsedProvider()

        sustained = AttentionTrackingLogic.applyRawSample(
            rawState,
            elapsed: elapsed,
            now: now,
            state: sustained
        )
        currentAttentionState = sustained.loggedState
        attentionLog = sustained.log
    }
}

extension AttentionTrackingManager: ARSessionDelegate {
    nonisolated func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard let faceAnchor = anchors.compactMap({ $0 as? ARFaceAnchor }).first else { return }
        let lookAtPoint = faceAnchor.lookAtPoint
        Task { @MainActor in
            self.handleLookAtPoint(lookAtPoint)
        }
    }
}

#endif
