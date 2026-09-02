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
    private var isSaving: Bool { updating || savingUsername }

    /// What the account says. Nothing shadows it: settings writes are serialized
    /// (#697), so `currentUser` can only lag a rename while that rename is still in
    /// flight — and the whole block is disabled for exactly that long.
    private var displayedUsername: String { user.username }

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

        // Captured before the rename takes its place in line: a response that
        // outlived a sign-out must not be applied to the next session (#665).
        let identityAtStart = appVM.identityGeneration
        // Enqueued at the moment the user tapped Save, so this rename is sent after
        // every settings change they made before it and before every one they make
        // after — no toggle response can land last and put the old name back (#697).
        // Awaited so `savingUsername` above stays true, and the controls stay
        // disabled, for the whole time the rename is queued as well as in flight.
        await appVM.enqueueSettingsWrite {
            do {
                // Re-checked after the wait for the same reason the capture exists:
                // the session can end while this is queued behind another save.
                guard identityAtStart == appVM.identityGeneration else { return }
                // Taken immediately before the request, so it records when this left
                // and outranks the `me()` reads racing it (#697/#709). Ordering
                // against the other settings mutations is the queue's job.
                let settingsTicket = appVM.nextSettingsRequestTicket()
                let updated = try await APIClient.shared.updateSettings(username: trimmed)
                // If the view model discarded the response because the session changed
                // under us, do not tell the user their username was updated (#665).
                // Otherwise it is adopted — nothing else can be in flight to supersede
                // it — so the account itself now reports this name and the display
                // below cannot contradict the success message.
                guard appVM.applySettingsUser(
                    updated,
                    startedAtGeneration: identityAtStart,
                    requestTicket: settingsTicket
                ) != .discarded else { return }
                usernameDraft = updated.username
                editingUsername = false
                usernameSuccessMessage = "Username updated"
            } catch let error as APIError {
                usernameFieldError = Self.message(for: error)
            } catch {
                usernameFieldError = "Could not update username. Please try again."
            }
        }.value
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
