#if targetEnvironment(simulator)

import Foundation
import StillPointShared

/// Observable status for ARKit gaze tracking (#562).
enum AttentionTrackingStatus: Equatable {
    case unsupported
    case permissionDenied
    case idle
    case running
    case paused
    case failed
}

/// Preflight camera capability without starting an ARSession.
enum AttentionTrackingCapability {
    static func preflight() -> AttentionTrackingStatus {
        .unsupported
    }

    static func requestCameraAccessIfNeeded() async -> AttentionTrackingStatus {
        .unsupported
    }
}

/// Simulator stub — ARKit face tracking requires a TrueDepth device.
@Observable
@MainActor
final class AttentionTrackingManager {
    private(set) var isSupported = false
    private(set) var isRunning = false
    private(set) var didReceiveSample = false
    private(set) var currentAttentionState = "attentive"
    private(set) var attentionLog: [AttentionEntry] = []
    private(set) var status: AttentionTrackingStatus = .unsupported
    private(set) var lastFailureMessage: String?

    init() {
        status = .unsupported
    }

    func start(elapsedProvider: @escaping () -> Double) async {
        _ = elapsedProvider
        isRunning = false
        didReceiveSample = false
        status = .unsupported
    }

    func stop() {
        isRunning = false
        status = .unsupported
    }

    func pause() {
        guard status == .running else { return }
        status = .paused
    }

    func resume() {
        guard status == .paused else { return }
        status = .running
    }
}

#else

import ARKit
import AVFoundation
import Foundation
import StillPointShared

/// Observable status for ARKit gaze tracking (#562).
enum AttentionTrackingStatus: Equatable {
    case unsupported
    case permissionDenied
    case idle
    case running
    case paused
    case failed
}

/// Preflight camera capability without starting an ARSession.
enum AttentionTrackingCapability {
    static func preflight() -> AttentionTrackingStatus {
        guard ARFaceTrackingConfiguration.isSupported else { return .unsupported }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .denied, .restricted:
            return .permissionDenied
        default:
            return .idle
        }
    }

    static func requestCameraAccessIfNeeded() async -> AttentionTrackingStatus {
        guard ARFaceTrackingConfiguration.isSupported else { return .unsupported }

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return .idle
        case .denied, .restricted:
            return .permissionDenied
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            return granted ? .idle : .permissionDenied
        @unknown default:
            return .permissionDenied
        }
    }
}

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
    private(set) var status: AttentionTrackingStatus
    private(set) var lastFailureMessage: String?

    private let session = ARSession()
    private var elapsedProvider: (() -> Double)?
    private var sustained = AttentionTrackingLogic.SustainedState()
    private var isPaused = false
    private var pendingLookAt: SIMD3<Float>?
    private var frameDispatchScheduled = false
    private var startGeneration = 0

    override init() {
        isSupported = ARFaceTrackingConfiguration.isSupported
        status = isSupported ? .idle : .unsupported
        super.init()
        session.delegate = self
    }

    func start(elapsedProvider: @escaping () -> Double) async {
        guard isSupported else {
            status = .unsupported
            return
        }
        guard !isRunning else { return }

        startGeneration += 1
        let generation = startGeneration

        guard await ensureCameraAuthorized() else { return }
        guard generation == startGeneration else { return }

        self.elapsedProvider = elapsedProvider
        sustained = AttentionTrackingLogic.SustainedState()
        currentAttentionState = sustained.loggedState
        attentionLog = sustained.log
        didReceiveSample = false
        isPaused = false
        pendingLookAt = nil
        frameDispatchScheduled = false
        lastFailureMessage = nil

        let configuration = ARFaceTrackingConfiguration()
        configuration.isLightEstimationEnabled = false
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        isRunning = true
        status = .running
    }

    func stop() {
        startGeneration += 1
        guard isRunning else {
            status = .idle
            lastFailureMessage = nil
            return
        }
        resetRunningState()
        status = .idle
        lastFailureMessage = nil
    }

    func pause() {
        guard isRunning, !isPaused else { return }
        session.pause()
        isPaused = true
        status = .paused
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
        status = .running
    }

    private func ensureCameraAuthorized() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return true
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            if !granted {
                status = .permissionDenied
                return false
            }
            return true
        case .denied, .restricted:
            status = .permissionDenied
            return false
        @unknown default:
            status = .permissionDenied
            return false
        }
    }

    private func clearPendingDebounce() {
        sustained.pendingState = nil
        sustained.pendingSince = nil
    }

    private func resetRunningState() {
        session.pause()
        isRunning = false
        isPaused = false
        elapsedProvider = nil
        pendingLookAt = nil
        frameDispatchScheduled = false
        clearPendingDebounce()
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
    nonisolated func session(_ session: ARSession, didFailWithError error: Error) {
        Task { @MainActor in
            guard self.isRunning else { return }
            if let arError = error as? ARError, arError.errorCode == .cameraUnauthorized {
                self.status = .permissionDenied
            } else {
                self.status = .failed
                self.lastFailureMessage = error.localizedDescription
            }
            self.resetRunningState()
        }
    }

    nonisolated func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard let faceAnchor = anchors.compactMap({ $0 as? ARFaceAnchor }).first else { return }
        let lookAtPoint = faceAnchor.lookAtPoint
        Task { @MainActor in
            self.scheduleLookAtDispatch(lookAtPoint)
        }
    }
}

#endif
