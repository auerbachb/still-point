import AVFoundation
import SwiftUI
import StillPointShared
import UIKit

struct SettingsView: View {
    let appVM: AppViewModel
    @State private var notificationPrefs = NotificationPreferencesViewModel()
    @State private var isPublic: Bool = false
    @State private var aphorismsEnabled: Bool = false
    @State private var sessionIntroEnabled: Bool = true
    @State private var attentionTrackingEnabled: Bool = false
    /// #563: opt-in ambient sound level capture during solo sits.
    @State private var ambientSoundEnabled: Bool = false
    @State private var isUpdating = false
    @State private var isUpdatingAphorisms = false
    @State private var isUpdatingAttentionTracking = false
    @State private var isUpdatingAmbientSound = false
    @State private var isSavingUsername = false
    @State private var showDeleteAccountDialog = false
    @State private var showDeleteAccountConfirm = false
    @State private var isDeletingAccount = false
    @State private var deleteAccountError = ""
    @State private var showDeleteAccountError = false
    @State private var showAttentionUnsupportedAlert = false
    @State private var showAttentionPermissionDeniedAlert = false
    @State private var showAmbientSoundPermissionDeniedAlert = false

    private var isSavingSettings: Bool { isUpdating || isUpdatingAphorisms || isUpdatingAttentionTracking || isUpdatingAmbientSound || isSavingUsername }

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

