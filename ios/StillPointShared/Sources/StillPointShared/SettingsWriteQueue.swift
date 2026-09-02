/// Runs settings mutations — and the whole-account reads that race them — one at a
/// time, in the order the user made them (#697).
///
/// Issue #697 offers two ways to stop a slower save from reverting a newer one:
/// serialize the writes, or tag each request and reject a response older than the
/// latest applied mutation. This is the first. Tagging orders *responses* while
/// leaving the requests to overlap, which keeps the local copy able to contradict a
/// save the server took — every repair for that (holds on the confirmed value,
/// reconciling reads, release barriers) is machinery this does not need.
///
/// Each enqueued operation owns the whole round trip: it starts only after the
/// previous one has finished applying its response, so the server commits the
/// mutations in the order they were enqueued and each response describes the account
/// *after* every earlier mutation committed. Responses are therefore adopted in
/// order, and complete, by construction rather than by inspection.
///
/// **Whole-account reads belong here too.** A `me()` read that overlaps a write is
/// the same inversion wearing the other hat, and tickets alone cannot settle it: when
/// a write's request left *first*, nothing in the ticket order says whether it
/// committed before or after the read's snapshot, so ``StaleResponseGuard`` has to
/// resolve the tie in the write's favour and adopt its whole `UserDTO` — discarding
/// the server-derived fields the read existed to refresh. Enqueuing the read removes
/// the tie rather than deciding it: the read starts only once every earlier write has
/// applied, so its response is the newest word by construction, and the guard's
/// read/write asymmetry becomes belt-and-braces rather than load-bearing.
///
/// What stays outside is a *partial* read — one that fetches something other than the
/// account — since it cannot contradict a settings write in the first place.
///
/// Enqueue at the moment the user acts, and put every `await` the mutation needs —
/// including a permission prompt — inside the operation. That way the queue records
/// the order the user expressed their intent in rather than the order the requests
/// happened to be scheduled in, which is the inversion #697 exists to stop.
///
/// ```swift
/// settingsWrites.enqueue {
///     guard await promptForCameraAccess() else { return }
///     let updated = try? await api.updateSettings(attentionTrackingEnabled: true)
///     …
/// }
/// ```
///
/// Main-actor isolated on purpose. Every call site is already on the main actor, so
/// ``enqueue(_:)`` is reached without an `await` and two calls cannot be reordered in
/// the gap before one of them takes its place in line — which an `actor` would allow,
/// and which would defeat the whole point.
@MainActor
public final class SettingsWriteQueue {
    /// The most recently enqueued operation, or `nil` before the first one. Each new
    /// operation waits on this and then becomes it, so the chain is the queue.
    private var tail: Task<Void, Never>?

    public init() {}

    /// Runs `operation` once every operation already enqueued has finished.
    ///
    /// Returns immediately: the caller keeps its place in line without blocking the
    /// main actor, so a toggle stays responsive while its save waits its turn.
    ///
    /// - Returns: the operation's task, carrying whatever the operation returned, for
    ///   a caller that needs to await its own turn or act on its result. Discardable —
    ///   most callers report progress through their own state instead.
    @discardableResult
    public func enqueue<T: Sendable>(_ operation: @escaping @Sendable @MainActor () async -> T) -> Task<T, Never> {
        let predecessor = tail
        let task = Task { @MainActor in
            // A cancelled or already-finished predecessor returns here at once, so a
            // write that failed cannot strand the ones behind it.
            await predecessor?.value
            return await operation()
        }
        // The chain is kept as `Task<Void, Never>` so operations of different result
        // types can queue behind one another; waiting on this wrapper is waiting on
        // `task` itself, since that is all the wrapper does.
        //
        // Assigned before returning to the caller, and nothing above can suspend, so
        // the next `enqueue` on this main-actor turn already sees this operation as
        // the one to wait for.
        tail = Task { @MainActor in _ = await task.value }
        return task
    }
}
