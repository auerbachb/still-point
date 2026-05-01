import AuthenticationServices
import StillPointShared
import SwiftUI
import UIKit

/// Bridges Sign in with Apple (`ASAuthorizationController`) to
/// `POST /api/auth/apple-native` (#286).
enum AppleSignInController {
    static func makeCoordinator(
        onSuccess: @escaping @Sendable (UserDTO) -> Void,
        onError: @escaping @Sendable (String) -> Void
    ) -> Coordinator {
        Coordinator(onSuccess: onSuccess, onError: onError)
    }

    final class Coordinator: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
        private let onSuccess: @Sendable (UserDTO) -> Void
        private let onError: @Sendable (String) -> Void

        init(onSuccess: @escaping @Sendable (UserDTO) -> Void, onError: @escaping @Sendable (String) -> Void) {
            self.onSuccess = onSuccess
            self.onError = onError
        }

        @objc func handleTap() {
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }

        func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let window = scenes
                .flatMap(\.windows)
                .first { $0.isKeyWindow }
                ?? scenes.flatMap(\.windows).first
            precondition(window != nil, "Sign in with Apple requires an active UIWindow")
            return window!
        }

        func authorizationController(
            controller: ASAuthorizationController,
            didCompleteWithAuthorization authorization: ASAuthorization
        ) {
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                onError("Unexpected credential type")
                return
            }
            guard let tokenData = credential.identityToken,
                  let identityToken = String(data: tokenData, encoding: .utf8) else {
                onError("Missing identity token")
                return
            }
            guard let codeData = credential.authorizationCode,
                  let authorizationCode = String(data: codeData, encoding: .utf8) else {
                onError("Missing authorization code")
                return
            }

            var fullNamePayload: [String: String]?
            if let pn = credential.fullName {
                var d: [String: String] = [:]
                if let g = pn.givenName { d["givenName"] = g }
                if let f = pn.familyName { d["familyName"] = f }
                fullNamePayload = d.isEmpty ? nil : d
            }

            Task {
                do {
                    let user = try await APIClient.shared.appleNativeSignIn(
                        identityToken: identityToken,
                        authorizationCode: authorizationCode,
                        fullName: fullNamePayload
                    )
                    await MainActor.run { onSuccess(user) }
                } catch let api as APIError {
                    await MainActor.run { onError(api.message) }
                } catch {
                    await MainActor.run { onError("Connection failed. Please try again.") }
                }
            }
        }

        func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
            let ns = error as NSError
            if ns.domain == ASAuthorizationError.errorDomain,
               ns.code == ASAuthorizationError.canceled.rawValue {
                return
            }
            onError(error.localizedDescription)
        }
    }
}
