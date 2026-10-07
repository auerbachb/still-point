import Foundation

/// #756 — whether a failed `POST /api/buddy/sessions/join` used up the invite.
///
/// A pending buddy invite used to be cleared before the join returned. Any failure
/// that never reached a verdict on the invite — no network, a 401, a 5xx, a body
/// we could not decode — then left the user with nothing to retry except the
/// original link. This classifier is the decision the view model applies: only an
/// invite-specific rejection spends the token.
///
/// The join route (`src/app/api/buddy/sessions/join/route.ts`) uses `400` for a
/// missing token, `403` when the guest is not friends with the host, `404` when
/// the session does not exist, and `409` when it is gone or already started.
/// Those four are authoritative. `401` is `requireAuth` rejecting the session,
/// not the invite. Transport failures, `5xx`, and decode errors say nothing about
/// the token.
///
/// The asymmetry matches `OfflineAuth`: re-arming a dead invite costs one later
/// retry; consuming a live one loses it permanently. Only an invite-specific
/// rejection gets to be destructive. The route sends no machine-readable `code`
/// on these failures, so the status is the whole signal.
public enum BuddyInviteJoinFailure {

    public enum Outcome: Sendable, Equatable {
        /// The server rejected this invite. Spending the token is correct.
        case authoritative
        /// The attempt never judged the invite. Keep the token for a later retry.
        case transient
    }

    /// Statuses that mean this invite cannot be joined, from the join route.
    private static let authoritativeStatuses: Set<Int> = [400, 403, 404, 409]

    public static func classify(_ error: Error) -> Outcome {
        guard let apiError = error as? APIError else { return .transient }
        return authoritativeStatuses.contains(apiError.status) ? .authoritative : .transient
    }
}
