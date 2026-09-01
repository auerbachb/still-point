import Foundation
import StillPointShared
import UserNotifications

@MainActor
@Observable
final class NotificationPreferencesViewModel {
    var pushEnabled = false
    var dailyReminderEnabled = false
    var missADayEnabled = false
    var friendRequestNotificationsEnabled = true
    var failureReasonReminderEnabled = false
    /// On by default (#709); the toggle is an opt-out, not an opt-in.
    var suppressDuringSession = true
    var dailyReminderFrequency: DailyReminderFrequency = .daily
    var quietHoursEnabled = false
    var callOptInEnabled = false
    var callPhoneNumber = ""
    var timezoneDisplay = "UTC"

    var isLoading = false
    var isSaving = false
    var errorMessage: String?

    /// True when the user enabled push server-side but OS-level notification
    /// permission is denied. Drives the "Open Settings" alert (issue #363).
    var showPushPermissionDeniedAlert = false

    var reminderTime = Calendar.current.date(from: DateComponents(hour: 9, minute: 0)) ?? Date()
    var quietStartTime = Calendar.current.date(from: DateComponents(hour: 22, minute: 0)) ?? Date()
    var quietEndTime = Calendar.current.date(from: DateComponents(hour: 7, minute: 0)) ?? Date()
    var callWindowStartTime = Calendar.current.date(from: DateComponents(hour: 18, minute: 0)) ?? Date()
    var callWindowStopTime = Calendar.current.date(from: DateComponents(hour: 21, minute: 0)) ?? Date()

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let generation = SessionNotificationSuppressionController.preferenceGeneration
            let ticket = SessionNotificationSuppressionController.nextPreferenceRequestTicket()
            let prefs = try await APIClient.shared.getNotificationPreferences()
            apply(prefs, startedAtGeneration: generation, requestTicket: ticket, responseKind: .read)
            await syncTimezoneIfNeeded(prefs)
        } catch {
            errorMessage = "Could not load notification settings."
        }
    }

    func persistPushEnabledChange(wasEnabled: Bool, isEnabled: Bool) async {
        pushEnabled = isEnabled
        var osPermissionDenied = false
        if isEnabled && !wasEnabled {
            // iOS never re-prompts once the user denied notification
            // permission, so requesting authorization again is a silent
            // no-op. Detect the denied state up front and route the user to
            // the system Settings app instead (issue #363).
            let status = await PushNotificationCoordinator.shared.getAuthorizationStatus()
            if status == .denied {
                osPermissionDenied = true
            } else {
                PushNotificationCoordinator.shared.requestAuthorizationAndRegister()
            }
        }
        await persist(patch: NotificationPreferencesPatch(
            pushEnabled: isEnabled,
            tz: TimeZone.current.identifier
        ))
        // Surface the Settings alert only after the server save succeeded.
        // On failure, `persist` reverts the toggle and shows its own error,
        // which the alert's "push is enabled for your account" wording
        // would contradict.
        if osPermissionDenied && errorMessage == nil && pushEnabled {
            showPushPermissionDeniedAlert = true
        }
    }

    func persistDailyReminderEnabled(_ enabled: Bool) async {
        dailyReminderEnabled = enabled
        await persist(patch: NotificationPreferencesPatch(dailyReminderEnabled: enabled))
    }

    func persistMissADayEnabled(_ enabled: Bool) async {
        missADayEnabled = enabled
        await persist(patch: NotificationPreferencesPatch(missADayEnabled: enabled))
    }

    func persistReminderTime() async {
        await persist(patch: NotificationPreferencesPatch(dailyReminderTime: formatHHMM(reminderTime)))
    }

    func persistFrequency() async {
        await persist(patch: NotificationPreferencesPatch(dailyReminderFrequency: dailyReminderFrequency))
    }

    func persistQuietHoursToggle(enabled: Bool) async {
        quietHoursEnabled = enabled
        if enabled {
            await persist(
                patch: NotificationPreferencesPatch(
                    quietHoursStart: .some(formatHHMM(quietStartTime)),
                    quietHoursEnd: .some(formatHHMM(quietEndTime))
                )
            )
        } else {
            await persist(
                patch: NotificationPreferencesPatch(
                    quietHoursStart: .some(nil),
                    quietHoursEnd: .some(nil)
                )
            )
        }
    }

    func persistQuietHoursTimes() async {
        guard quietHoursEnabled else { return }
        await persist(
            patch: NotificationPreferencesPatch(
                quietHoursStart: .some(formatHHMM(quietStartTime)),
                quietHoursEnd: .some(formatHHMM(quietEndTime))
            )
        )
    }

    func persistFriendRequestNotificationsEnabled(_ enabled: Bool) async {
        friendRequestNotificationsEnabled = enabled
        await persist(patch: NotificationPreferencesPatch(friendRequestNotificationsEnabled: enabled))
    }

    func persistSuppressDuringSessionEnabled(_ enabled: Bool) async {
        suppressDuringSession = enabled
        // The cached opt-in (read by willPresent) is updated only in `apply()`
        // after the server confirms the save, so a failed PATCH can't strand the
        // cache out of sync with server truth (#431).
        await persist(patch: NotificationPreferencesPatch(suppressDuringSession: enabled))
    }

    func persistFailureReasonReminderEnabled(_ enabled: Bool) async {
        failureReasonReminderEnabled = enabled
        await persist(patch: NotificationPreferencesPatch(failureReasonReminderEnabled: enabled))
    }

    func persistCallOptInToggle(enabled: Bool) async {
        callOptInEnabled = enabled
        if enabled {
            return
        }
        await persist(patch: NotificationPreferencesPatch(callOptIn: false))
    }

    func persistCallSettingsIfReady() async {
        guard callOptInEnabled else { return }
        let phone = normalizedCallPhoneNumber()
        guard phone.hasPrefix("+"), phone.count >= 8 else { return }
        await persist(
            patch: NotificationPreferencesPatch(
                callOptIn: true,
                callPhoneNumber: .some(phone),
                callWindowStart: .some(formatHHMM(callWindowStartTime)),
                callWindowStop: .some(formatHHMM(callWindowStopTime))
            )
        )
    }

    func persistTimezone(_ tz: String) async {
        timezoneDisplay = tz
        await persist(patch: NotificationPreferencesPatch(tz: tz))
    }

    private func syncTimezoneIfNeeded(_ prefs: NotificationPreferencesDTO) async {
        guard ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] != "1" else { return }
        let deviceTz = TimeZone.current.identifier
        guard prefs.tz != deviceTz else { return }
        await persist(patch: NotificationPreferencesPatch(tz: deviceTz))
    }

    private func persist(patch: NotificationPreferencesPatch) async {
        while isSaving {
            await Task.yield()
        }
        isSaving = true
        errorMessage = nil

        do {
            // Taken after the `isSaving` spin, so the ticket records when this
            // request actually left — a save that waited its turn is newer than
            // the one it queued behind, and newer than any read already in flight.
            let generation = SessionNotificationSuppressionController.preferenceGeneration
            let ticket = SessionNotificationSuppressionController.nextPreferenceRequestTicket()
            let updated = try await APIClient.shared.updateNotificationPreferences(patch)
            isSaving = false
            apply(updated, startedAtGeneration: generation, requestTicket: ticket, responseKind: .write)
        } catch {
            errorMessage = "Could not save notification settings."
            isSaving = false
            await load()
        }
    }

    /// - Parameter generation: `SessionNotificationSuppressionController.preferenceGeneration`
    ///   as it was when the request started. This view model is `@State` on
    ///   `SettingsView`, so its own fields die with the signed-out UI; the
    ///   device-global controller below is the part that outlives an auth
    ///   boundary and so is the part that has to be generation-checked.
    /// - Parameter ticket: `nextPreferenceRequestTicket()` as taken when the
    ///   request started, ordering this response against every other preference
    ///   request in flight.
    /// - Parameter kind: `.read` from `load()`, `.write` from `persist()` — a
    ///   PATCH response is server truth as of its commit, a GET response only
    ///   describes what it happened to observe.
    private func apply(
        _ dto: NotificationPreferencesDTO,
        startedAtGeneration generation: Int,
        requestTicket ticket: Int,
        responseKind kind: StaleResponseGuard.ResponseKind
    ) {
        pushEnabled = dto.pushEnabled
        dailyReminderEnabled = dto.dailyReminderEnabled
        missADayEnabled = dto.missADayEnabled
        friendRequestNotificationsEnabled = dto.friendRequestNotificationsEnabled
        failureReasonReminderEnabled = dto.failureReasonReminderEnabled
        // Keep the cached opt-in (read by willPresent) in sync with the server row
        // — but only while this response is still the newest word on it. `load()`
        // gates on `isLoading` and `persist()` on `isSaving`, so the two overlap
        // freely: a read that left before the user turned "During sessions" off
        // otherwise lands afterwards carrying the pre-toggle `true` and silently
        // re-suppresses the sit the user just un-suppressed (#709).
        //
        // The visible toggle moves only when the cache accepted, so the screen can
        // never disagree with what `willPresent` will actually do. The ticket
        // orders *this* preference specifically; the other fields above are
        // screen-local state that dies with `SettingsView`, so they keep the
        // existing last-response-wins behaviour rather than being dropped
        // wholesale on a preference write that says nothing about them.
        if SessionNotificationSuppressionController.setSuppressPreferenceEnabled(
            dto.suppressDuringSession,
            startedAtGeneration: generation,
            requestTicket: ticket,
            responseKind: kind
        ) {
            suppressDuringSession = dto.suppressDuringSession
        }
        timezoneDisplay = dto.tz
        dailyReminderFrequency = dto.dailyReminderFrequency
        quietHoursEnabled = dto.quietHoursStart != nil && dto.quietHoursEnd != nil
        if let parsed = parseHHMM(dto.dailyReminderTime) {
            reminderTime = parsed
        }
        if let start = dto.quietHoursStart, let parsed = parseHHMM(start) {
            quietStartTime = parsed
        }
        if let end = dto.quietHoursEnd, let parsed = parseHHMM(end) {
            quietEndTime = parsed
        }
        callOptInEnabled = dto.callOptIn
        callPhoneNumber = dto.callPhoneNumber ?? ""
        if let start = dto.callWindowStart, let parsed = parseHHMM(start) {
            callWindowStartTime = parsed
        }
        if let stop = dto.callWindowStop, let parsed = parseHHMM(stop) {
            callWindowStopTime = parsed
        }
    }

    private func normalizedCallPhoneNumber() -> String {
        let trimmed = callPhoneNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        let digits = trimmed.filter(\.isNumber)
        guard !digits.isEmpty else { return trimmed }
        if trimmed.hasPrefix("+") {
            return "+\(digits)"
        }
        if digits.count == 10 {
            return "+1\(digits)"
        }
        return "+\(digits)"
    }

    private func formatHHMM(_ date: Date) -> String {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        let hour = components.hour ?? 0
        let minute = components.minute ?? 0
        return String(format: "%02d:%02d", hour, minute)
    }

    private func parseHHMM(_ value: String) -> Date? {
        let parts = value.split(separator: ":")
        guard parts.count == 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]) else { return nil }
        return Calendar.current.date(from: DateComponents(hour: hour, minute: minute))
    }
}
