import SwiftUI
import AuthenticationServices
import StillPointShared

struct AuthView: View {
    let appVM: AppViewModel
    @State private var vm = AuthViewModel()
    let launchAuthStatusMessage: String?

    var body: some View {
        ScrollView {
            VStack(spacing: SPSpacing.s6) {
                // Brand lockup
                VStack(spacing: SPSpacing.s2) {
                    Text("Still Point")
                        .font(SPFont.brandTitle)
                        .foregroundStyle(Color(SPColor.fg))

                    Text("ATTENTION TRAINING")
                        .font(SPFont.brandSubtitle)
                        .foregroundStyle(Color(SPColor.fg3))
                        .tracking(4)
                }
                .padding(.top, 60)

                // Login / Sign Up toggle
                HStack(spacing: 0) {
                    toggleButton("Log In", isSelected: !vm.isSignUp) {
                        withAnimation { vm.isSignUp = false }
                    }
                    toggleButton("Sign Up", isSelected: vm.isSignUp) {
                        withAnimation { vm.isSignUp = true }
                    }
                }
                .background(SPColor.surface1)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(SPColor.border1))

                // Form
                VStack(spacing: SPSpacing.s3) {
                    if let launchAuthStatusMessage {
                        Text(launchAuthStatusMessage)
                            .font(SPFont.mono(12))
                            .foregroundStyle(SPColor.dangerMuted)
                            .multilineTextAlignment(.center)
                            .accessibilityIdentifier("authView.launchAuthStatusMessage")
                    }

                    styledField("Email", text: $vm.email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .accessibilityIdentifier("auth.emailField")

                    // `SignInWithAppleButton` sits in a UIKit bridge that can steal hit-testing /
                    // layout from sibling fields on CI simulators. XCTest targets stable ids on the
                    // email/password path — hide OAuth chrome under UI test mode only (#286 / CI).
                    if !isUiTestMode {
                        SignInWithAppleButton(.signIn) { request in
                            request.requestedScopes = [.fullName, .email]
                        } onCompletion: { result in
                            switch result {
                            case .success(let authorization):
                                guard
                                    let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                                    let body = AppleSignInController.nativeSignInRequest(from: credential)
                                else {
                                    vm.error = "Could not read Sign in with Apple credentials."
                                    return
                                }
                                Task {
                                    if let user = await vm.signInWithApple(using: body) {
                                        appVM.didLogin(user: user)
                                    }
                                }
                            case .failure:
                                vm.error = "Sign in with Apple was cancelled or failed."
                            }
                        }
                        .signInWithAppleButtonStyle(.black)
                        .frame(height: 44)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SPColor.border2))
                        .disabled(vm.isAppleSignInInFlight)
                        .opacity(vm.isAppleSignInInFlight ? 0.5 : 1)
                    }

                    if vm.isSignUp {
                        styledField("Username", text: $vm.username)
                            .textContentType(.username)
                            .textInputAutocapitalization(.never)
                            .accessibilityIdentifier("auth.usernameField")
                    }

                    SecureField("Password", text: $vm.password)
                        .textContentType(vm.isSignUp ? .newPassword : .password)
                        .font(SPFont.serif(17))
                        .padding(.horizontal, SPSpacing.s3)
                        .padding(.vertical, SPSpacing.s2)
                        .background(SPColor.surface1)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(SPColor.border2)
                        )
                        .foregroundStyle(Color(SPColor.fg))
                        .accessibilityIdentifier("auth.passwordField")

                    if let error = vm.error {
                        Text(error)
                            .font(SPFont.mono(13))
                            .foregroundStyle(SPColor.danger)
                    }

                    Button {
                        Task {
                            if let user = await vm.submit() {
                                appVM.didLogin(user: user)
                            }
                        }
                    } label: {
                        Text(vm.isSignUp ? "Begin the journey" : "Enter")
                            .font(SPFont.serifItalic(18, weight: .light))
                            .foregroundStyle(Color(SPColor.fg))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, SPSpacing.s2)
                            .background(SPColor.surface2)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(SPColor.border2))
                    }
                    .accessibilityIdentifier("auth.submitButton")
                    .disabled(!vm.isValid || vm.isSubmitting)
                    .opacity(vm.isValid ? 1 : 0.5)

                    if let resetMessage = vm.resetMessage {
                        Text(resetMessage)
                            .font(SPFont.mono(12))
                            .foregroundStyle(SPColor.greenText)
                            .multilineTextAlignment(.center)
                            .accessibilityIdentifier("auth.passwordResetMessage")
                    }

                    if !vm.isSignUp {
                        Button {
                            Task { await vm.requestPasswordReset() }
                        } label: {
                            Text(vm.isRequestingPasswordReset ? "Sending..." : "Forgot password?")
                                .font(SPFont.mono(12))
                                .foregroundStyle(Color(SPColor.fg3))
                                .underline()
                        }
                        .accessibilityIdentifier("auth.forgotPasswordButton")
                        .disabled(vm.isRequestingPasswordReset)
                        .padding(.top, SPSpacing.s1)
                    }
                }
                .padding(.horizontal, SPSpacing.s4)
            }
            .padding(.bottom, SPSpacing.s6)
        }
        .stillPointBackground()
    }

    private var isUiTestMode: Bool {
        ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] == "1"
    }

    private func toggleButton(_ title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(SPFont.mono(13, weight: .medium))
                .foregroundStyle(Color(isSelected ? SPColor.fg : SPColor.fg4))
                .padding(.horizontal, SPSpacing.s4)
                .padding(.vertical, SPSpacing.s2)
                .background(isSelected ? SPColor.surface3 : .clear)
                .clipShape(Capsule())
        }
    }

    private func styledField(_ placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .font(SPFont.serif(17))
            .padding(.horizontal, SPSpacing.s3)
            .padding(.vertical, SPSpacing.s2)
            .background(SPColor.surface1)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(SPColor.border2)
            )
            .foregroundStyle(Color(SPColor.fg))
    }
}
