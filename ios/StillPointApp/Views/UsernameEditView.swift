import SwiftUI
import StillPointShared

/// Username display + inline edit block for the Settings "ACCOUNT" card.
///
/// Owns its edit UI state internally (editing flag, draft, error/success
/// messages). The parent passes the current user, an `AppViewModel` reference
/// (to persist updates), and an external `updating` flag reflecting other
/// in-flight Settings writes so the controls disable in lockstep with the rest
/// of the screen. The `savingUsername` flag is bound back up to the parent so
/// its other controls stay disabled while a username save is in flight.
struct UsernameEditView: View {
    let user: UserDTO
    let appVM: AppViewModel
    /// True while another Settings write (e.g. visibility / aphorisms) is in
    /// flight. Combined with the local save state to gate the controls.
    let updating: Bool
    /// Lifted so the parent Settings screen can keep its other controls (Public
    /// Board / Aphorisms toggles) disabled while a username save is in flight,
    /// matching the pre-extraction `isSavingSettings` behavior.
    @Binding var savingUsername: Bool

    @State private var editingUsername = false
    @State private var usernameDraft = ""
    @State private var usernameFieldError: String?
    @State private var usernameSuccessMessage: String?
    /// The name the server confirmed for our own save, held only until
    /// `currentUser` catches up.
    ///
    /// A *superseded* rename was committed by the server but is no longer the newest
    /// description of the account (#697), so `user.username` — which comes from
    /// `currentUser` — can still be the old name for as long as the reconciling
    /// `me()` takes, or permanently if that best-effort read fails. Showing that old
    /// name directly under "Username updated" would tell the user their rename did
    /// not take when in fact it did, so the confirmed name is what is displayed until
    /// the account itself reports one.
    @State private var confirmedUsername: String?

    private var isSaving: Bool { updating || savingUsername }

    /// What the account says, unless we are still holding a name the server
    /// confirmed to us and the account has not caught up to yet.
    private var displayedUsername: String { confirmedUsername ?? user.username }

    var body: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            if editingUsername {
                TextField("Username", text: $usernameDraft)
                    .font(SPFont.mono(15))
                    .foregroundStyle(Color(SPColor.fg))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(isSaving)
                    .accessibilityIdentifier("settings.usernameField")
                    .onChange(of: usernameDraft) { _, newValue in
                        if newValue.count > UsernameValidation.maxLength {
                            usernameDraft = String(newValue.prefix(UsernameValidation.maxLength))
                        }
                    }

                HStack(spacing: SPSpacing.s2) {
                    Button {
                        Task { @MainActor in
                            await saveUsername(currentUsername: displayedUsername)
                        }
                    } label: {
                        Text(savingUsername ? "Saving…" : "Save")
                            .font(SPFont.mono(11, weight: .medium))
                            .tracking(2)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isSaving)
                    .accessibilityIdentifier("settings.usernameSaveButton")

                    Button("Cancel") {
                        cancelUsernameEdit(savedUsername: displayedUsername)
                    }
                    .font(SPFont.mono(11, weight: .medium))
                    .tracking(2)
                    .buttonStyle(.bordered)
                    .disabled(isSaving)
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
                    Text(displayedUsername)
                        .font(SPFont.mono(13))
                        .foregroundStyle(Color(SPColor.fg))
                        .lineLimit(1)
                        .accessibilityIdentifier("settings.usernameDisplay")
                    Button("Edit") {
                        beginUsernameEdit(savedUsername: displayedUsername)
                    }
                    .font(SPFont.mono(10, weight: .medium))
                    .tracking(2)
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Edit username")
                    .accessibilityIdentifier("settings.usernameEditButton")
                    .disabled(isSaving)
                }

                if let usernameSuccessMessage {
                    Text(usernameSuccessMessage)
                        .font(SPFont.mono(11))
                        .foregroundStyle(SPColor.green)
                        .accessibilityIdentifier("settings.usernameSuccess")
                }
            }
        }
        .onAppear {
            if !editingUsername {
                usernameDraft = displayedUsername
            }
        }
        .onChange(of: appVM.currentUser?.username) { _, newValue in
            if !editingUsername, let newValue {
                usernameDraft = newValue
            }
            // The account has spoken since our save — the reconcile landed, or a
            // rename from elsewhere did — so it is authoritative again and the held
            // name must not keep shadowing it.
            confirmedUsername = nil
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
        guard !isSaving else { return }

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
            // Captured before the await: a response that outlived a sign-out must
            // not be applied to the next session (#665).
            let identityAtStart = appVM.identityGeneration
            // Taken alongside it: this rename has to outrank every settings toggle
            // the user flipped before tapping save, so a slower toggle response
            // cannot land last and put the old name back (#697).
            let settingsTicket = appVM.nextSettingsRequestTicket()
            let updated = try await APIClient.shared.updateSettings(username: trimmed)
            // If the view model discarded the response because the session changed
            // under us, do not tell the user their username was updated (#665). A
            // *superseded* one is still a success: the server accepted the rename,
            // it simply is no longer the newest description of the account, and
            // reporting that as a failure would be a lie about what was saved.
            guard appVM.applySettingsUser(
                updated,
                startedAtGeneration: identityAtStart,
                requestTicket: settingsTicket
            ) != .discarded else { return }
            usernameDraft = updated.username
            // Held so the display cannot contradict the success message on the
            // superseded path, where `currentUser` does not carry this rename yet.
            // Cleared by the `onChange` above the moment the account reports a name
            // of its own.
            confirmedUsername = updated.username
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
            return error.message
        default:
            return "Could not update username. Please try again."
        }
    }
}
