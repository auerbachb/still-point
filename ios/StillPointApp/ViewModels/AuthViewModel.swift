import SwiftUI
import StillPointShared

@MainActor
@Observable
final class AuthViewModel {
    var isSignUp = false
    var email = ""
    var username = ""
    var password = ""
    var error: String?
    var resetMessage: String?
    var isRequestingPasswordReset = false
    /// True while any sign-in path (email/password or Apple) is in flight.
    var isAuthInFlight = false

    var isValid: Bool {
        let emailValid = email.contains("@") && email.contains(".")
        let passwordValid = password.count >= 8
        if isSignUp {
            let usernameValid = username.count >= 3 && username.count <= 30
                && username.range(of: "^[a-zA-Z0-9_]+$", options: .regularExpression) != nil
            return emailValid && usernameValid && passwordValid
        }
        return emailValid && passwordValid
    }

    func submit() async -> UserDTO? {
        guard isValid, !isAuthInFlight else { return nil }
        isAuthInFlight = true
        error = nil
        resetMessage = nil
        defer { isAuthInFlight = false }

        do {
            if isSignUp {
                let user = try await APIClient.shared.signup(
                    email: email, username: username, password: password
                )
                return user
            } else {
                let user = try await APIClient.shared.login(
                    email: email, password: password
                )
                return user
            }
        } catch let apiError as APIError {
            error = apiError.message
            return nil
        } catch {
            print("Auth submit failed: \(error.localizedDescription)")
            self.error = "Connection failed. Please try again."
            return nil
        }
    }

    func signInWithApple(using request: AppleNativeSignInRequest) async -> UserDTO? {
        guard !isAuthInFlight else { return nil }
        isAuthInFlight = true
        error = nil
        resetMessage = nil
        defer { isAuthInFlight = false }

        do {
            return try await APIClient.shared.signInWithApple(request)
        } catch let apiError as APIError {
            error = apiError.message
            return nil
        } catch {
            self.error = "Connection failed. Please try again."
            return nil
        }
    }

    func signInWithGoogle() async -> UserDTO? {
        guard !isAuthInFlight else { return nil }
        isAuthInFlight = true
        error = nil
        resetMessage = nil
        defer { isAuthInFlight = false }

        do {
            let request = try await GoogleSignInController.signIn()
            return try await APIClient.shared.signInWithGoogle(request)
        } catch let apiError as APIError {
            // Only a non-zero status is a backend rejection of an already-obtained token
            // (e.g. aud mismatch → 401). A status-0 APIError is client-side — thrown after
            // the backend already accepted the token (e.g. "Unable to securely save auth
            // token") or before it was reached (no connection) — so logging it as a backend
            // rejection is misleading. Route each to its own track, then show the message.
            if apiError.status != 0 {
                GoogleSignInController.logBackendFailure(apiError)
            } else {
                GoogleSignInController.logClientFailure(apiError)
            }
            error = apiError.message
            return nil
        } catch {
            // Surface the real underlying error (GIDSignInError / NSError) rather than a
            // generic "try again" so the next on-device occurrence is diagnosable (#471).
            // `userFacingError` returns nil for benign cancellations (Task cancelled or the
            // user dismissed the sheet), which stay a silent no-op.
            if let message = GoogleSignInController.userFacingError(for: error) {
                self.error = message
            }
            return nil
        }
    }

    func requestPasswordReset() async {
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isRequestingPasswordReset else { return }
        guard trimmedEmail.contains("@") && trimmedEmail.contains(".") else {
            error = "Enter your email first."
            return
        }

        isRequestingPasswordReset = true
        error = nil
        resetMessage = nil
        defer { isRequestingPasswordReset = false }

        do {
            try await APIClient.shared.requestPasswordReset(email: trimmedEmail)
            resetMessage = "If an account exists for that email, a reset link will arrive shortly."
        } catch let apiError as APIError {
            error = apiError.message
        } catch {
            print("Password reset request failed: \(error.localizedDescription)")
            self.error = "Connection failed. Please try again."
        }
    }
}
