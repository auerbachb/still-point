import SwiftUI
import AuthenticationServices
import StillPointShared

struct AuthView: View {
    let appVM: AppViewModel
    @State private var vm = AuthViewModel()
    @State private var appleSignInRawNonce: String?
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
                            .spCapsuleButtonStyle(.neutral, size: .fullWidth, prominent: true)
                    }
                    .accessibilityIdentifier("auth.submitButton")
                    .disabled(!vm.isValid || vm.isAuthInFlight)
                    .opacity(vm.isValid && !vm.isAuthInFlight ? 1 : 0.5)

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

                    // OAuth chrome lives at the bottom of the form so it never splits the
                    // email/username/password fields. `SignInWithAppleButton` sits in a UIKit bridge
                    // that can steal hit-testing / layout from sibling fields on CI simulators, so the
                    // divider and button stay hidden under UI test mode — XCTest targets stable ids on
                    // the email/password path (#286 / CI).
                    if !isUiTestMode {
                        HStack(spacing: SPSpacing.s3) {
                            Rectangle()
                                .fill(SPColor.border1)
                                .frame(height: 1)
                            Text("or")
                                .font(SPFont.mono(12))
                                .foregroundStyle(Color(SPColor.fg4))
                            Rectangle()
                                .fill(SPColor.border1)
                                .frame(height: 1)
                        }

                        Button {
                            Task {
                                if let user = await vm.signInWithGoogle() {
                                    appVM.didLogin(user: user)
                                }
                            }
                        } label: {
                            HStack(spacing: SPSpacing.s2) {
                                GoogleGlyph()
                                    .frame(width: 18, height: 18)
                                Text("Continue with Google")
                                    .font(SPFont.serif(17))
                                    .foregroundStyle(Color(SPColor.fg))
                            }
                            .spCapsuleButtonStyle(.neutral, size: .fullWidth, stroke: SPColor.border2)
                            .foregroundStyle(Color(SPColor.fg))
                            .frame(height: 44)
                        }
                        .accessibilityIdentifier("auth.googleButton")
                        .disabled(vm.isAuthInFlight)
                        .opacity(vm.isAuthInFlight ? 0.5 : 1)

                        SignInWithAppleButton(.signIn) { request in
                            guard let rawNonce = try? AppleSignInNonce.randomNonceString() else {
                                appleSignInRawNonce = nil
                                return
                            }
                            appleSignInRawNonce = rawNonce
                            request.requestedScopes = [.fullName, .email]
                            request.nonce = AppleSignInNonce.sha256Hex(rawNonce)
                        } onCompletion: { result in
                            guard let rawNonce = appleSignInRawNonce else {
                                vm.error = "Could not prepare Sign in with Apple. Please try again."
                                return
                            }
                            appleSignInRawNonce = nil
                            switch result {
                            case .success(let authorization):
                                guard
                                    let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                                    let body = AppleSignInController.nativeSignInRequest(
                                        from: credential,
                                        rawNonce: rawNonce
                                    )
                                else {
                                    vm.error = "Could not read Sign in with Apple credentials."
                                    return
                                }
                                Task {
                                    if let user = await vm.signInWithApple(using: body) {
                                        appVM.didLogin(user: user)
                                    }
                                }
                            case .failure(let error):
                                if let authError = error as? ASAuthorizationError,
                                   authError.code == .canceled {
                                    return
                                }
                                vm.error = "Sign in with Apple failed. Please try again."
                            }
                        }
                        .signInWithAppleButtonStyle(.black)
                        .frame(height: 44)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SPColor.border2))
                        .disabled(vm.isAuthInFlight)
                        .opacity(vm.isAuthInFlight ? 0.5 : 1)
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

/// A lightweight rendering of the multi-color Google "G" mark, drawn with ring
/// segments plus the blue crossbar so it scales crisply without bundling an asset.
private struct GoogleGlyph: View {
    private let googleBlue = Color(red: 0.259, green: 0.522, blue: 0.957)
    private let googleRed = Color(red: 0.918, green: 0.263, blue: 0.208)
    private let googleYellow = Color(red: 0.984, green: 0.737, blue: 0.020)
    private let googleGreen = Color(red: 0.204, green: 0.659, blue: 0.325)

    var body: some View {
        GeometryReader { geo in
            let size = min(geo.size.width, geo.size.height)
            let lineWidth = size * 0.28
            ZStack {
                // Ring segments: trim 0 is at 3 o'clock, increasing clockwise.
                Circle().trim(from: 0.0, to: 0.25)
                    .stroke(googleGreen, style: StrokeStyle(lineWidth: lineWidth))
                Circle().trim(from: 0.25, to: 0.5)
                    .stroke(googleYellow, style: StrokeStyle(lineWidth: lineWidth))
                Circle().trim(from: 0.5, to: 0.78)
                    .stroke(googleRed, style: StrokeStyle(lineWidth: lineWidth))
                Circle().trim(from: 0.78, to: 0.95)
                    .stroke(googleBlue, style: StrokeStyle(lineWidth: lineWidth))
                // Crossbar of the "G" reaching in from the right edge to the center.
                googleBlue
                    .frame(width: size * 0.5, height: lineWidth)
                    .offset(x: size * 0.25)
            }
            .frame(width: size, height: size)
            .position(x: geo.size.width / 2, y: geo.size.height / 2)
        }
    }
}
