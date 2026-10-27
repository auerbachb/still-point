import SwiftUI
import StillPointShared

/// The Settings "VISIBILITY" card: the Public Board toggle.
///
/// Owns no state of its own. The toggle's value and its in-flight flag are lifted:
/// the parent copies the account onto `isPublic` (skipping it while its save is in
/// flight) and folds `isUpdating` into `isSavingSettings`.
struct SettingsVisibilitySection: View {
    let appVM: AppViewModel
    /// True while any Settings write is in flight. Disables the toggle, and also
    /// keeps a change to it from starting a save of its own.
    let isSavingSettings: Bool
    @Binding var isPublic: Bool
    @Binding var isUpdating: Bool

    var body: some View {
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
                appVM.saveSettingsControl(
                    saving: $isUpdating,
                    send: { try await APIClient.shared.updateSettings(isPublic: newValue) },
                    revert: { isPublic = !newValue }
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
