import SwiftUI
import StillPointShared

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
