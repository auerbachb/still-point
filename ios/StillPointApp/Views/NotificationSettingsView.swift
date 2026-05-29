import SwiftUI
import StillPointShared
import UserNotifications

struct NotificationSettingsView: View {
    @State private var preferences: NotificationPreferencesDTO?
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var loadError: String?
    @State private var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @State private var preferredTimeDate = Calendar.current.date(from: DateComponents(hour: 9, minute: 0)) ?? Date()
    @State private var quietHoursEnabled = false
    @State private var quietStartDate = Calendar.current.date(from: DateComponents(hour: 22, minute: 0)) ?? Date()
    @State private var quietEndDate = Calendar.current.date(from: DateComponents(hour: 7, minute: 0)) ?? Date()

    private let frequencyOptions: [(id: String, label: String)] = [
        ("daily", "Daily"),
        ("every_other_day", "Every other day"),
        ("weekly", "Weekly"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: SPSpacing.s3) {
            if let loadError {
                Text(loadError)
                    .font(SPFont.mono(11))
                    .foregroundStyle(SPColor.dangerMuted)
            }

            if isLoading {
                ProgressView()
                    .tint(SPColor.green)
            } else if let prefs = preferences {
                masterToggleSection(prefs: prefs)
                if prefs.enabled {
                    dailyReminderSection(prefs: prefs)
                    preferredTimeSection(prefs: prefs)
                    frequencySection(prefs: prefs)
                    quietHoursSection(prefs: prefs)
                }
                if authorizationStatus == .denied {
                    openSystemSettingsButton
                }
            }
        }
        .task {
            await refreshAuthorizationStatus()
            await loadPreferences()
        }
    }

