import SwiftUI
import StillPointShared

/// The Settings Log Out and Delete Account buttons.
///
/// Owns the whole deletion flow locally: the confirmation dialog, the final alert,
/// the in-flight flag that disables both buttons, and the error alert. Nothing is
/// lifted — neither action is a settings write, so neither waits on nor disables the
/// controls above.
struct SettingsDangerZoneSection: View {
    let appVM: AppViewModel

    @State private var showDeleteAccountDialog = false
    @State private var showDeleteAccountConfirm = false
    @State private var isDeletingAccount = false
    @State private var deleteAccountError = ""
    @State private var showDeleteAccountError = false

    var body: some View {
        // The parent stack's spacing, so the two buttons sit exactly as its own
        // children would.
        VStack(spacing: SPSpacing.s5) {
            Button {
                Task {
                    try? await PushNotificationCoordinator.shared.unregisterCurrentDeviceToken()
                    try? await APIClient.shared.logout()
                    appVM.didLogout()
                }
            } label: {
                Text("Log Out")
                    .font(SPFont.mono(14, weight: .medium))
                    .spCapsuleButtonStyle(.danger, size: .fullWidth)
            }
            .accessibilityIdentifier("settings.logoutButton")
            .disabled(isDeletingAccount)

            Button {
                showDeleteAccountDialog = true
            } label: {
                Group {
                    if isDeletingAccount {
                        ProgressView()
                            .tint(SPColor.dangerMuted)
                    } else {
                        Text("Delete Account")
                            .font(SPFont.mono(14, weight: .medium))
                            .foregroundStyle(SPColor.dangerMuted)
                    }
                }
                .spCapsuleButtonStyle(.danger, size: .fullWidth)
            }
            .disabled(isDeletingAccount)
            .accessibilityIdentifier("settings.deleteAccountButton")
            .confirmationDialog(
                "Delete your account?",
                isPresented: $showDeleteAccountDialog,
                titleVisibility: .visible
            ) {
                Button("Continue", role: .destructive) {
                    showDeleteAccountConfirm = true
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This permanently deletes your account and data.")
            }
            .alert("Final confirmation", isPresented: $showDeleteAccountConfirm) {
                Button("Delete Account", role: .destructive) {
                    Task {
                        await deleteAccount()
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This action cannot be undone.")
            }
            .alert("Could not delete account", isPresented: $showDeleteAccountError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(deleteAccountError)
            }
        }
    }

    private func deleteAccount() async {
        guard !isDeletingAccount else { return }
        isDeletingAccount = true
        defer { isDeletingAccount = false }

        do {
            try await APIClient.shared.deleteAccount()
            try? await PushNotificationCoordinator.shared.unregisterCurrentDeviceToken()
            appVM.didLogout()
        } catch let error as APIError {
            deleteAccountError = error.message
            showDeleteAccountError = true
        } catch {
            deleteAccountError = "Please try again."
            showDeleteAccountError = true
        }
    }
}
