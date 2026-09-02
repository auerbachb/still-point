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

    // Values the server confirmed to us that `currentUser` may not carry yet, held
    // so `syncFromCurrentUser()` cannot put the old value back on a control the
    // user just saved. Same shape and same reason as `confirmedUsername` in
    // `UsernameEditView`, and needed on both settled outcomes (#697):
    //
    //   - Superseded: the server took this change, but a newer-ticket response is
    //     the newest word, so `currentUser` never carries this field's new value.
    //   - Applied: winning the ordering does not make a response complete. An
    //     overlapping later-ticket write can be serialized *before* this toggle
    //     committed and still apply afterwards, carrying the pre-save value and
    //     clobbering the one this response had just adopted.
    //
    // Both are repaired by `reconcileSettingsFromServer()`, which is explicitly
    // best effort — so between the two there is a window, and on a failed read no
    // repair at all, during which `currentUser` contradicts a save that took.
    // Only Settings' own writes disable each other; the Home opt-in
    // (`enableDualTrack`) takes a settings ticket from outside that gate, so this
    // overlap is reachable rather than theoretical.
    //
    // A hold is released two ways. `syncFromCurrentUser()` drops it once a settings
    // response outranking the hold's barrier has been adopted — the account
    // genuinely catching up, as opposed to merely *reporting* the confirmed value,
    // which an overlapping write can be applied after and undo (see
    // `ConfirmedSettingHold`). Each toggle's `onChange` drops it as soon as the
    // control shows anything else, which can only be the user's own newer intent:
    // while a hold is live `syncFromCurrentUser()` writes exactly the held value, so
    // it never lands there. Without that second release, flipping a toggle back to
    // what the account already says would be swallowed by the no-op guard and then
    // sprung back by the next sync.
    @State private var confirmedIsPublic: ConfirmedSettingHold<Bool>?
    @State private var confirmedAphorismsEnabled: ConfirmedSettingHold<Bool>?
    @State private var confirmedAttentionTrackingEnabled: ConfirmedSettingHold<Bool>?
    @State private var confirmedAmbientSoundEnabled: ConfirmedSettingHold<Bool>?

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
                            Text("On by default: prevents auto-lock while a sit timer is running. Turn it off to let the screen sleep as usual.")
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
                        // Releases the hold on the user's own newer intent; see the
                        // `confirmed…` declarations at the top of the view.
                        if confirmedAttentionTrackingEnabled?.value != newValue {
                            confirmedAttentionTrackingEnabled = nil
                        }
                        guard !isUpdatingAttentionTracking else { return }
                        guard appVM.currentUser?.attentionTrackingEnabled != newValue else { return }
                        isUpdatingAttentionTracking = true
                        // Captured synchronously with the user's action rather than
                        // inside the task: the body runs on a later main-actor turn,
                        // so reading the generation there could pick up an account
                        // that replaced this one in the gap and apply this toggle's
                        // intent to them. Binding it here binds it to the identity
                        // that was live when the toggle was flipped, and still covers
                        // every later await — including the permission prompt (#665).
                        let identityAtStart = appVM.identityGeneration
                        // Taken here for the same reason, and one more: the camera
                        // prompt below is an await of unbounded length. A ticket
                        // taken after it would rank this opt-in behind a rename the
                        // user made while the prompt was up, so the opt-in's slower
                        // response could then revert that rename (#697).
                        let settingsTicket = appVM.nextSettingsRequestTicket()
                        Task {
                            defer { isUpdatingAttentionTracking = false }
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
                                // was never applied (mirrors the catch below). A superseded
                                // one is left alone: the server took this change, a newer
                                // save merely described the account after it, so the toggle
                                // already shows what was saved (#697).
                                if appVM.applySettingsUser(
                                    updated,
                                    startedAtGeneration: identityAtStart,
                                    requestTicket: settingsTicket
                                ) == .discarded {
                                    attentionTrackingEnabled = !newValue
                                } else {
                                    // Settled in our favour on both remaining outcomes, so
                                    // hold it until the account catches up. Nil when this
                                    // response was already a complete picture and there is
                                    // nothing to shadow.
                                    confirmedAttentionTrackingEnabled = appVM.settingsHold(on: newValue)
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
                        // Releases the hold on the user's own newer intent; see the
                        // `confirmed…` declarations at the top of the view.
                        if confirmedAmbientSoundEnabled?.value != newValue { confirmedAmbientSoundEnabled = nil }
                        guard !isUpdatingAmbientSound else { return }
                        guard appVM.currentUser?.ambientSoundEnabled != newValue else { return }
                        isUpdatingAmbientSound = true
                        // Captured synchronously with the user's action rather than
                        // inside the task: the body runs on a later main-actor turn,
                        // so reading the generation there could pick up an account
                        // that replaced this one in the gap and apply this toggle's
                        // intent to them. Binding it here binds it to the identity
                        // that was live when the toggle was flipped, and still covers
                        // every later await — including the permission prompt (#665).
                        let identityAtStart = appVM.identityGeneration
                        // Taken here for the same reason, and one more: the mic
                        // prompt below is an await of unbounded length. A ticket
                        // taken after it would rank this opt-in behind a rename the
                        // user made while the prompt was up, so the opt-in's slower
                        // response could then revert that rename (#697).
                        let settingsTicket = appVM.nextSettingsRequestTicket()
                        Task {
                            defer { isUpdatingAmbientSound = false }
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
                                // was never applied (mirrors the catch below). A superseded
                                // one is left alone: the server took this change, a newer
                                // save merely described the account after it, so the toggle
                                // already shows what was saved (#697).
                                if appVM.applySettingsUser(
                                    updated,
                                    startedAtGeneration: identityAtStart,
                                    requestTicket: settingsTicket
                                ) == .discarded {
                                    ambientSoundEnabled = !newValue
                                } else {
                                    // Settled in our favour on both remaining outcomes, so
                                    // hold it until the account catches up. Nil when this
                                    // response was already a complete picture and there is
                                    // nothing to shadow.
                                    confirmedAmbientSoundEnabled = appVM.settingsHold(on: newValue)
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
                        // Releases the hold on the user's own newer intent; see the
                        // `confirmed…` declarations at the top of the view.
                        if confirmedIsPublic?.value != newValue { confirmedIsPublic = nil }
                        guard !isSavingSettings else { return }
                        guard appVM.currentUser?.isPublic != newValue else { return }
                        isUpdating = true
                        // Captured synchronously with the user's action rather than
                        // inside the task: the body runs on a later main-actor turn,
                        // so reading the generation there could pick up an account
                        // that replaced this one in the gap and apply this toggle's
                        // intent to them. Binding it here binds it to the identity
                        // that was live when the toggle was flipped (#665).
                        let identityAtStart = appVM.identityGeneration
                        // Taken alongside it, and for the matching reason: bound to
                        // the moment the user flipped the toggle, so responses are
                        // applied in the order the changes were made rather than the
                        // order they came back (#697).
                        let settingsTicket = appVM.nextSettingsRequestTicket()
                        Task {
                            defer { isUpdating = false }
                            do {
                                // Re-checked before issuing the write: sending this would
                                // otherwise apply the previous user's intent to the
                                // account that replaced them.
                                guard identityAtStart == appVM.identityGeneration else { return }
                                let updated = try await APIClient.shared.updateSettings(isPublic: newValue)
                                // A discarded response means the session changed; put the
                                // toggle back rather than leaving it showing an intent that
                                // was never applied (mirrors the catch below). A superseded
                                // one is left alone: the server took this change, a newer
                                // save merely described the account after it, so the toggle
                                // already shows what was saved (#697).
                                if appVM.applySettingsUser(
                                    updated,
                                    startedAtGeneration: identityAtStart,
                                    requestTicket: settingsTicket
                                ) == .discarded {
                                    isPublic = !newValue
                                } else {
                                    // Settled in our favour on both remaining outcomes, so
                                    // hold it until the account catches up. Nil when this
                                    // response was already a complete picture and there is
                                    // nothing to shadow.
                                    confirmedIsPublic = appVM.settingsHold(on: newValue)
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
                        // Releases the hold on the user's own newer intent; see the
                        // `confirmed…` declarations at the top of the view.
                        if confirmedAphorismsEnabled?.value != newValue { confirmedAphorismsEnabled = nil }
                        guard !isUpdatingAphorisms else { return }
                        guard appVM.currentUser?.aphorismsEnabled != newValue else { return }
                        isUpdatingAphorisms = true
                        // Captured synchronously with the user's action rather than
                        // inside the task: the body runs on a later main-actor turn,
                        // so reading the generation there could pick up an account
                        // that replaced this one in the gap and apply this toggle's
                        // intent to them. Binding it here binds it to the identity
                        // that was live when the toggle was flipped (#665).
                        let identityAtStart = appVM.identityGeneration
                        // Taken alongside it, and for the matching reason: bound to
                        // the moment the user flipped the toggle, so responses are
                        // applied in the order the changes were made rather than the
                        // order they came back (#697).
                        let settingsTicket = appVM.nextSettingsRequestTicket()
                        Task {
                            defer { isUpdatingAphorisms = false }
                            do {
                                // Re-checked before issuing the write: sending this would
                                // otherwise apply the previous user's intent to the
                                // account that replaced them.
                                guard identityAtStart == appVM.identityGeneration else { return }
                                let updated = try await APIClient.shared.updateSettings(aphorismsEnabled: newValue)
                                // A discarded response means the session changed; put the
                                // toggle back rather than leaving it showing an intent that
                                // was never applied (mirrors the catch below). A superseded
                                // one is left alone: the server took this change, a newer
                                // save merely described the account after it, so the toggle
                                // already shows what was saved (#697).
                                if appVM.applySettingsUser(
                                    updated,
                                    startedAtGeneration: identityAtStart,
                                    requestTicket: settingsTicket
                                ) == .discarded {
                                    aphorismsEnabled = !newValue
                                } else {
                                    // Settled in our favour on both remaining outcomes, so
                                    // hold it until the account catches up. Nil when this
                                    // response was already a complete picture and there is
                                    // nothing to shadow.
                                    confirmedAphorismsEnabled = appVM.settingsHold(on: newValue)
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
        // Every settings adoption, not just the ones that move a watched field. A
        // reconciling read that confirms what the account already says changes none
        // of the four above, and it is precisely that read which settles a hold —
        // without this the hold it was issued for would stand for the life of the
        // view. Tickets are never reused, so this fires once per adoption.
        .onChange(of: appVM.lastAppliedSettingsTicket) { _, _ in
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

    /// Copies the account onto the controls — except where we are still holding a
    /// value the server confirmed and the account has not caught up to yet, which
    /// would otherwise put the old value back on a toggle the user just saved.
    ///
    /// Each held value is released only once a settings response outranking its
    /// barrier has been adopted — never merely because the account now *reports* the
    /// held value. Reporting it is not the same as having caught up: an overlapping
    /// write serialized before the save can be applied straight afterwards, putting
    /// the old value back with the hold already gone. Ranking the adopted response
    /// against the barrier is what tells the two apart (see `ConfirmedSettingHold`,
    /// and `confirmedUsername` in `UsernameEditView`).
    private func syncFromCurrentUser() {
        sessionIntroEnabled = !SessionIntroPrefs.isIntroOverlayHidden
        guard let user = appVM.currentUser else {
            // No account left. Drop every held value so a confirmation from one
            // session cannot cross into the next (#665), and fall back to the
            // signed-out defaults.
            confirmedIsPublic = nil
            confirmedAphorismsEnabled = nil
            confirmedAttentionTrackingEnabled = nil
            confirmedAmbientSoundEnabled = nil
            isPublic = false
            aphorismsEnabled = false
            attentionTrackingEnabled = false
            ambientSoundEnabled = false
            return
        }
        let appliedTicket = appVM.lastAppliedSettingsTicket

        confirmedIsPublic = confirmedIsPublic?.released(byAppliedTicket: appliedTicket)
        isPublic = confirmedIsPublic?.value ?? user.isPublic

        confirmedAphorismsEnabled = confirmedAphorismsEnabled?.released(byAppliedTicket: appliedTicket)
        aphorismsEnabled = confirmedAphorismsEnabled?.value ?? user.aphorismsEnabled

        confirmedAttentionTrackingEnabled =
            confirmedAttentionTrackingEnabled?.released(byAppliedTicket: appliedTicket)
        attentionTrackingEnabled = confirmedAttentionTrackingEnabled?.value ?? user.attentionTrackingEnabled

        confirmedAmbientSoundEnabled = confirmedAmbientSoundEnabled?.released(byAppliedTicket: appliedTicket)
        ambientSoundEnabled = confirmedAmbientSoundEnabled?.value ?? user.ambientSoundEnabled
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
