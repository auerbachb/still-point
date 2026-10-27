/// #851: what an account-backed Settings control shows once its save has ended.
///
/// Public Board, Aphorisms, gaze tracking, ambient sound and the long-session picker
/// all save through one round trip, `AppViewModel.saveSettingsControl`. Each control's
/// in-flight flag comes down however the save ends, and from then on Settings stops
/// skipping the control when it copies the account onto the screen. That copy runs
/// when Settings appears and when an account field changes, not when a flag comes
/// down, so the control has to show the right value the moment its flag comes down.
/// This says how to get there from each ending.
///
/// The account can change while a save waits its turn: a `me()` read ahead of it in
/// the queue can adopt a different account while Settings stays on screen. The save
/// is then dropped before anything is sent, and the control still shows a change made
/// on the account before. Putting back the value it showed before that change would
/// be wrong too, since that value is also the previous account's. The control takes
/// the value of the account now on screen instead.
///
/// The account can also change while a save's camera or microphone prompt is up. A
/// "no" given after that is handled the same way; see `Denial` (#888).
public enum SettingsControlSave {
    /// How a save ended, as far as its control is concerned.
    public enum Ending: Equatable, Sendable, CaseIterable {
        /// The permission gate said no for the account that asked: a denied camera or
        /// microphone prompt, or a device that cannot track gaze. Nothing was sent, and
        /// the gate has already put the control back and told the user why. A "no"
        /// given after the account changed ends as `.identityChanged` instead (#888).
        case notAuthorized

        /// The account changed before the request left, so nothing was sent: a
        /// sign-out, or a different account adopted while the save waited its turn or
        /// while its camera or microphone prompt was up (#888).
        case identityChanged

        /// The request threw.
        case failed

        /// The response was adopted, so the account now carries what the control
        /// shows.
        case applied

        /// A newer response had already been applied. The server did take this one,
        /// so the control keeps the change.
        case superseded

        /// The response belongs to a session that is gone: a sign-out, or an account
        /// switch, landed while the request was in flight.
        case discarded
    }

    /// What to do with the control. Generic over the account so a resync carries the
    /// account it was decided on, and so the decision can be tested without one.
    public enum Recovery<Account> {
        /// Leave it as it is.
        case keep

        /// Put it back to what it showed before the change.
        case revert

        /// Copy this account's value onto it: the account now on screen.
        case resync(Account)
    }

    /// - Parameter ending: how the save ended.
    /// - Parameter accountOnScreen: the account signed in now, the one Settings
    ///   shows. `nil` after a sign-out, which takes Settings off the screen.
    /// - Returns: what the control should do now that its flag is coming down.
    public static func recovery<Account>(
        after ending: Ending,
        accountOnScreen: Account?
    ) -> Recovery<Account> {
        switch ending {
        case .identityChanged:
            // With no account there is nothing to copy, and nowhere to copy it: signing
            // out takes Settings off the screen, and the Settings shown after the next
            // sign-in copies that account when it appears.
            guard let accountOnScreen else { return .keep }
            return .resync(accountOnScreen)
        case .failed, .discarded:
            // A discarded response with an account on screen would call for a resync
            // too, but the Settings that made the change is gone by then. Every read that
            // can adopt a different account runs on the settings queue, never beside a
            // save's request, so an identity change can land mid-request only by way of
            // a sign-out, and a sign-out takes Settings off the screen.
            return .revert
        case .notAuthorized, .applied, .superseded:
            return .keep
        }
    }

    /// #888: what a permission gate does with its "no", once its prompt is answered.
    ///
    /// The camera and microphone prompts are awaits of unbounded length, and the
    /// account can change while one is on screen. A "no" given after that answers a
    /// prompt put up for a change the account now on screen never made. Turning the
    /// control off would put that answer on the wrong account, and the alert would ask
    /// that account to allow access it never asked for. So the gate leaves both alone,
    /// and the save ends as an identity change: the control takes the value of the
    /// account now on screen, as it does for a save dropped while it waited its turn.
    ///
    /// The gate and the save each ask `denial(promptedAt:answeredAt:)` with the same
    /// two generations, so the save leaves the control alone exactly when the gate has
    /// already put it back.
    public enum Denial: Equatable, Sendable, CaseIterable {
        /// The account that asked is still the one on screen. The gate turns the
        /// control back off and raises its alert, as it always has.
        case resetAndAlert

        /// The account changed while the prompt was up: a sign-out, or another account
        /// adopted. The gate leaves the control and its alerts alone, and `recovery`
        /// decides what the control shows.
        case leaveForRecovery

        /// How the save ends after this "no".
        public var ending: Ending {
            switch self {
            case .resetAndAlert:
                return .notAuthorized
            case .leaveForRecovery:
                return .identityChanged
            }
        }
    }

    /// Compares identity generations, not account IDs: signing out and back in as the
    /// same account leaves the ID where it was but moves the generation, and a prompt
    /// put up before that belongs to a session that is gone (#665).
    ///
    /// - Parameter promptedAt: the identity generation the prompt was put up under.
    /// - Parameter answeredAt: the identity generation once the prompt is answered.
    /// - Returns: what the gate does with its "no", and with it how the save ends.
    public static func denial(promptedAt: Int, answeredAt: Int) -> Denial {
        promptedAt == answeredAt ? .resetAndAlert : .leaveForRecovery
    }
}

extension SettingsControlSave.Recovery: Equatable where Account: Equatable {}
extension SettingsControlSave.Recovery: Sendable where Account: Sendable {}
