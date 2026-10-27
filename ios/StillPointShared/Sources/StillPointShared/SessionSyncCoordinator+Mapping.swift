import Foundation

/// Pure conversions between the queued request, the upload payloads and the
/// session the caller gets back. None of these touch the queue or the network.
extension SessionSyncCoordinator {
    /// Time-in-session marker of the end-of-sit note. The server keeps at most
    /// one per sit and replaces it rather than storing a second one.
    static let endNoteTimeInSession = -1

    /// The caller's request, stamped with the client id it is queued under.
    static func requestWithClientId(
        _ request: CreateSessionRequest,
        clientSessionId: UUID
    ) -> CreateSessionRequest {
        CreateSessionRequest(
            dayNumber: request.dayNumber,
            sessionType: request.sessionType,
            duration: request.duration,
            bonusSeconds: request.bonusSeconds,
            completed: request.completed,
            actualTime: request.actualTime,
            clearPercent: request.clearPercent,
            thoughtCount: request.thoughtCount,
            mindStateLog: request.mindStateLog,
            attentionLog: request.attentionLog,
            sessionDate: request.sessionDate,
            breathCount: request.breathCount,
            focusCategory: request.focusCategory,
            track: request.track,
            clientSessionId: clientSessionId,
            ambientSoundSummary: request.ambientSoundSummary,
            combined: request.combined
        )
    }

    static func provisionalSessionDTO(
        from request: CreateSessionRequest,
        clientSessionId: UUID
    ) -> SessionDTO {
        sessionDTO(from: request, id: clientSessionId.uuidString)
    }

    static func sessionDTO(from request: CreateSessionRequest, id: String) -> SessionDTO {
        SessionDTO(
            id: id,
            dayNumber: request.dayNumber,
            sessionType: request.sessionType,
            duration: request.duration,
            bonusSeconds: request.bonusSeconds == 0 ? nil : request.bonusSeconds,
            completed: request.completed,
            actualTime: request.actualTime,
            clearPercent: request.clearPercent,
            thoughtCount: request.thoughtCount,
            mindStateLog: request.mindStateLog,
            attentionLog: request.attentionLog,
            sessionDate: request.sessionDate,
            createdAt: nil,
            buddySessionId: nil,
            breathCount: request.breathCount,
            focusCategory: request.focusCategory,
            track: request.track,
            ambientSoundSummary: request.ambientSoundSummary,
            combined: request.combined
        )
    }

    /// The thoughts batch for a sit already created on the server.
    static func thoughtsBatch(
        for entry: PendingSessionEntry,
        serverSessionId: String,
        clearCompletionNote: Bool
    ) -> BatchThoughtsRequest {
        BatchThoughtsRequest(
            sessionId: serverSessionId,
            dayNumber: entry.request.dayNumber,
            thoughts: entry.thoughts.map {
                BatchThoughtsRequest.ThoughtInput(
                    timeInSession: $0.timeInSession,
                    text: $0.text,
                    clientThoughtId: $0.clientThoughtId
                )
            },
            clearCompletionNote: clearCompletionNote
        )
    }

    /// #971: an id for each in-session thought, given before the entry is first
    /// saved, so every upload of it sends the same one. A batch the server stored
    /// but whose response was lost (a dropped connection, the app suspended
    /// mid-request) is then not stored twice when it is sent again (#948). The
    /// end note gets none: the server replaces it instead. Lowercased, like web's
    /// `crypto.randomUUID()`.
    static func withClientThoughtIds(_ thoughts: [PendingSessionThought]) -> [PendingSessionThought] {
        thoughts.map { thought in
            guard thought.timeInSession != endNoteTimeInSession, thought.clientThoughtId == nil else {
                return thought
            }
            return PendingSessionThought(
                timeInSession: thought.timeInSession,
                text: thought.text,
                clientThoughtId: UUID().uuidString.lowercased()
            )
        }
    }

    /// #971: whether a thought the batch sent is this queued one. A thought with
    /// an id is matched by it. One queued before ids existed, and the end note,
    /// are matched by time and text, as before.
    static func isSameThought(_ sent: PendingSessionThought, _ queued: PendingSessionThought) -> Bool {
        if sent.clientThoughtId != nil || queued.clientThoughtId != nil {
            return sent.clientThoughtId == queued.clientThoughtId
        }
        return sent.timeInSession == queued.timeInSession && sent.text == queued.text
    }

    /// #983: whether an upload failure is the server turning this sit down for
    /// good, as web decides since #978 (`uploadFailure` and `rejectsTheSit`). A
    /// 5xx, a 408 or a 429 is worth retrying. A 401 means the sign-in lapsed and a
    /// 403 comes from in front of the routes; a later flush can get past both.
    /// Any other 4xx (a validation 400, the 404 for a session that is gone, …)
    /// would be the same every time. A network failure, or an `APIError` with
    /// status 0, never parks.
    static func rejectsTheSit(_ error: Error) -> Bool {
        guard let apiError = error as? APIError else { return false }
        switch apiError.status {
        case 401, 403, 408, 429:
            return false
        case 400..<500:
            return true
        default:
            return false
        }
    }
}
