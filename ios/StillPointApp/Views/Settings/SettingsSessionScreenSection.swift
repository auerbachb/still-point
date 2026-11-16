import SwiftUI
import StillPointShared

/// The Settings "SESSION SCREEN" card (#75): which optional components the session
/// screen shows. The countdown and the pause/end controls are not listed because
/// they cannot be hidden.
///
/// Like the keep-screen-on and hold-cluster preferences, these are local device
/// preferences, not account settings. They bind straight to `SessionScreenPrefsStore`,
/// so they stay enabled while an account write is in flight.
struct SettingsSessionScreenSection: View {
    @State private var prefs = SessionScreenPrefsStore.load()

    var body: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            Text("SESSION SCREEN")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            VStack(alignment: .leading, spacing: SPSpacing.s3) {
                toggle(
                    "Block grid",
                    detail: "The row of boxes that fills as the sit runs.",
                    isOn: binding(\.showBlockGrid),
                    identifier: "settings.sessionScreen.blockGridToggle"
                )
                toggle(
                    "Progress bar",
                    detail: "The thin bar that fills across each minute.",
                    isOn: binding(\.showProgressBar),
                    identifier: "settings.sessionScreen.progressBarToggle"
                )
                toggle(
                    "Mind state bar",
                    detail: "The timeline of your mind state across the sit.",
                    isOn: binding(\.showMindStateBar),
                    identifier: "settings.sessionScreen.mindStateBarToggle"
                )
                toggle(
                    "Status label",
                    detail: "The line of text under the timer that names your current state.",
                    isOn: binding(\.showStatusLabel),
                    identifier: "settings.sessionScreen.statusLabelToggle"
                )
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

    private func toggle(
        _ title: String,
        detail: String,
        isOn: Binding<Bool>,
        identifier: String
    ) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(SPFont.mono(13))
                    .foregroundStyle(Color(SPColor.fg))
                Text(detail)
                    .font(SPFont.serif(13, weight: .light))
                    .foregroundStyle(Color(SPColor.fg4))
            }
        }
        .tint(SPColor.green)
        .accessibilityIdentifier(identifier)
    }

    /// Writes each change straight to the store. The view's own `prefs` copy is the
    /// source for the toggles, so there is no separate in-flight state to track.
    private func binding(_ keyPath: WritableKeyPath<SessionScreenPrefs, Bool>) -> Binding<Bool> {
        Binding(
            get: { prefs[keyPath: keyPath] },
            set: { newValue in
                prefs[keyPath: keyPath] = newValue
                SessionScreenPrefsStore.save(prefs)
            }
        )
    }
}
