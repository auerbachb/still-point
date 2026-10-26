import SwiftUI
import StillPointShared

/// The Settings tab: the title, a column of section cards, and the version footer.
/// Each card is its own view (#757) except the Notifications link, which hands on
/// the `notificationPrefs` this screen owns.
///
/// What stays here is the state the sections share. The account-backed control
/// values live here because `syncFromCurrentUser()` copies the account onto all of
/// them whenever any of its fields changes. Every in-flight flag lives here because
/// `isSavingSettings` folds them together and disables controls across several
/// sections at once.
struct SettingsView: View {
    let appVM: AppViewModel
    @State private var notificationPrefs = NotificationPreferencesViewModel()
    @State private var isPublic: Bool = false
    @State private var aphorismsEnabled: Bool = false
    @State private var sessionIntroEnabled: Bool = true
    @State private var attentionTrackingEnabled: Bool = false
    /// #563: opt-in ambient sound level capture during solo sits.
    @State private var ambientSoundEnabled: Bool = false
    /// #708: whether the long (primary) session is morning or evening.
    @State private var longSessionPeriod: SessionPeriod = .am
    @State private var isUpdating = false
    @State private var isUpdatingAphorisms = false
    @State private var isUpdatingAttentionTracking = false
    @State private var isUpdatingAmbientSound = false
    @State private var isUpdatingLongSessionPeriod = false
    @State private var isSavingUsername = false

    private var isSavingSettings: Bool {
        isUpdating || isUpdatingAphorisms || isUpdatingAttentionTracking || isUpdatingAmbientSound || isUpdatingLongSessionPeriod || isSavingUsername
    }

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

                SettingsAccountSection(
                    appVM: appVM,
                    updating: isUpdating || isUpdatingAphorisms,
                    savingUsername: $isSavingUsername
                )

                AppBlockingSettingsView(manager: appVM.appBlockingManager)

                notificationsLinkSection

                SettingsSessionSection(
                    appVM: appVM,
                    isSavingSettings: isSavingSettings,
                    longSessionPeriod: $longSessionPeriod,
                    isUpdatingLongSessionPeriod: $isUpdatingLongSessionPeriod,
                    sessionIntroEnabled: $sessionIntroEnabled,
                    attentionTrackingEnabled: $attentionTrackingEnabled,
                    isUpdatingAttentionTracking: $isUpdatingAttentionTracking,
                    ambientSoundEnabled: $ambientSoundEnabled,
                    isUpdatingAmbientSound: $isUpdatingAmbientSound
                )

                SettingsVisibilitySection(
                    appVM: appVM,
                    isSavingSettings: isSavingSettings,
                    isPublic: $isPublic,
                    isUpdating: $isUpdating
                )

                SettingsAphorismsSection(
                    appVM: appVM,
                    isSavingSettings: isSavingSettings,
                    aphorismsEnabled: $aphorismsEnabled,
                    isUpdatingAphorisms: $isUpdatingAphorisms
                )

                SettingsDangerZoneSection(appVM: appVM)

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
        .onChange(of: appVM.currentUser?.longSessionPeriod) { _, _ in
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

    /// Copies the account onto the controls, skipping any control whose own save is
    /// still in flight.
    ///
    /// Serializing the settings writes (#697) means `currentUser` can disagree with a
    /// control for exactly one reason: that control's own save has not come back yet,
    /// so the account still reports the value the user just replaced. Copying it over
    /// the control would revert the user's change on screen until the response landed
    /// — which any *other* field changing (a `me()` read, a save on another control)
    /// can trigger at any moment. Skipping those, and only those, needs no shadow copy
    /// of the confirmed value and no rule for when to stop trusting one: the flag is
    /// live for exactly as long as the save is, and it is the same flag that disables
    /// the control, so the user cannot have moved it in the meantime. Once it clears,
    /// the response has already been adopted (or the control explicitly reverted), so
    /// the account is what the control should show.
    private func syncFromCurrentUser() {
        sessionIntroEnabled = !SessionIntroPrefs.isIntroOverlayHidden
        guard let user = appVM.currentUser else {
            // No account left: fall back to the signed-out defaults (#665). Not
            // skipped for an in-flight save — there is no account for it to describe,
            // and its own identity guard will discard the response.
            isPublic = false
            aphorismsEnabled = false
            attentionTrackingEnabled = false
            ambientSoundEnabled = false
            longSessionPeriod = .am
            return
        }
        if !isUpdating { isPublic = user.isPublic }
        if !isUpdatingAphorisms { aphorismsEnabled = user.aphorismsEnabled }
        if !isUpdatingAttentionTracking { attentionTrackingEnabled = user.attentionTrackingEnabled }
        if !isUpdatingAmbientSound { ambientSoundEnabled = user.ambientSoundEnabled }
        if !isUpdatingLongSessionPeriod { longSessionPeriod = user.longSessionPeriod }
    }

    private var appVersionFooter: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "v\(version) (\(build))"
    }
}
