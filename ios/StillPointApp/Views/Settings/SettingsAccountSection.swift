import SwiftUI
import StillPointShared

/// The Settings "ACCOUNT" card: the username block and the read-only email row.
///
/// Owns no state of its own. `updating` and `savingUsername` pass straight through
/// to `UsernameEditView`, which documents them; the parent lifts `savingUsername` so
/// a rename in flight disables its other controls too.
struct SettingsAccountSection: View {
    let appVM: AppViewModel
    /// True while another Settings write is in flight; see `UsernameEditView.updating`.
    let updating: Bool
    @Binding var savingUsername: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            Text("ACCOUNT")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            if let user = appVM.currentUser {
                UsernameEditView(
                    user: user,
                    appVM: appVM,
                    updating: updating,
                    savingUsername: $savingUsername
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
    }
}
