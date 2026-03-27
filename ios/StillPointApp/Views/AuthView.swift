import SwiftUI
import StillPointShared

struct AuthView: View {
    let appVM: AppViewModel
    @State private var vm = AuthViewModel()

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
                    styledField("Email", text: $vm.email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .autocapitalization(.none)

                    if vm.isSignUp {
                        styledField("Username", text: $vm.username)
                            .textContentType(.username)
                            .autocapitalization(.none)
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
                    .disabled(!vm.isValid || vm.isSubmitting)
                    .opacity(vm.isValid ? 1 : 0.5)
                }
                .padding(.horizontal, SPSpacing.s4)
            }
            .padding(.bottom, SPSpacing.s6)
        }
        .stillPointBackground()
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
