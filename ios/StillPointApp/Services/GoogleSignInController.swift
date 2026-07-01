import Foundation
import GoogleSignIn
import os
import StillPointShared
import UIKit

/// Drives the native Google Sign-In flow and maps `GIDSignInResult` into the JSON body for
/// `POST /api/auth/google-native`. Mirrors `AppleSignInController`, but Google has no SwiftUI
/// system button that performs the flow, so this controller both presents the sheet and
/// produces the request.
enum GoogleSignInController {
    /// Diagnostic logger for the native Google flow. Mirrors `APIClient.diagLog`
    /// (os.Logger) so failure detail reaches the device Console / xcresult — `print()`
    /// from the app process is not captured there, and the real `GIDSignInError` string
    /// is the decisive artifact for the non-reproducible #471 failure.
    static let log = Logger(subsystem: "com.brettonauerbach.stillpoint", category: "google-signin")

    enum GoogleSignInControllerError: LocalizedError {
        /// `GIDClientID` is missing from Info.plist (the iOS OAuth client ID is not configured).
        case notConfigured
        case noPresentingViewController
        case missingIDToken

        var errorDescription: String? {
            switch self {
            case .notConfigured:
                return "Google sign-in is not configured."
            case .noPresentingViewController:
                return "Could not present Google sign-in."
            case .missingIDToken:
                return "Google sign-in did not return an identity token."
            }
        }
    }

    /// Presents the Google sign-in sheet and returns the request body for the backend.
    /// Throws `CancellationError` if the surrounding task is cancelled, and surfaces
    /// `GIDSignInError.canceled` to callers (which treat user cancellation as a no-op).
    @MainActor
    static func signIn() async throws -> GoogleNativeSignInRequest {
        let clientID = infoPlistString("GIDClientID")
        guard let clientID, !clientID.isEmpty else {
            throw GoogleSignInControllerError.notConfigured
        }

        // Honor an explicit server (web) client ID when present so the backend can also
        // receive a server auth code; otherwise let the SDK default to the iOS client.
        let serverClientID = infoPlistString("GIDServerClientID")
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: clientID,
            serverClientID: (serverClientID?.isEmpty == false) ? serverClientID : nil
        )

        guard let presenter = topPresentedViewController() else {
            throw GoogleSignInControllerError.noPresentingViewController
        }

        let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)

        guard let idToken = result.user.idToken?.tokenString, !idToken.isEmpty else {
            throw GoogleSignInControllerError.missingIDToken
        }

        return GoogleNativeSignInRequest(
            idToken: idToken,
            serverAuthCode: result.serverAuthCode
        )
    }

    /// Classifies a thrown sign-in error for the UI layer and surfaces the *real*
    /// underlying error instead of a generic "try again" (#471).
    ///
    /// - Returns `nil` when the error is a benign cancellation (the surrounding `Task`
    ///   was cancelled, or the user dismissed the Google sheet) — the caller should
    ///   treat that as a silent no-op, never a failure.
    /// - Otherwise logs the full underlying `NSError` (domain, code, description, and any
    ///   `NSUnderlyingErrorKey`) to the device Console and returns a short, screenshot-
    ///   friendly message (domain + code) to display on the auth screen.
    static func userFacingError(for error: Error) -> String? {
        // Benign cancellations: surrounding Task cancelled, or the user dismissed the
        // Google sheet. Catch `CancellationError` explicitly so a user-cancel is never
        // reported as a failure.
        if error is CancellationError {
            return nil
        }
        if let signInError = error as? GIDSignInError, signInError.code == .canceled {
            return nil
        }
        // Some GoogleSignIn/bridging paths surface the user-cancel as a plain NSError in
        // the GIDSignInError domain that does not cast to GIDSignInError above; match the
        // bridged domain/code too so dismissing the sheet stays a silent no-op.
        let nsError = error as NSError
        if nsError.domain == GIDSignInError.errorDomain, nsError.code == GIDSignInError.Code.canceled.rawValue {
            return nil
        }

        // Our own pre-flight failures (missing GIDClientID, no presenter, missing token)
        // already carry a clear description — log + surface it verbatim. A `.notConfigured`
        // here means the build shipped without the `GID_*` client IDs injected, which is the
        // prime non-repro suspect (the SDK never presents, so the backend is never hit).
        if let controllerError = error as? GoogleSignInControllerError {
            log.error("google-signin pre-flight failure: \(String(describing: controllerError), privacy: .public)")
            return controllerError.errorDescription ?? "Google sign-in failed. Please try again."
        }

        let nsError = error as NSError
        let underlying = (nsError.userInfo[NSUnderlyingErrorKey] as? NSError).map { underlyingError in
            "\(underlyingError.domain) \(underlyingError.code) \(underlyingError.localizedDescription)"
        }
        log.error("\(GoogleSignInDiagnostics.logLine(domain: nsError.domain, code: nsError.code, description: nsError.localizedDescription, underlying: underlying), privacy: .public)")
        return GoogleSignInDiagnostics.userFacingMessage(domain: nsError.domain, code: nsError.code)
    }

    /// Logs a backend rejection of an already-obtained Google token distinctly from an
    /// in-app SDK failure, so Track A (backend) vs Track B (iOS client / Google Cloud)
    /// is separable in the device log (#471).
    static func logBackendFailure(_ error: APIError) {
        log.error("google-signin backend rejected token: status=\(error.status, privacy: .public) code=\(error.code ?? "none", privacy: .public) message=\(error.message, privacy: .public)")
    }

    /// Logs a client-side `APIError` (status 0) — e.g. a keychain save failure after the
    /// backend already accepted the token, or a pre-flight network error — on the iOS
    /// client track (Track B) so it is not mistaken for a backend rejection (#471).
    static func logClientFailure(_ error: APIError) {
        log.error("google-signin client-side failure (backend not the cause): status=\(error.status, privacy: .public) code=\(error.code ?? "none", privacy: .public) message=\(error.message, privacy: .public)")
    }

    private static func infoPlistString(_ key: String) -> String? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: key) as? String else {
            return nil
        }
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        // Treat an empty value or an unresolved `$(GID_…)` build-setting placeholder
        // (a build config that never set the setting) as "not configured" so callers
        // surface `.notConfigured` instead of handing the SDK a bogus client ID.
        guard !value.isEmpty, !(value.hasPrefix("$(") && value.hasSuffix(")")) else {
            return nil
        }
        return value
    }

    @MainActor
    private static func topPresentedViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes
        let windowScene = (scenes.first { $0.activationState == .foregroundActive } as? UIWindowScene)
            ?? scenes.compactMap { $0 as? UIWindowScene }.first
        guard
            let window = windowScene?.windows.first(where: { $0.isKeyWindow })
                ?? windowScene?.windows.first
        else {
            return nil
        }

        var top = window.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}