                    Toggle(isOn: $sessionIntroEnabled) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Session intro overlay")
                                .font(SPFont.mono(13))
                                .foregroundStyle(Color(SPColor.fg))
                            Text("Show a brief intro before each session countdown begins")
                                .font(SPFont.serif(13, weight: .light))
                                .foregroundStyle(Color(SPColor.fg4))
                        }
                    }
                    .tint(SPColor.green)
                    .accessibilityIdentifier("settings.sessionIntroToggle")
                    .onChange(of: sessionIntroEnabled) { _, newValue in
                        SessionIntroPrefs.setIntroOverlayHidden(!newValue)
                    }

                    // #526: local hide preference for distraction/hyperfocus hold cluster.
                    Toggle(isOn: Bindable(appVM.trackingControlPrefsManager).hideDistractionHyperfocusControls) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Hide distraction & hyperfocus controls")
                                .font(SPFont.mono(13))
                                .foregroundStyle(Color(SPColor.fg))
                            Text("Remove hold buttons during solo sessions. The timer is unchanged.")
                                .font(SPFont.serif(13, weight: .light))
                                .foregroundStyle(Color(SPColor.fg4))
                        }
                    }
                    .tint(SPColor.green)
                    .accessibilityIdentifier("settings.hideDistractionHyperfocusToggle")

                    Toggle(isOn: $attentionTrackingEnabled) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Gaze attention tracking")
                                .font(SPFont.mono(13))
                                .foregroundStyle(Color(SPColor.fg))
                            Text("Uses the front camera during sessions to log when your gaze leaves the screen. Off by default.")
                                .font(SPFont.serif(13, weight: .light))
                                .foregroundStyle(Color(SPColor.fg4))
                        }
                    }
                    .tint(SPColor.green)
                    .disabled(isSavingSettings)
                    .accessibilityIdentifier("settings.attentionTrackingToggle")
                    .onChange(of: attentionTrackingEnabled) { _, newValue in
                        guard !isUpdatingAttentionTracking else { return }
                        guard appVM.currentUser?.attentionTrackingEnabled != newValue else { return }
                        isUpdatingAttentionTracking = true
                        Task {
                            defer { isUpdatingAttentionTracking = false }
                            // Captured at the very top, before any await —
                            // including a permission prompt. A sign-out during that
                            // prompt must not let this toggle's intent be applied to
                            // the replacement account (#665).
                            let identityAtStart = appVM.identityGeneration
                            if newValue {
                                let capability = await AttentionTrackingCapability.requestCameraAccessIfNeeded()
                                switch capability {
                                case .unsupported:
                                    attentionTrackingEnabled = false
                                    showAttentionUnsupportedAlert = true
                                    return
                                case .permissionDenied:
                                    attentionTrackingEnabled = false
                                    showAttentionPermissionDeniedAlert = true
                                    return
                                default:
                                    break
                                }
                            }
                            do {
                                // Re-checked before issuing the write: sending this would
                                // otherwise apply the previous user's intent to the
                                // account that replaced them.
                                guard identityAtStart == appVM.identityGeneration else { return }
                                let updated = try await APIClient.shared.updateSettings(attentionTrackingEnabled: newValue)
                                // A discarded response means the session changed; put the
                                // toggle back rather than leaving it showing an intent that
                                // was never applied (mirrors the catch below).
                                if !appVM.applySettingsUser(updated, startedAtGeneration: identityAtStart) {
                                    attentionTrackingEnabled = !newValue
                                }
                            } catch {
                                attentionTrackingEnabled = !newValue
                            }
                        }
                    }

                    // #563: ambient sound level capture
                    Toggle(isOn: $ambientSoundEnabled) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Ambient sound level")
                                .font(SPFont.mono(13))
                                .foregroundStyle(Color(SPColor.fg))
                            Text("Samples mic volume during solo sits to log quiet vs. loud environments. No audio is stored. Off by default.")
                                .font(SPFont.serif(13, weight: .light))
                                .foregroundStyle(Color(SPColor.fg4))
                        }
                    }
                    .tint(SPColor.green)
                    .disabled(isSavingSettings)
                    .accessibilityIdentifier("settings.ambientSoundToggle")
                    .onChange(of: ambientSoundEnabled) { _, newValue in
                        guard !isUpdatingAmbientSound else { return }
                        guard appVM.currentUser?.ambientSoundEnabled != newValue else { return }
                        isUpdatingAmbientSound = true
                        Task {
                            defer { isUpdatingAmbientSound = false }
                            // Captured at the very top, before any await —
                            // including a permission prompt. A sign-out during that
                            // prompt must not let this toggle's intent be applied to
                            // the replacement account (#665).
                            let identityAtStart = appVM.identityGeneration
                            if newValue {
                                let granted = await AVAudioApplication.requestRecordPermission()
                                if !granted {
                                    ambientSoundEnabled = false
                                    showAmbientSoundPermissionDeniedAlert = true
                                    return
                                }
                            }
                            do {
                                // Re-checked before issuing the write: sending this would
                                // otherwise apply the previous user's intent to the
                                // account that replaced them.
                                guard identityAtStart == appVM.identityGeneration else { return }
                                let updated = try await APIClient.shared.updateSettings(ambientSoundEnabled: newValue)
                                // A discarded response means the session changed; put the
                                // toggle back rather than leaving it showing an intent that
                                // was never applied (mirrors the catch below).
                                if !appVM.applySettingsUser(updated, startedAtGeneration: identityAtStart) {
                                    ambientSoundEnabled = !newValue
                                }
                            } catch {
                                ambientSoundEnabled = !newValue
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
                            // Captured at the very top, before any await —
                            // including a permission prompt. A sign-out during that
                            // prompt must not let this toggle's intent be applied to
                            // the replacement account (#665).
                            let identityAtStart = appVM.identityGeneration
                            do {
                                // Re-checked before issuing the write: sending this would
                                // otherwise apply the previous user's intent to the
                                // account that replaced them.
                                guard identityAtStart == appVM.identityGeneration else { return }
                                let updated = try await APIClient.shared.updateSettings(isPublic: newValue)
                                // A discarded response means the session changed; put the
                                // toggle back rather than leaving it showing an intent that
                                // was never applied (mirrors the catch below).
                                if !appVM.applySettingsUser(updated, startedAtGeneration: identityAtStart) {
                                    isPublic = !newValue
                                }
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
                            // Captured at the very top, before any await —
                            // including a permission prompt. A sign-out during that
                            // prompt must not let this toggle's intent be applied to
                            // the replacement account (#665).
                            let identityAtStart = appVM.identityGeneration
                            do {
                                // Re-checked before issuing the write: sending this would
                                // otherwise apply the previous user's intent to the
                                // account that replaced them.
                                guard identityAtStart == appVM.identityGeneration else { return }
                                let updated = try await APIClient.shared.updateSettings(aphorismsEnabled: newValue)
                                // A discarded response means the session changed; put the
                                // toggle back rather than leaving it showing an intent that
                                // was never applied (mirrors the catch below).
                                if !appVM.applySettingsUser(updated, startedAtGeneration: identityAtStart) {
                                    aphorismsEnabled = !newValue
                                }
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
        .onChange(of: appVM.currentUser?.attentionTrackingEnabled) { _, _ in
            guard appVM.currentUser != nil else { return }
            syncFromCurrentUser()
        }
        .onChange(of: appVM.currentUser?.ambientSoundEnabled) { _, _ in
            guard appVM.currentUser != nil else { return }
            syncFromCurrentUser()
        }
        .alert("Microphone access required", isPresented: $showAmbientSoundPermissionDeniedAlert) {
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Ambient sound level tracking needs microphone access. Allow microphone access in Settings to enable this feature.")
        }
        .alert("Gaze tracking unavailable", isPresented: $showAttentionUnsupportedAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("This device does not support TrueDepth face tracking. Gaze attention tracking requires an iPhone or iPad with a front-facing TrueDepth camera.")
        }
        .alert("Camera access required", isPresented: $showAttentionPermissionDeniedAlert) {
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Gaze attention tracking needs front camera access. Allow camera access in Settings to enable this feature.")
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
        sessionIntroEnabled = !SessionIntroPrefs.isIntroOverlayHidden
        attentionTrackingEnabled = appVM.currentUser?.attentionTrackingEnabled ?? false
        ambientSoundEnabled = appVM.currentUser?.ambientSoundEnabled ?? false
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
