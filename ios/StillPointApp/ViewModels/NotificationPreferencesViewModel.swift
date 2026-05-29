import Foundation
import StillPointShared

@MainActor
@Observable
final class NotificationPreferencesViewModel {
    var pushEnabled = false
    var dailyReminderEnabled = false
    var dailyReminderFrequency: DailyReminderFrequency = .daily
    var quietHoursEnabled = false

    var isLoading = false
    var isSaving = false
    var errorMessage: String?

    var reminderTime = Calendar.current.date(from: DateComponents(hour: 9, minute: 0)) ?? Date()
    var quietStartTime = Calendar.current.date(from: DateComponents(hour: 22, minute: 0)) ?? Date()
    var quietEndTime = Calendar.current.date(from: DateComponents(hour: 7, minute: 0)) ?? Date()

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let prefs = try await APIClient.shared.getNotificationPreferences()
            apply(prefs)
            await syncTimezoneIfNeeded(prefs)
        } catch {
            errorMessage = "Could not load notification settings."
        }
    }

    func persistPushEnabledChange(wasEnabled: Bool, isEnabled: Bool) async {
        pushEnabled = isEnabled
        if isEnabled && !wasEnabled {
            PushNotificationCoordinator.shared.requestAuthorizationAndRegister()
        }
        await persist(patch: NotificationPreferencesPatch(
            pushEnabled: isEnabled,
            tz: TimeZone.current.identifier
        ))
    }

    func persistDailyReminderEnabled(_ enabled: Bool) async {
        dailyReminderEnabled = enabled
        await persist(patch: NotificationPreferencesPatch(dailyReminderEnabled: enabled))
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
        defer { isSaving = false }

        do {
            let updated = try await APIClient.shared.updateNotificationPreferences(patch)
            apply(updated)
        } catch {
            errorMessage = "Could not save notification settings."
            await load()
        }
    }

    private func apply(_ dto: NotificationPreferencesDTO) {
        pushEnabled = dto.pushEnabled
        dailyReminderEnabled = dto.dailyReminderEnabled
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
