import SwiftUI
import StillPointShared

@Observable
final class AuthViewModel {
    var isSignUp = false
    var email = ""
    var username = ""
    var password = ""
    var error: String?
    var isSubmitting = false

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
        guard isValid, !isSubmitting else { return nil }
        isSubmitting = true
        error = nil
        defer { isSubmitting = false }

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
            self.error = "Connection failed. Please try again."
            return nil
        }
    }
}
