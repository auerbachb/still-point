import Foundation

/// #759: tells a request that was *cancelled* apart from one that genuinely failed.
///
/// Both land in the same `catch`, and they mean opposite things. A failure is an
/// absent answer about state we may still be showing, so failing closed — dropping
/// the claim rather than leaving a stale one on screen — is right. A cancellation
/// answered nothing and was replaced: either something newer is already in flight,
/// or the session it belonged to has ended. Reading it as a failure lets a
/// torn-down request repaint, and persist, state its own replacement is moments
/// from correcting.
///
/// Two signals, because Swift concurrency surfaces cancellation in more than one
/// shape. `Task.checkCancellation()` and friends throw `CancellationError`, while
/// `URLSession`'s async methods cancel the underlying task, which completes with
/// `URLError(.cancelled)` — so a request cancelled mid-flight throws the latter,
/// never the former. `taskIsCancelled` covers both whenever the cancellation came
/// from the surrounding task, which is how every cancel in this app is issued
/// (`Task.cancel()` on a retained handle). It is passed in rather than read here
/// so the classifier stays pure and testable off a live task.
public enum RequestCancellation {
    /// `true` when `error` means "this request was called off", not "this request
    /// failed".
    ///
    /// - Parameter error: the error the request threw.
    /// - Parameter taskIsCancelled: `Task.isCancelled`, read by the caller inside
    ///   the task that ran the request.
    public static func isCancellation(_ error: Error, taskIsCancelled: Bool) -> Bool {
        if taskIsCancelled { return true }
        if error is CancellationError { return true }
        if let urlError = error as? URLError, urlError.code == .cancelled { return true }
        return false
    }
}
