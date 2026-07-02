#if targetEnvironment(simulator)

import Foundation
import StillPointShared

/// Simulator stub — ARKit face tracking requires a TrueDepth device.
@Observable
@MainActor
final class AttentionTrackingManager {
    private(set) var isSupported = false
    private(set) var isRunning = false
    private(set) var didReceiveSample = false
    private(set) var currentAttentionState = "attentive"
    private(set) var attentionLog: [AttentionEntry] = []

    func start(elapsedProvider: @escaping () -> Double) {
        _ = elapsedProvider
        isRunning = false
        didReceiveSample = false
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
    private(set) var didReceiveSample = false
    private(set) var currentAttentionState = "attentive"
    private(set) var attentionLog: [AttentionEntry] = []

    private let session = ARSession()
    private var elapsedProvider: (() -> Double)?
    private var sustained = AttentionTrackingLogic.SustainedState()
    private var isPaused = false
    private var pendingLookAt: SIMD3<Float>?
    private var frameDispatchScheduled = false

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
        didReceiveSample = false
        isPaused = false
        pendingLookAt = nil
        frameDispatchScheduled = false

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
        pendingLookAt = nil
        frameDispatchScheduled = false
        clearPendingDebounce()
    }

    func pause() {
        guard isRunning, !isPaused else { return }
        session.pause()
        isPaused = true
        pendingLookAt = nil
        frameDispatchScheduled = false
        clearPendingDebounce()
    }

    func resume() {
        guard isRunning, isPaused, isSupported else { return }
        let configuration = ARFaceTrackingConfiguration()
        configuration.isLightEstimationEnabled = false
        session.run(configuration)
        isPaused = false
    }

    private func clearPendingDebounce() {
        sustained.pendingState = nil
        sustained.pendingSince = nil
    }

    fileprivate func handleLookAtPoint(_ lookAtPoint: SIMD3<Float>) {
        guard isRunning, !isPaused, let elapsedProvider else { return }

        didReceiveSample = true
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

    fileprivate func dispatchLatestLookAtPoint() {
        guard let lookAtPoint = pendingLookAt else { return }
        pendingLookAt = nil
        handleLookAtPoint(lookAtPoint)
    }

    fileprivate func scheduleLookAtDispatch(_ lookAtPoint: SIMD3<Float>) {
        pendingLookAt = lookAtPoint
        guard !frameDispatchScheduled else { return }
        frameDispatchScheduled = true
        Task { @MainActor in
            defer { self.frameDispatchScheduled = false }
            self.dispatchLatestLookAtPoint()
        }
    }
}

extension AttentionTrackingManager: ARSessionDelegate {
    nonisolated func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard let faceAnchor = anchors.compactMap({ $0 as? ARFaceAnchor }).first else { return }
        let lookAtPoint = faceAnchor.lookAtPoint
        Task { @MainActor in
            self.scheduleLookAtDispatch(lookAtPoint)
        }
    }
}

#endif
