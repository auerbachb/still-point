import SwiftUI
import StillPointShared

struct SettingsView: View {
    let appVM: AppViewModel
    @State private var notificationPrefs = NotificationPreferencesViewModel()
    @State private var isPublic: Bool = false
    @State private var aphorismsEnabled: Bool = false
    @State private var isUpdating = false
    @State private var isUpdatingAphorisms = false
    @State private var isSavingUsername = false
    @State private var showDeleteAccountDialog = false
    @State private var showDeleteAccountConfirm = false
    @State private var isDeletingAccount = false
    @State private var deleteAccountError = ""
    @State private var showDeleteAccountError = false

    private var isSavingSettings: Bool { isUpdating || isUpdatingAphorisms || isSavingUsername }

    var body: some View {
        NavigationStack {
            settingsScrollContent
        }
    }

    private var settingsScrollContent: some View {
        ScrollView {
            VStack(spacing: SPSpacing.s5) {
                Text("Settings")
                    .font(SPFont.serifItalic(28, weight: .light))
                    .foregroundStyle(Color(SPColor.fg))
                    .padding(.top, SPSpacing.s4)
                    .accessibilityIdentifier("settings.title")

                // Account info
                VStack(alignment: .leading, spacing: SPSpacing.s2) {
                    Text("ACCOUNT")
                        .font(SPFont.mono(11, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg4))
                        .tracking(2)

                    if let user = appVM.currentUser {
                        UsernameEditView(
                            user: user,
                            appVM: appVM,
                            updating: isUpdating || isUpdatingAphorisms,
                            savingUsername: $isSavingUsername
                        )

                        HStack {
                            Text("Email")
                                .font(SPFont.mono(13))
                                .foregroundStyle(Color(SPColor.fg3))
                            Spacer()
                            Text(user.email)
                                .font(SPFont.mono(13))
                                .foregroundStyle(Color(SPColor.fg))
                        }
                    }
                }
                .padding(SPSpacing.s3)
                .background(SPColor.surface1)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(SPColor.border1)
                )

                AppBlockingSettingsView(manager: appVM.appBlockingManager)

                notificationsLinkSection

                // Session display
                VStack(alignment: .leading, spacing: SPSpacing.s2) {
                    Text("SESSION")
                        .font(SPFont.mono(11, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg4))
                        .tracking(2)

                    Toggle(isOn: Bindable(appVM).keepScreenAwakeDuringSession) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Keep screen on during session")
                                .font(SPFont.mono(13))
                                .foregroundStyle(Color(SPColor.fg))
                            Text("Prevents auto-lock while a sit timer is running")
                                .font(SPFont.serif(13, weight: .light))
                                .foregroundStyle(Color(SPColor.fg4))
                        }
                    }
                    .tint(SPColor.green)
                    .accessibilityIdentifier("settings.keepScreenAwakeDuringSessionToggle")
                }
                .padding(SPSpacing.s3)
                .background(SPColor.surface1)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(SPColor.border1)
                )

                // Public board toggle
                VStack(alignment: .leading, spacing: SPSpacing.s2) {
                    Text("VISIBILITY")
                        .font(SPFont.mono(11, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg4))
                        .tracking(2)

                    Toggle(isOn: $isPublic) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Public Board")
                                .font(SPFont.mono(13))
                                .foregroundStyle(Color(SPColor.fg))
                            Text("Show your progress on the practitioners board")
                                .font(SPFont.serif(13, weight: .light))
                                .foregroundStyle(Color(SPColor.fg4))
                        }
                    }
                    .tint(SPColor.green)
                    .disabled(isSavingSettings)
                    .onChange(of: isPublic) { _, newValue in
                        guard !isSavingSettings else { return }
                        guard appVM.currentUser?.isPublic != newValue else { return }
                        isUpdating = true
                        Task {
                            defer { isUpdating = false }
                            do {
                                let updated = try await APIClient.shared.updateSettings(isPublic: newValue)
                                appVM.applySettingsUser(updated)
                            } catch {
                                // Revert on failure
                                isPublic = !newValue
                            }
                        }
                    }
                }
                .padding(SPSpacing.s3)
                .background(SPColor.surface1)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(SPColor.border1)
                )

                // Aphorisms toggle (#88)
                VStack(alignment: .leading, spacing: SPSpacing.s2) {
                    Toggle(isOn: $aphorismsEnabled) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Aphorisms")
                                .font(SPFont.mono(13))
                                .foregroundStyle(Color(SPColor.fg))
                            Text("Show a short meditation quote before each session")
                                .font(SPFont.serif(13, weight: .light))
                                .foregroundStyle(Color(SPColor.fg4))
                        }
                    }
                    .tint(SPColor.green)
                    .disabled(isSavingSettings)
                    .accessibilityIdentifier("settings.aphorismsToggle")
                    .onChange(of: aphorismsEnabled) { _, newValue in
                        guard !isUpdatingAphorisms else { return }
                        guard appVM.currentUser?.aphorismsEnabled != newValue else { return }
                        isUpdatingAphorisms = true
                        Task {
                            defer { isUpdatingAphorisms = false }
                            do {
                                let updated = try await APIClient.shared.updateSettings(aphorismsEnabled: newValue)
                                appVM.applySettingsUser(updated)
                            } catch {
                                // Revert on failure
                                aphorismsEnabled = !newValue
                            }
                        }
                    }
                }
                .padding(SPSpacing.s3)
                .background(SPColor.surface1)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(SPColor.border1)
                )

                // Logout
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

                Text(appVersionFooter)
                    .font(SPFont.mono(11, weight: .regular))
                    .foregroundStyle(Color(SPColor.fg4))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.top, SPSpacing.s5)
                    .accessibilityIdentifier("settings.appVersion")

                Spacer().frame(height: SPSpacing.s6)
            }
            .padding(.horizontal, SPSpacing.s4)
        }
        .stillPointBackground()
        .onAppear {
            syncFromCurrentUser()
        }
        .onChange(of: appVM.currentUser?.isPublic) { _, _ in
            guard appVM.currentUser != nil else { return }
            syncFromCurrentUser()
        }
        .onChange(of: appVM.currentUser?.aphorismsEnabled) { _, _ in
            guard appVM.currentUser != nil else { return }
            syncFromCurrentUser()
        }
    }

    private var notificationsLinkSection: some View {
        NavigationLink {
            NotificationsSettingsView(notificationPrefs: notificationPrefs)
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Notifications")
                        .font(SPFont.mono(13))
                        .foregroundStyle(Color(SPColor.fg))
                    Text("Push, reminders, quiet hours, and social alerts")
                        .font(SPFont.serif(13, weight: .light))
                        .foregroundStyle(Color(SPColor.fg4))
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg4))
            }
            .padding(SPSpacing.s3)
            .background(SPColor.surface1)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(SPColor.border1)
            )
        }
        .accessibilityIdentifier("settings.notificationsLink")
    }

    private func syncFromCurrentUser() {
        isPublic = appVM.currentUser?.isPublic ?? false
        aphorismsEnabled = appVM.currentUser?.aphorismsEnabled ?? false
    }

    private var appVersionFooter: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "v\(version) (\(build))"
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
