import Foundation

/// App Group identifier shared with the main app, monitor extension, and widget.
public enum WidgetAppGroup {
    public static let id = "group.com.brettonauerbach.stillpoint"
    public static let dataKey = "widget.habitData.v1"
}

/// Lightweight snapshot the home-screen widget reads from shared `UserDefaults`.
public struct WidgetData: Codable, Sendable, Equatable {
    public var isLoggedIn: Bool
    public var userId: String?
    public var currentDay: Int
    public var secondTrackDay: Int
    public var dualTrackEnabled: Bool
    /// #708: whether the long (primary) session is morning or evening. The short
    /// track is the opposite. Legacy snapshots decode as `.am`. Does not change
    /// which sits count — a row checks off by track, not by the clock.
    public var longSessionPeriod: SessionPeriod
    /// #238: miss-a-day recovery ramp for the primary track timer readout.
    public var recoveryTargetDay: Int?
    public var recoveryCurrentStep: Int?
    public var recoveryTotalSteps: Int?
    public var primaryDoneToday: Bool
    public var secondDoneToday: Bool
    /// True when any counted **Track One** practice (primary standard, quick, or
    /// breath) was completed today. Drives the Track One weekday row. Legacy
    /// snapshots without this field decode using `primaryDoneToday` (#589).
    ///
    /// Track Two's equivalent is `secondDoneToday`; day continuity uses the union
    /// of both (see `isDayKeptToday(at:)`).
    public var practiceDoneToday: Bool
    /// Streak the widget renders. Always derived from the completion history the
    /// rows are drawn from (`completedDates` ∪ `secondCompletedDates`, plus the
    /// extensions below) by `WidgetDataStore.reconciledStreak` — never
    /// accumulated from snapshot-to-snapshot flag transitions (#671), so it can
    /// never contradict the weekday row(s) rendered beside it.
    public var streak: Int
    /// #84 follow-up: ISO local-day strings (`yyyy-MM-dd`) within the trailing
    /// 7-day window on which **Track One** practice was completed. Drives the
    /// Duolingo-style weekday checkmark row. Decoded permissively so snapshots
    /// written before this field shipped (build 15) still load.
    public var completedDates: [String]
    /// #684: the same trailing 7-day window for **Track Two** (second-track
    /// standard sits), rendered as its own row when `dualTrackEnabled` is true.
    ///
    /// Deliberately **not** back-filled: days practised before the user switched
    /// to a two-a-day schedule carry no second-track sit, so they render on the
    /// Track One row only. Legacy snapshots decode this as empty.
    public var secondCompletedDates: [String]
    /// #679: ISO local-day strings in the trailing 7-day window carrying a
    /// completed **standard** sit — on *either* track. This is the population the
    /// server counts (`calculateSessionStats`), so it is the only set allowed to
    /// extend `serverStreak`: see `sessionCountsForServerStreak(_:)` for the
    /// policy and `reconciledStreak` for the arithmetic.
    ///
    /// Deliberately not derivable from the two row sets: `completedDates` also
    /// holds quick and breath days and excludes second-track standard sits, and
    /// `secondCompletedDates` holds only the latter, so neither their union nor
    /// their difference is the standard-only day set. Never rendered — the rows
    /// stay practice-based (#589/#684). Legacy snapshots decode this as empty,
    /// which simply means "no day may extend the server total".
    public var standardDates: [String]
    /// #671: server-computed `stats.streak` from `/api/sessions`, the only source
    /// that knows about days older than the trailing-7 window the rows render.
    /// Used solely to *extend* a run the rows already corroborate — never to
    /// contradict them. Nil when no authoritative fetch has landed yet.
    public var serverStreak: Int?
    /// #671: the ISO local day `serverStreak` counts through (the most recent
    /// completed standard sit at fetch time). Anchors the server total onto the
    /// row so later days can extend it without a second fetch.
    public var serverStreakDate: String?
    public var lastUpdated: Date
    /// True only for a blob persisted *before* #671 shipped: one whose
    /// `completedDates` and `serverStreak` keys are both absent, so it records a
    /// `streak` with no evidence behind it. Distinguishes **unknown** history
    /// ("this writer never stored any") from **known-empty** history ("this
    /// writer stored history and it is empty" — a genuine lapse). Both decode to
    /// `completedDates == []`, so `isEmpty` alone cannot tell them apart, and
    /// conflating them either zeroes every upgrading user's streak or lets a
    /// real lapse keep a stale one.
    ///
    /// Provenance, not content: set only by `init(from:)`, absent from
    /// `CodingKeys` so it is never written back, and always `false` for a
    /// snapshot this version constructs — including every `makeSnapshot` result.
    /// A legacy blob therefore self-heals to `false` the first time the app
    /// writes real history.
    public private(set) var historyIsUnknown: Bool = false
    /// #678: how many times the shared snapshot has been written, stamped by
    /// `WidgetDataStore` at save time (never by `makeSnapshot`). A writer that
    /// must suspend — the `/api/sessions` backfill — records this before its
    /// `await` and hands it back to `save(_:ifWriteGeneration:)`, which can then
    /// tell "nothing moved" from "a fresher snapshot landed while I was away"
    /// and merge instead of overwrite.
    ///
    /// Store-owned provenance, like `historyIsUnknown`: absent from the public
    /// initializer so callers cannot forge one, and `0` for any snapshot that
    /// has not been through `save`.
    public internal(set) var writeGeneration: Int = 0

