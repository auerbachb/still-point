import SwiftUI
import StillPointShared

struct NotificationSettingsView: View {
    @State private var preferences: NotificationPreferencesDTO?
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var reminderDate = Calendar.current.date(from: DateComponents(hour: 9, minute: 0)) ?? Date()

    var body: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s2) {
            Text("NOTIFICATIONS")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)

            if isLoading {
                ProgressView()
                    .tint(SPColor.green)
                    .frame(maxWidth: .infinity, alignment: .center)
            } else if let preferences {
                Toggle(isOn: pushEnabledBinding(preferences)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Push notifications")
                            .font(SPFont.mono(13))
                            .foregroundStyle(Color(SPColor.fg))
                        Text("Daily reminders and miss-a-day nudges")
                            .font(SPFont.serif(13, weight: .light))
                            .foregroundStyle(Color(SPColor.fg4))
                    }
                }
                .tint(SPColor.green)
                .disabled(isSaving)
                .accessibilityIdentifier("settings.notifications.pushEnabled")

                Toggle(isOn: boolBinding(preferences, keyPath: \.dailyReminderEnabled, patch: { NotificationPreferencesPatch(dailyReminderEnabled: $0) })) {
                    Text("Daily reminder")
                        .font(SPFont.mono(13))
                        .foregroundStyle(Color(SPColor.fg))
                }
                .tint(SPColor.green)
                .disabled(isSaving || !preferences.pushEnabled)
                .accessibilityIdentifier("settings.notifications.dailyReminder")

                Toggle(isOn: boolBinding(preferences, keyPath: \.missADayEnabled, patch: { NotificationPreferencesPatch(missADayEnabled: $0) })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Miss-a-day reminder")
                            .font(SPFont.mono(13))
                            .foregroundStyle(Color(SPColor.fg))
                        Text("After a missed day, suggests a quick 1-min sit")
                            .font(SPFont.serif(13, weight: .light))
                            .foregroundStyle(Color(SPColor.fg4))
                    }
                }
                .tint(SPColor.green)
                .disabled(isSaving || !preferences.pushEnabled)
                .accessibilityIdentifier("settings.notifications.missADay")

                DatePicker(
                    "Reminder time",
                    selection: $reminderDate,
                    displayedComponents: .hourAndMinute
                )
                .font(SPFont.mono(13))
                .foregroundStyle(Color(SPColor.fg))
                .disabled(isSaving || !preferences.pushEnabled)
                .onChange(of: reminderDate) { _, newValue in
                    guard preferences.pushEnabled else { return }
                    let formatted = Self.formatReminderTime(newValue)
                    guard formatted != preferences.reminderTime else { return }
                    Task { await savePatch(NotificationPreferencesPatch(reminderTime: formatted)) }
                }
                .accessibilityIdentifier("settings.notifications.reminderTime")
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(SPFont.mono(11))
                    .foregroundStyle(SPColor.dangerMuted)
            }
        }
        .padding(SPSpacing.s3)
        .background(SPColor.surface1)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(SPColor.border1)
        )
        .task {
            await loadPreferences()
        }
    }

    private func loadPreferences() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let loaded = try await APIClient.shared.getNotificationPreferences()
            preferences = loaded
            reminderDate = Self.date(fromReminderTime: loaded.reminderTime) ?? reminderDate
            if loaded.pushEnabled {
                PushNotificationCoordinator.shared.requestAuthorizationAndRegister()
            }
        } catch {
            errorMessage = "Could not load notification settings."
        }
    }

    private func pushEnabledBinding(_ prefs: NotificationPreferencesDTO) -> Binding<Bool> {
        Binding(
            get: { preferences?.pushEnabled ?? prefs.pushEnabled },
            set: { newValue in
                Task {
                    if newValue {
                        PushNotificationCoordinator.shared.requestAuthorizationAndRegister()
                    }
                    await savePatch(NotificationPreferencesPatch(
                        pushEnabled: newValue,
                        timezone: TimeZone.current.identifier
                    ))
                }
            }
        )
    }

    private func boolBinding(
        _ prefs: NotificationPreferencesDTO,
        keyPath: KeyPath<NotificationPreferencesDTO, Bool>,
        patch: @escaping (Bool) -> NotificationPreferencesPatch
    ) -> Binding<Bool> {
        Binding(
            get: { preferences?[keyPath: keyPath] ?? prefs[keyPath: keyPath] },
            set: { newValue in
                Task { await savePatch(patch(newValue)) }
            }
        )
    }

    @MainActor
    private func savePatch(_ patch: NotificationPreferencesPatch) async {
        guard !isSaving else { return }
        isSaving = true
        errorMessage = nil
        let previous = preferences
        defer { isSaving = false }
        do {
            let updated = try await APIClient.shared.updateNotificationPreferences(patch: patch)
            preferences = updated
            reminderDate = Self.date(fromReminderTime: updated.reminderTime) ?? reminderDate
        } catch {
            preferences = previous
            errorMessage = "Could not save notification settings."
        }
    }

    private static func formatReminderTime(_ date: Date) -> String {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        let hour = components.hour ?? 9
        let minute = components.minute ?? 0
        return String(format: "%02d:%02d", hour, minute)
    }

    private static func date(fromReminderTime value: String) -> Date? {
        let parts = value.split(separator: ":")
        guard parts.count == 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]) else { return nil }
        return Calendar.current.date(from: DateComponents(hour: hour, minute: minute))
    }
}
