/// #1106: the yesterday lookup `refreshTracksDoneToday()` runs ahead of its badge
/// query, held to the identity generation that started it.
///
/// The lookup awaits the server, and a sign-out, a sign-in as someone else, or both
/// can land in that window. Its tickets (`PracticeDayState.beginPreviousDayRead`)
/// only order lookups against each other and against a `reset()`; an automatic
/// sign-out (`applySignedOut`) moves the generation without resetting the practice
/// day, so a late answer would still be accepted there. And everything the refresh
/// does after the lookup — the two rollovers, one of them read off the *stored*
/// widget snapshot, and the credited-day badge query — writes state that belongs to
/// whoever is signed in by then. So the generation is re-read once the lookup
/// settles, and a moved one ends the refresh outright: nothing from the lookup is
/// recorded, and the caller does not go on to roll anything over.
///
/// The rule is the same for an answer as for a failure, since either one would
/// write the previous account's yesterday into the next account's day. A newer
/// account's lookup that failed is therefore never overwritten by an older
/// account's answer landing after it, whichever order the two settle in.
///
/// A *cancelled* lookup is not a failed one (#759): it asked the server nothing, so
/// failing closed on its behalf would record an unknown yesterday its replacement
/// is about to answer. It records nothing and ends the refresh, as the badge
/// query's own failure branch does. A cancelled lookup that came back with an
/// answer anyway is still applied — real server data for the live account, ranked
/// by its ticket — matching the badge query's success path.
///
/// Web parity: `refreshTodayTracks` in `src/lib/useDualTrackFork.ts` re-checks
/// `sessionGeneration` on both its success and its failure branch (#833). Web has
/// no separate yesterday request — it derives yesterday from the one session list —
/// so this is the same rule applied to the request iOS adds.
public enum PreviousDayLookup {
    /// What became of the lookup.
    public enum Outcome: Equatable, Sendable {
        /// Nothing to ask: yesterday is already known to be finished, or it is past
        /// the 6:00 cutoff. No request left.
        case notNeeded

        /// The server answered, and the answer was handed to `applyAnswer`.
        case answered

        /// The request failed, and the failure was handed to `applyFailure`.
        case failed

        /// The request was called off. Nothing was recorded.
        case cancelled

        /// The identity generation moved while the request was in flight. Nothing
        /// was recorded.
        case discarded

        /// Whether the refresh that ran the lookup may go on to its rollovers and
        /// its badge query. Only a lookup that settled for the live account and was
        /// not called off may.
        public var refreshMayContinue: Bool {
            switch self {
            case .notNeeded, .answered, .failed: return true
            case .cancelled, .discarded: return false
            }
        }
    }

    /// Runs one yesterday lookup.
    ///
    /// Main-actor isolated, like the practice-day state it writes, so nothing can
    /// land between the generation check and the write.
    ///
    /// - Parameter generation: the identity generation, captured before the
    ///   refresh's first `await`.
    /// - Parameter liveGeneration: reads the identity generation now. Called once,
    ///   after `fetch` settles.
    /// - Parameter begin: `PracticeDayState.beginPreviousDayRead(now:calendar:)` —
    ///   the ticket to hand back, or `nil` when there is nothing to ask.
    /// - Parameter fetch: the request for yesterday's tracks.
    /// - Parameter isCancellation: whether a thrown error means the request was
    ///   called off (`RequestCancellation.isCancellation`, with `Task.isCancelled`
    ///   read inside the task that ran it).
    /// - Parameter applyAnswer: records the server's answer under its ticket.
    /// - Parameter applyFailure: records a genuine failure under its ticket.
    @MainActor
    public static func run(
        startedAt generation: Int,
        liveGeneration: () -> Int,
        begin: () -> Int?,
        fetch: () async throws -> TracksDoneTodayDTO,
        isCancellation: (Error) -> Bool,
        applyAnswer: (TracksDoneTodayDTO, Int) -> Void,
        applyFailure: (Int) -> Void
    ) async -> Outcome {
        guard let ticket = begin() else { return .notNeeded }
        let result: Result<TracksDoneTodayDTO, Error>
        do {
            result = .success(try await fetch())
        } catch {
            result = .failure(error)
        }
        // Identity first, for both branches: whatever settled describes the account
        // that asked, which may no longer be the one signed in.
        guard liveGeneration() == generation else { return .discarded }
        switch result {
        case let .success(tracks):
            applyAnswer(tracks, ticket)
            return .answered
        case let .failure(error):
            if isCancellation(error) { return .cancelled }
            applyFailure(ticket)
            return .failed
        }
    }
}