    @ViewBuilder
    private func masterToggleSection(prefs: NotificationPreferencesDTO) -> some View {
        Toggle(isOn: masterToggleBinding(prefs: prefs)) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Enable notifications")
                    .font(SPFont.mono(13))
                    .foregroundStyle(Color(SPColor.fg))
                Text("Daily reminders and other alerts")
                    .font(SPFont.serif(13, weight: .light))
                    .foregroundStyle(Color(SPColor.fg4))
            }
        }
        .tint(SPColor.green)
        .disabled(isSaving)
        .accessibilityIdentifier("notifications.masterToggle")
    }

    @ViewBuilder
    private func dailyReminderSection(prefs: NotificationPreferencesDTO) -> some View {
        Toggle(isOn: dailyReminderBinding(prefs: prefs)) {
            Text("Daily reminder")
                .font(SPFont.mono(13))
                .foregroundStyle(Color(SPColor.fg))
        }
        .tint(SPColor.green)
        .disabled(isSaving)
        .accessibilityIdentifier("notifications.dailyReminderToggle")
    }

    @ViewBuilder
    private func preferredTimeSection(prefs: NotificationPreferencesDTO) -> some View {
        DatePicker(
            "Reminder time",
            selection: preferredTimeBinding(prefs: prefs),
            displayedComponents: .hourAndMinute
        )
        .font(SPFont.mono(13))
        .foregroundStyle(Color(SPColor.fg))
        .disabled(isSaving || !prefs.dailyReminderEnabled)
        .accessibilityIdentifier("notifications.preferredTimePicker")
    }

    @ViewBuilder
    private func frequencySection(prefs: NotificationPreferencesDTO) -> some View {
        Picker("Frequency", selection: frequencyBinding(prefs: prefs)) {
            ForEach(frequencyOptions, id: \.id) { option in
                Text(option.label).tag(option.id)
            }
        }
        .pickerStyle(.segmented)
        .disabled(isSaving || !prefs.dailyReminderEnabled)
        .accessibilityIdentifier("notifications.frequencyPicker")
    }

    @ViewBuilder
    private func quietHoursSection(prefs: NotificationPreferencesDTO) -> some View {
        Toggle(isOn: quietHoursEnabledBinding(prefs: prefs)) {
            Text("Quiet hours")
                .font(SPFont.mono(13))
                .foregroundStyle(Color(SPColor.fg))
        }
        .tint(SPColor.green)
        .disabled(isSaving)

        if quietHoursEnabled {
            DatePicker("Start", selection: quietStartBinding(prefs: prefs), displayedComponents: .hourAndMinute)
                .font(SPFont.mono(12))
                .foregroundStyle(Color(SPColor.fg3))
            DatePicker("End", selection: quietEndBinding(prefs: prefs), displayedComponents: .hourAndMinute)
                .font(SPFont.mono(12))
                .foregroundStyle(Color(SPColor.fg3))
        }
    }

    private var openSystemSettingsButton: some View {
        Button {
            if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
                UIApplication.shared.open(url)
            }
        } label: {
            Text("Open System Settings")
                .font(SPFont.mono(12, weight: .medium))
                .foregroundStyle(SPColor.greenText)
        }
        .accessibilityIdentifier("notifications.openSystemSettings")
    }

    private func masterToggleBinding(prefs: NotificationPreferencesDTO) -> Binding<Bool> {
        Binding(
            get: { prefs.enabled },
            set: { newValue in
                Task {
                    if newValue {
                        await PushNotificationCoordinator.shared.requestAuthorizationAndRegister()
                        await refreshAuthorizationStatus()
                    }
                    await save(UpdateNotificationPreferencesRequest(enabled: newValue))
                }
            }
        )
    }

    private func dailyReminderBinding(prefs: NotificationPreferencesDTO) -> Binding<Bool> {
        Binding(
            get: { prefs.dailyReminderEnabled },
            set: { newValue in
                Task { await save(UpdateNotificationPreferencesRequest(dailyReminderEnabled: newValue)) }
            }
        )
    }

    private func preferredTimeBinding(prefs: NotificationPreferencesDTO) -> Binding<Date> {
        Binding(
            get: { preferredTimeDate },
            set: { newValue in
                preferredTimeDate = newValue
                Task { await save(UpdateNotificationPreferencesRequest(preferredTime: formatHHMM(newValue))) }
            }
        )
    }

    private func frequencyBinding(prefs: NotificationPreferencesDTO) -> Binding<String> {
        Binding(
            get: { prefs.frequency },
            set: { newValue in
                Task { await save(UpdateNotificationPreferencesRequest(frequency: newValue)) }
            }
        )
    }

    private func quietHoursEnabledBinding(prefs: NotificationPreferencesDTO) -> Binding<Bool> {
        Binding(
            get: { quietHoursEnabled },
            set: { enabled in
                quietHoursEnabled = enabled
                Task {
                    if enabled {
                        await save(UpdateNotificationPreferencesRequest(
                            quietHoursStart: formatHHMM(quietStartDate),
                            quietHoursEnd: formatHHMM(quietEndDate)
                        ))
                    } else {
                        await save(UpdateNotificationPreferencesRequest(
                            quietHoursStart: "",
                            quietHoursEnd: ""
                        ))
                    }
                }
            }
        )
    }

    private func quietStartBinding(prefs: NotificationPreferencesDTO) -> Binding<Date> {
        Binding(
            get: { quietStartDate },
            set: { newValue in
                quietStartDate = newValue
                guard quietHoursEnabled else { return }
                Task {
                    await save(UpdateNotificationPreferencesRequest(
                        quietHoursStart: formatHHMM(newValue),
                        quietHoursEnd: formatHHMM(quietEndDate)
                    ))
                }
            }
        )
    }

    private func quietEndBinding(prefs: NotificationPreferencesDTO) -> Binding<Date> {
        Binding(
            get: { quietEndDate },
            set: { newValue in
                quietEndDate = newValue
                guard quietHoursEnabled else { return }
                Task {
                    await save(UpdateNotificationPreferencesRequest(
                        quietHoursStart: formatHHMM(quietStartDate),
                        quietHoursEnd: formatHHMM(newValue)
                    ))
                }
            }
        )
    }

    private func loadPreferences() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            let loaded = try await APIClient.shared.getNotificationPreferences()
            preferences = loaded
            preferredTimeDate = dateFromHHMM(loaded.preferredTime) ?? preferredTimeDate
            if let start = loaded.quietHoursStart, let end = loaded.quietHoursEnd {
                quietHoursEnabled = true
                quietStartDate = dateFromHHMM(start) ?? quietStartDate
                quietEndDate = dateFromHHMM(end) ?? quietEndDate
            } else {
                quietHoursEnabled = false
            }
            if loaded.timezone.isEmpty {
                await save(UpdateNotificationPreferencesRequest(timezone: TimeZone.current.identifier))
            }
        } catch {
            loadError = "Could not load notification settings."
        }
    }

    private func save(_ request: UpdateNotificationPreferencesRequest) async {
        isSaving = true
        defer { isSaving = false }
        do {
            let updated = try await APIClient.shared.updateNotificationPreferences(request)
            preferences = updated
        } catch {
            loadError = "Could not save notification settings."
            await loadPreferences()
        }
    }

    private func refreshAuthorizationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus
    }

    private func formatHHMM(_ date: Date) -> String {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        let hour = components.hour ?? 0
        let minute = components.minute ?? 0
        return String(format: "%02d:%02d", hour, minute)
    }

    private func dateFromHHMM(_ value: String) -> Date? {
        let parts = value.split(separator: ":")
        guard parts.count == 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]) else { return nil }
        return Calendar.current.date(from: DateComponents(hour: hour, minute: minute))
    }
}
