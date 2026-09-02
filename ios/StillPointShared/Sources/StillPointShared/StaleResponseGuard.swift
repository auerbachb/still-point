/// Newest-wins ordering for overlapping requests that all write the same piece of
/// state.
///
/// A response describes its subject as it stood when the request *left*. When two
/// requests are in flight at once, the one that returns second is not necessarily
/// the one that left second, so applying responses in arrival order can revive a
/// value a newer request already replaced. Serializing each caller against itself
/// does not help: the collision is between *different* callers (a read and a
/// write), which have no shared lock.
///
/// The rule here is intent order, not arrival order. Every caller takes a ticket
/// from ``nextTicket()`` *before* its `await`, and hands it back to
/// ``shouldApply(ticket:from:)`` when the response lands, saying whether the
/// response merely observed the value or confirms a committed change
/// (``ResponseKind``). A response is applied only while nothing newer has been.
///
/// ```swift
/// let ticket = ordering.nextTicket()
/// let value = try await fetch()
/// guard ordering.shouldApply(ticket: ticket, from: .read) else { return }
/// store(value)
/// ```
///
/// Web parity: `suppressDuringSessionPrefVersion()` in `src/lib/sessionSuppressionPrefs.ts`,
/// sampled either side of the fetch in `useSessionSuppressionRelay` (#709).
///
/// Comparing the *values* instead cannot express this. Two writes that land in one
/// flight end where they started, and a value that was cleared reads the same as
/// one explicitly set to the default — both look like "nothing changed" while the
/// response is in fact stale.
///
/// Not thread-safe by itself: hold it on an actor or, as the app does, on a
/// `@MainActor` type.
public struct StaleResponseGuard: Sendable {
    /// What a response is worth as evidence.
    public enum ResponseKind: Sendable {
        /// The response only *observed* the value. It is authoritative for the
        /// moment its request left, and nothing later.
        case read

        /// The response *confirms a change* the server committed. It is newer than
        /// anything already in flight — including a read that started after the
        /// write did, since that read can still have reached the server before the
        /// write committed and come back describing the old value.
        case write
    }

    /// Highest ticket handed out. Monotonic, so a later request always outranks an
    /// earlier one.
    private var issued = 0

    /// Highest ticket whose response was applied, by a read or a write. Starts
    /// below the first ticket (`1`) so the first response through always lands.
    /// Bars a read from overwriting anything newer.
    private var applied = 0

    /// Highest ticket whose *write* response was applied. Tracked separately
    /// because only a newer write may overrule a write: a read that merely landed
    /// first must not swallow the change the user actually made, which it would if
    /// writes were tested against ``applied``.
    private var appliedWrite = 0

    public init() {}

    /// Take a ticket for a request that is about to start.
    ///
    /// Call this *before* the `await`, so the ticket records when the request left
    /// rather than when its response happened to arrive.
    public mutating func nextTicket() -> Int {
        issued += 1
        return issued
    }

    /// Whether the response for `ticket` is still the newest word on the subject.
    ///
    /// Returns `false` — and changes nothing — when a newer response has already
    /// been applied, so a caller can branch on this to keep its own copy of the
    /// value consistent with the shared one.
    ///
    /// - Parameter ticket: a ticket from ``nextTicket()`` on *this* guard. A value
    ///   from anywhere else is rejected rather than trusted, so a stray number
    ///   cannot strand the guard above every ticket it will ever issue.
    /// - Parameter kind: see ``ResponseKind``. The two are tested against
    ///   different barriers: a `.read` loses to any newer response, while a
    ///   `.write` loses only to a newer *write*. A read that happened to land
    ///   first is not evidence the write is obsolete — it may well have observed
    ///   the row before that write committed — so letting it bar the write would
    ///   silently discard the change the user actually made. On acceptance a
    ///   `.write` supersedes every request still outstanding, because its value is
    ///   server truth as of a commit those requests may predate.
    public mutating func shouldApply(ticket: Int, from kind: ResponseKind) -> Bool {
        guard ticket <= issued else { return false }
        switch kind {
        case .read:
            guard ticket > applied else { return false }
            applied = ticket
        case .write:
            guard ticket > appliedWrite else { return false }
            appliedWrite = ticket
            applied = issued
        }
        return true
    }

    /// Whether `ticket` has already been outranked — asked *without* recording
    /// anything.
    ///
    /// The read-only counterpart to ``shouldApply(ticket:from:)``, for the one
    /// caller whose "response" is the absence of one: a request that threw. Such a
    /// request still has to be *ranked*, because failing closed is only right for
    /// the newest word on the subject — but it must not consume the barrier the way
    /// an answer does. A failure observed nothing; letting it advance ``applied``
    /// would bar an *earlier* request that is still in flight and about to come back
    /// with real server data, discarding the only observation anyone actually has.
    ///
    /// So a failure asks this, and a response calls ``shouldApply(ticket:from:)``.
    ///
    /// - Parameter ticket: a ticket from ``nextTicket()`` on *this* guard. One this
    ///   guard never issued is reported superseded, matching how
    ///   ``shouldApply(ticket:from:)`` rejects a stray number rather than trusting
    ///   it.
    public func isSuperseded(ticket: Int) -> Bool {
        guard ticket <= issued else { return true }
        return ticket <= applied
    }
}