    public init(
        isLoggedIn: Bool,
        userId: String?,
        currentDay: Int,
        secondTrackDay: Int,
        dualTrackEnabled: Bool,
        longSessionPeriod: SessionPeriod = .am,
        recoveryTargetDay: Int? = nil,
        recoveryCurrentStep: Int? = nil,
        recoveryTotalSteps: Int? = nil,
        primaryDoneToday: Bool,
        secondDoneToday: Bool,
        practiceDoneToday: Bool = false,
        streak: Int,
        completedDates: [String] = [],
        secondCompletedDates: [String] = [],
        standardDates: [String] = [],
        serverStreak: Int? = nil,
        serverStreakDate: String? = nil,
        lastUpdated: Date
    ) {
        self.isLoggedIn = isLoggedIn
        self.userId = userId
        self.currentDay = currentDay
        self.secondTrackDay = secondTrackDay
        self.dualTrackEnabled = dualTrackEnabled
        self.longSessionPeriod = longSessionPeriod
        self.recoveryTargetDay = recoveryTargetDay
        self.recoveryCurrentStep = recoveryCurrentStep
        self.recoveryTotalSteps = recoveryTotalSteps
        self.primaryDoneToday = primaryDoneToday
        self.secondDoneToday = secondDoneToday
        self.practiceDoneToday = practiceDoneToday
        self.streak = streak
        self.completedDates = completedDates
        self.secondCompletedDates = secondCompletedDates
        self.standardDates = standardDates
        self.serverStreak = serverStreak
        self.serverStreakDate = serverStreakDate
        self.lastUpdated = lastUpdated
    }

    private enum CodingKeys: String, CodingKey {
        case isLoggedIn, userId, currentDay, secondTrackDay, dualTrackEnabled, longSessionPeriod
        case recoveryTargetDay, recoveryCurrentStep, recoveryTotalSteps
        case primaryDoneToday, secondDoneToday, practiceDoneToday, streak
        case completedDates, secondCompletedDates, standardDates
        case serverStreak, serverStreakDate, lastUpdated
        case writeGeneration
    }

