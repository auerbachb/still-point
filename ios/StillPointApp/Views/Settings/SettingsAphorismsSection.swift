import SwiftUI
import StillPointShared

/// The Settings Aphorisms card (#88): the pre-session quote toggle.
///
/// Owns no state of its own. The toggle's value and its in-flight flag are lifted:
/// the parent copies the account onto `aphorismsEnabled` (skipping it while its save
/// is in flight) and folds `isUpdatingAphorisms` into `isSavingSettings`.
struct SettingsAphorismsSection: View {
    let appVM: AppViewModel
    /// True while any Settings write is in flight. Disables the toggle, matching the
    /// rest of the screen.
    let isSavingSettings: Bool
    @Binding var aphorismsEnabled: Bool
    @Binding var isUpdatingAphorisms: Bool

    var body: some View {
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
                appVM.saveSettingsControl(
                    saving: $isUpdatingAphorisms,
                    send: { try await APIClient.shared.updateSettings(aphorismsEnabled: newValue) },
                    revert: { aphorismsEnabled = !newValue }
                )
            }
        }
        .padding(SPSpacing.s3)
        .background(SPColor.surface1)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(SPColor.border1)
        )
    }
}
