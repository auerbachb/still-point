import Foundation
import GoogleSignIn
import StillPointShared
import UIKit

/// Drives the native Google Sign-In flow and maps `GIDSignInResult` into the JSON body for
/// `POST /api/auth/google-native`. Mirrors `AppleSignInController`, but Google has no SwiftUI
/// system button that performs the flow, so this controller both presents the sheet and
/// produces the request.
enum GoogleSignInController {
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