    /// Custom decoder so blobs persisted before `completedDates` /
    /// `secondCompletedDates` existed still load (the synthesized decoder would
    /// throw on the missing key).
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        isLoggedIn = try c.decode(Bool.self, forKey: .isLoggedIn)
        userId = try c.decodeIfPresent(String.self, forKey: .userId)
        currentDay = try c.decode(Int.self, forKey: .currentDay)
        secondTrackDay = try c.decode(Int.self, forKey: .secondTrackDay)
        dualTrackEnabled = try c.decode(Bool.self, forKey: .dualTrackEnabled)
        if let raw = try c.decodeIfPresent(String.self, forKey: .longSessionPeriod),
           let period = SessionPeriod(rawValue: raw) {
            longSessionPeriod = period
        } else {
            longSessionPeriod = .am
        }
        recoveryTargetDay = try c.decodeIfPresent(Int.self, forKey: .recoveryTargetDay)
        recoveryCurrentStep = try c.decodeIfPresent(Int.self, forKey: .recoveryCurrentStep)
        recoveryTotalSteps = try c.decodeIfPresent(Int.self, forKey: .recoveryTotalSteps)
        primaryDoneToday = try c.decode(Bool.self, forKey: .primaryDoneToday)
        secondDoneToday = try c.decode(Bool.self, forKey: .secondDoneToday)
        practiceDoneToday = try c.decodeIfPresent(Bool.self, forKey: .practiceDoneToday)
            ?? primaryDoneToday
        streak = try c.decode(Int.self, forKey: .streak)
        completedDates = try c.decodeIfPresent([String].self, forKey: .completedDates) ?? []
        // Pre-#684 snapshots have no Track Two history: their `completedDates`
        // stay Track One and Track Two starts empty (no back-fill, no migration).
        secondCompletedDates = try c.decodeIfPresent([String].self, forKey: .secondCompletedDates) ?? []
        // Pre-#679 snapshots recorded no session type alongside their day strings,
        // so there is nothing to migrate from: an empty set means no day may
        // extend `serverStreak` until the next authoritative fetch repopulates it.
        // That errs toward the app/web number, which is the direction #679 asks
        // for — the row run below is still the floor, so nothing under-reports
        // what the widget itself draws.
        standardDates = try c.decodeIfPresent([String].self, forKey: .standardDates) ?? []
        serverStreak = try c.decodeIfPresent(Int.self, forKey: .serverStreak)
        serverStreakDate = try c.decodeIfPresent(String.self, forKey: .serverStreakDate)
        lastUpdated = try c.decode(Date.self, forKey: .lastUpdated)
        // #678: a blob written before write generations existed reads as 0, the
        // same as "never saved". That is the safe direction — the first
        // generation-checked save after an upgrade sees a mismatch only if
        // something really did write in between.
        writeGeneration = try c.decodeIfPresent(Int.self, forKey: .writeGeneration) ?? 0
        // Key *absence* — not an empty value — is what marks a pre-#671 writer.
        // `contains` is the only signal that survives `decodeIfPresent`'s
        // `?? []`, so it is captured here rather than inferred later. Any history
        // key at all, either track's, means the writer recorded history: a #684
        // snapshot always writes both, so it is never mistaken for a legacy blob.
        historyIsUnknown = !c.contains(.completedDates)
            && !c.contains(.secondCompletedDates)
            && !c.contains(.standardDates)
            && !c.contains(.serverStreak)
    }

    public static let loggedOut = WidgetData(
        isLoggedIn: false,
        userId: nil,
        currentDay: 1,
        secondTrackDay: 1,
        dualTrackEnabled: false,
        primaryDoneToday: false,
        secondDoneToday: false,
        practiceDoneToday: false,
        streak: 0,
        completedDates: [],
        secondCompletedDates: [],
        standardDates: [],
        lastUpdated: .distantPast
    )

    /// Primary-track duration in seconds for the widget readout.
    public var primaryDurationSeconds: Int {
        DurationRecovery.sessionDurationForUser(
            sessionType: .standard,
            currentDay: max(currentDay, 1),
            recovery: DurationRecovery.RecoveryFields(
                recoveryTargetDay: recoveryTargetDay,
                recoveryCurrentStep: recoveryCurrentStep,
                recoveryTotalSteps: recoveryTotalSteps
            )
        )
    }

    /// Local days in the trailing window on which **either** track recorded a
    /// completed sit — the set day continuity and the streak walk over (#684),
    /// and therefore the evidence the displayed streak must agree with (#671).
    public var completedDayUnion: Set<String> {
        Set(completedDates).union(secondCompletedDates)
    }

    /// Flag-only "at least one track finished a sit" for the day this snapshot
    /// was written. Freshness-checked variants: `isDayKeptToday(at:)`.
    public var anyTrackDoneToday: Bool {
        practiceDoneToday || secondDoneToday
    }
}

public enum WidgetDataStore {
    /// Length of the trailing history window the widget keeps and renders.
    public static let historyWindowDays = 7

    public static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: WidgetAppGroup.id)
    }

    public static func load() -> WidgetData? {
        guard let defaults = sharedDefaults,
              let data = defaults.data(forKey: WidgetAppGroup.dataKey) else {
            return nil
        }
        return try? JSONDecoder().decode(WidgetData.self, from: data)
    }

    /// Unconditional write, for callers that hold no stale view of the snapshot
    /// (every synchronous `syncWidgetData()` path). The stored write generation
    /// still advances, so a writer that *is* suspended across an `await` can
    /// detect that this landed underneath it — see
    /// `save(_:ifWriteGeneration:now:)` (#678).
    @discardableResult
    public static func save(_ snapshot: WidgetData) -> Bool {
        persist(stamped(snapshot, after: currentWriteGeneration()))
    }

    /// Encode and write, leaving `snapshot.writeGeneration` exactly as given.
    static func persist(_ snapshot: WidgetData) -> Bool {
        guard let data = try? JSONEncoder().encode(snapshot),
              let defaults = sharedDefaults else {
            return false
        }
        defaults.set(data, forKey: WidgetAppGroup.dataKey)
        return true
    }

    public static func clear() {
        sharedDefaults?.removeObject(forKey: WidgetAppGroup.dataKey)
    }

    /// Why the app is about to render a signed-out widget snapshot.
    public enum SignedOutCause: Sendable, Equatable {
        /// The user signed out, or the server authoritatively reported no session.
        case signedOut
        /// Credentials were rejected (HTTP 401) — the session is genuinely over.
        case unauthorized
        /// The server answered, but with an error that says nothing about auth.
        case serverError
        /// The server could not be reached at all (offline cold start).
        case unreachable
    }

    /// #671 (symptom 2 — "the week resets"): only an authoritative sign-out may
    /// wipe the shared snapshot. A launch that simply can't reach the server is
    /// not a sign-out, and clearing there destroys the widget's only copy of the
    /// week: the rows go blank, and once history is refetched the streak has
    /// already restarted from 1 because there is no longer a prior snapshot to
    /// build on. Keeping the blob costs nothing — `normalizedForDisplay` bounds
    /// and re-derives it on every read.
    public static func shouldClearStoredSnapshot(on cause: SignedOutCause) -> Bool {
        switch cause {
        case .signedOut, .unauthorized:
            return true
        case .serverError, .unreachable:
            return false
        }
    }
}
