import SwiftUI
import StillPointShared

struct SettingsView: View {
    let appVM: AppViewModel
    @State private var notificationPrefs = NotificationPreferencesViewModel()
    @State private var isPublic: Bool = false
    @State private var isUpdating = false
    @State private var editingUsername = false
    @State private var usernameDraft = ""
    @State private var savingUsername = false
    @State private var usernameFieldError: String?
    @State private var usernameSuccessMessage: String?
    @State private var showDeleteAccountDialog = false
    @State private var showDeleteAccountConfirm = false
    @State private var isDeletingAccount = false
    @State private var deleteAccountError = ""
    @State private var showDeleteAccountError = false

    private var isSavingSettings: Bool { isUpdating || savingUsername }

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
                        usernameSection(for: user)

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
                        .foregroundStyle(SPColor.dangerMuted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, SPSpacing.s2)
                        .background(SPColor.surface1)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SPColor.dangerBorderSubtle))
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
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, SPSpacing.s2)
                    .background(SPColor.surface1)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(SPColor.dangerBorderSubtle))
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
        .onChange(of: appVM.currentUser?.username) { _, _ in
            if !editingUsername {
                syncFromCurrentUser()
            }
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

    @ViewBuilder
    private func usernameSection(for user: UserDTO) -> some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            if editingUsername {
                TextField("Username", text: $usernameDraft)
                    .font(SPFont.mono(15))
                    .foregroundStyle(Color(SPColor.fg))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(isSavingSettings)
                    .accessibilityIdentifier("settings.usernameField")
                    .onChange(of: usernameDraft) { _, newValue in
                        if newValue.count > UsernameValidation.maxLength {
                            usernameDraft = String(newValue.prefix(UsernameValidation.maxLength))
                        }
                    }

                HStack(spacing: SPSpacing.s2) {
                    Button {
                        Task { @MainActor in
                            await saveUsername(currentUsername: user.username)
                        }
                    } label: {
                        Text(savingUsername ? "Saving…" : "Save")
                            .font(SPFont.mono(11, weight: .medium))
                            .tracking(2)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isSavingSettings)
                    .accessibilityIdentifier("settings.usernameSaveButton")

                    Button("Cancel") {
                        cancelUsernameEdit(savedUsername: user.username)
                    }
                    .font(SPFont.mono(11, weight: .medium))
                    .tracking(2)
                    .buttonStyle(.bordered)
                    .disabled(isSavingSettings)
                    .accessibilityIdentifier("settings.usernameCancelButton")
                }

                if let usernameFieldError {
                    Text(usernameFieldError)
                        .font(SPFont.mono(11))
                        .foregroundStyle(SPColor.dangerMuted)
                        .accessibilityIdentifier("settings.usernameError")
                }
            } else {
                HStack(alignment: .center, spacing: SPSpacing.s2) {
                    Text("Username")
                        .font(SPFont.mono(13))
                        .foregroundStyle(Color(SPColor.fg3))
                    Spacer(minLength: SPSpacing.s2)
                    Text(user.username)
                        .font(SPFont.mono(13))
                        .foregroundStyle(Color(SPColor.fg))
                        .lineLimit(1)
                        .accessibilityIdentifier("settings.usernameDisplay")
                    Button("Edit") {
                        beginUsernameEdit(savedUsername: user.username)
                    }
                    .font(SPFont.mono(10, weight: .medium))
                    .tracking(2)
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Edit username")
                    .accessibilityIdentifier("settings.usernameEditButton")
                    .disabled(isSavingSettings)
                }

                if let usernameSuccessMessage {
                    Text(usernameSuccessMessage)
                        .font(SPFont.mono(11))
                        .foregroundStyle(SPColor.green)
                        .accessibilityIdentifier("settings.usernameSuccess")
                }
            }
        }
    }

    private func syncFromCurrentUser() {
        isPublic = appVM.currentUser?.isPublic ?? false
        if !editingUsername, let u = appVM.currentUser {
            usernameDraft = u.username
        }
    }

    private func beginUsernameEdit(savedUsername: String) {
        usernameDraft = savedUsername
        usernameFieldError = nil
        usernameSuccessMessage = nil
        editingUsername = true
    }

    private func cancelUsernameEdit(savedUsername: String) {
        editingUsername = false
        usernameFieldError = nil
        usernameDraft = savedUsername
    }

    @MainActor
    private func saveUsername(currentUsername: String) async {
        guard !isSavingSettings else { return }

        let trimmed = usernameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        usernameFieldError = nil
        usernameSuccessMessage = nil

        if trimmed == currentUsername {
            editingUsername = false
            return
        }

        guard UsernameValidation.isValid(trimmed) else {
            usernameFieldError = UsernameValidation.errorMessage
            return
        }

        savingUsername = true
        defer { savingUsername = false }

        do {
            let updated = try await APIClient.shared.updateSettings(username: trimmed)
            appVM.applySettingsUser(updated)
            usernameDraft = updated.username
            editingUsername = false
            usernameSuccessMessage = "Username updated"
        } catch let error as APIError {
            usernameFieldError = Self.message(for: error)
        } catch {
            usernameFieldError = "Could not update username. Please try again."
        }
    }

    private static func message(for error: APIError) -> String {
        switch error.status {
        case 409:
            return error.message
        case 400:
            if error.message == UsernameValidation.errorMessage {
                return UsernameValidation.errorMessage
            }
            return error.message
        default:
            return "Could not update username. Please try again."
        }
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
