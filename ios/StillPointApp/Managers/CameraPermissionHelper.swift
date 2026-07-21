import AVFoundation
import SwiftUI

/// Lightweight camera authorization helper with a clean deny path.
///
/// Mirrors the push-notification permission pattern in `NotificationsSettingsView` —
/// on denial the caller shows an alert with an "Open Settings" deep-link action via
/// the `.cameraPermissionDeniedAlert(isPresented:)` modifier below.
enum CameraPermissionHelper {
    /// Current camera authorization status, without prompting the user.
    static var status: AVAuthorizationStatus {
        AVCaptureDevice.authorizationStatus(for: .video)
    }

    /// `true` when camera access is already `.authorized`.
    static var isAuthorized: Bool { status == .authorized }

    /// `true` when the user has explicitly denied or the system has restricted access.
    static var isDenied: Bool {
        let s = status
        return s == .denied || s == .restricted
    }

    /// Requests camera permission when status is `.notDetermined`; calls `completion` on
    /// the main actor with the resulting status.
    ///
    /// - `.authorized`: camera may proceed.
    /// - `.denied` / `.restricted`: caller should show `cameraPermissionDeniedAlert`.
    static func requestIfNeeded(completion: @escaping @MainActor (AVAuthorizationStatus) -> Void) {
        switch status {
        case .authorized:
            Task { @MainActor in completion(.authorized) }
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                Task { @MainActor in completion(granted ? .authorized : .denied) }
            }
        case .denied, .restricted:
            let current = status
            Task { @MainActor in completion(current) }
        @unknown default:
            Task { @MainActor in completion(.denied) }
        }
    }
}

// MARK: - Permission-denied alert modifier

extension View {
    /// Attaches a camera-access-denied alert with an "Open Settings" deep-link action,
    /// mirroring the `showPushPermissionDeniedAlert` pattern in `NotificationsSettingsView`.
    func cameraPermissionDeniedAlert(isPresented: Binding<Bool>) -> some View {
        alert(
            "Camera Access Required",
            isPresented: isPresented
        ) {
            Button("Open Settings") {
                guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                UIApplication.shared.open(url)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("To photograph your meditation environment, allow camera access for Still Point in Settings.")
        }
    }
}
