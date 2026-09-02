/// A value the server confirmed for one of our own settings writes, shown in place
/// of what the account currently reports until a response arrives that *cannot* be
/// a snapshot taken before that write committed (#697).
///
/// ## Why a hold is needed at all
///
/// A settings response carries a whole user record describing the account as of the
/// moment the server serialized it. ``StaleResponseGuard`` orders those responses by
/// the order the user made the changes, which stops an older save from reverting a
/// newer one — but it cannot make any single response *complete*:
///
///   - A *superseded* response was committed by the server and merely lost the race
///     to describe the account, so the field it changed never reaches the local copy
///     at all.
///   - An *applied* response can still have been serialized before an overlapping
///     earlier-intent write committed, so it carries that write's pre-save value and
///     reverts it on adoption.
///
/// Either way the local copy can contradict a save the server took, so a control
/// bound directly to it would show the user their own change being undone. The hold
/// keeps the confirmed value on screen across that window.
///
/// ## Why the release needs a barrier rather than a value match
///
/// Releasing the hold as soon as the account first *reports* the confirmed value
/// looks sufficient and is not: an overlapping later-ticket write can be applied
/// after that point carrying a snapshot serialized before the save, putting the
/// field back to its old value with the hold already gone.
///
/// So the release is ranked instead of compared. ``barrier`` records the highest
/// settings ticket issued as of the moment the confirming response *arrived*.
/// Tickets are handed out when a request departs, so a response whose ticket is
/// **above** the barrier belongs to a request that departed after the confirming
/// response arrived — that is, after the server had already committed the change —
/// and therefore reflects it. That response is the account genuinely catching up,
/// whatever value it carries; anything at or below the barrier may predate the
/// commit and is not evidence of anything.
///
/// The value is deliberately *not* re-checked at release. A response that outranks
/// the barrier is the newest word on the account, so if it disagrees with the held
/// value the disagreement is real — another device, or an overlapping write that
/// legitimately committed last — and continuing to shadow it would strand a stale
/// value on screen for the life of the view.
public struct ConfirmedSettingHold<Value: Sendable & Equatable>: Sendable, Equatable {
    /// The value the server confirmed, displayed while the hold stands.
    public let value: Value

    /// Highest settings ticket issued as of the moment the confirming response
    /// arrived, captured *before* handling that response scheduled any reconciling
    /// read — so the read it schedules ranks above this and can settle the hold.
    public let barrier: Int

    public init(value: Value, barrier: Int) {
        self.value = value
        self.barrier = barrier
    }

    /// Whether the settings response most recently adopted into the account settles
    /// this hold.
    ///
    /// - Parameter appliedTicket: the ticket that response carried. Strictly greater
    ///   than ``barrier`` means its request departed after the confirming response
    ///   arrived, so it cannot predate the commit.
    public func isSettled(byAppliedTicket appliedTicket: Int) -> Bool {
        appliedTicket > barrier
    }

    /// This hold while it still stands, `nil` once ``isSettled(byAppliedTicket:)``.
    ///
    /// Shaped for the call site that owns an optional hold:
    /// `hold = hold?.released(byAppliedTicket: ticket)`.
    public func released(byAppliedTicket appliedTicket: Int) -> Self? {
        isSettled(byAppliedTicket: appliedTicket) ? nil : self
    }
}
