import SwiftUI
import StillPointShared

struct NotificationsSettingsView: View {
    @Bindable var notificationPrefs: NotificationPreferencesViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SPSpacing.s2) {
                sectionHeader("Push on this device")
                pushToggle

                if notificationPrefs.pushEnabled {
                    sectionHeader("Daily practice reminder")
                    dailyReminderSection

                    sectionHeader("Quiet hours")
                    quietHoursSection

                    sectionHeader("Miss a day")
                    missADayToggle

                    sectionHeader("Friend activity")
                    friendRequestToggle
                }

                if let error = notificationPrefs.errorMessage {
                    Text(error)
                        .font(SPFont.mono(11))
                        .foregroundStyle(SPColor.dangerMuted)
                }
            }
            .padding(SPSpacing.s3)
        }
        .stillPointBackground()
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await notificationPrefs.load()
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(SPFont.mono(11, weight: .medium))
            .foregroundStyle(Color(SPColor.fg4))
            .tracking(2)
            .padding(.top, SPSpacing.s2)
    }

    private var pushToggle: some View {
        Toggle(isOn: Binding(
            get: { notificationPrefs.pushEnabled },
            set: { newValue in
                let was = notificationPrefs.pushEnabled
                Task {
                    await notificationPrefs.persistPushEnabledChange(wasEnabled: was, isEnabled: newValue)
                }
            }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Push notifications")
                    .font(SPFont.mono(13))
                    .foregroundStyle(Color(SPColor.fg))
                Text("Receive reminders and updates on this device")
                    .font(SPFont.serif(13, weight: .light))
                    .foregroundStyle(Color(SPColor.fg4))
            }
        }
        .tint(SPColor.green)
        .disabled(notificationPrefs.isSaving)
        .accessibilityIdentifier("notifications.pushToggle")
    }

    @ViewBuilder
    private var dailyReminderSection: some View {
        Toggle(isOn: Binding(
            get: { notificationPrefs.dailyReminderEnabled },
            set: { newValue in
                Task { await notificationPrefs.persistDailyReminderEnabled(newValue) }
            }
        )) {
            Text("Daily practice reminder")
                .font(SPFont.mono(13))
                .foregroundStyle(Color(SPColor.fg))
        }
        .tint(SPColor.green)
        .disabled(notificationPrefs.isSaving)
        .accessibilityIdentifier("notifications.dailyReminderToggle")

        if notificationPrefs.dailyReminderEnabled {
            DatePicker(
                "Reminder time",
                selection: Binding(
                    get: { notificationPrefs.reminderTime },
                    set: { notificationPrefs.reminderTime = $0 }
                ),
                displayedComponents: .hourAndMinute
            )
            .font(SPFont.mono(13))
            .disabled(notificationPrefs.isSaving)
            .onChange(of: notificationPrefs.reminderTime) { _, _ in
                Task { await notificationPrefs.persistReminderTime() }
            }
            .accessibilityIdentifier("notifications.dailyReminderTimePicker")

            Picker("Frequency", selection: Binding(
                get: { notificationPrefs.dailyReminderFrequency },
                set: { newValue in
                    notificationPrefs.dailyReminderFrequency = newValue
                    Task { await notificationPrefs.persistFrequency() }
                }
            )) {
                ForEach(DailyReminderFrequency.allCases, id: \.self) { freq in
                    Text(freq.label).tag(freq)
                }
            }
            .font(SPFont.mono(13))
            .disabled(notificationPrefs.isSaving)
            .accessibilityIdentifier("notifications.dailyReminderFrequencyPicker")

            HStack {
                Text("Timezone")
                    .font(SPFont.mono(13))
                    .foregroundStyle(Color(SPColor.fg3))
                Spacer()
                Text(notificationPrefs.timezoneDisplay)
                    .font(SPFont.mono(12))
                    .foregroundStyle(Color(SPColor.fg))
                    .multilineTextAlignment(.trailing)
            }
            .accessibilityIdentifier("notifications.timezoneDisplay")

            Button("Use device timezone") {
                Task { await notificationPrefs.persistTimezone(TimeZone.current.identifier) }
            }
            .font(SPFont.mono(11, weight: .medium))
            .disabled(notificationPrefs.isSaving)
            .accessibilityIdentifier("notifications.useDeviceTimezoneButton")
        }
    }

    @ViewBuilder
    private var quietHoursSection: some View {
        Toggle(isOn: Binding(
            get: { notificationPrefs.quietHoursEnabled },
            set: { newValue in
                Task { await notificationPrefs.persistQuietHoursToggle(enabled: newValue) }
            }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Quiet hours")
                    .font(SPFont.mono(13))
                    .foregroundStyle(Color(SPColor.fg))
                Text("Pause scheduled reminders during these hours")
                    .font(SPFont.serif(13, weight: .light))
                    .foregroundStyle(Color(SPColor.fg4))
            }
        }
        .tint(SPColor.green)
        .disabled(notificationPrefs.isSaving)
        .accessibilityIdentifier("notifications.quietHoursToggle")

        if notificationPrefs.quietHoursEnabled {
            DatePicker(
                "Quiet from",
                selection: Binding(
                    get: { notificationPrefs.quietStartTime },
                    set: { notificationPrefs.quietStartTime = $0 }
                ),
                displayedComponents: .hourAndMinute
            )
            .font(SPFont.mono(13))
            .disabled(notificationPrefs.isSaving)
            .onChange(of: notificationPrefs.quietStartTime) { _, _ in
                Task { await notificationPrefs.persistQuietHoursTimes() }
            }
            .accessibilityIdentifier("notifications.quietHoursStartPicker")

            DatePicker(
                "Quiet until",
                selection: Binding(
                    get: { notificationPrefs.quietEndTime },
                    set: { notificationPrefs.quietEndTime = $0 }
                ),
                displayedComponents: .hourAndMinute
            )
            .font(SPFont.mono(13))
            .disabled(notificationPrefs.isSaving)
            .onChange(of: notificationPrefs.quietEndTime) { _, _ in
                Task { await notificationPrefs.persistQuietHoursTimes() }
            }
            .accessibilityIdentifier("notifications.quietHoursEndPicker")
        }
    }

    private var missADayToggle: some View {
        Toggle(isOn: Binding(
            get: { notificationPrefs.missADayEnabled },
            set: { newValue in
                Task { await notificationPrefs.persistMissADayEnabled(newValue) }
            }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Miss a day")
                    .font(SPFont.mono(13))
                    .foregroundStyle(Color(SPColor.fg))
                Text("Sent when you did not practice yesterday and have not sat yet today")
                    .font(SPFont.serif(13, weight: .light))
                    .foregroundStyle(Color(SPColor.fg4))
            }
        }
        .tint(SPColor.green)
        .disabled(notificationPrefs.isSaving)
        .accessibilityIdentifier("notifications.missADayToggle")
    }

    private var friendRequestToggle: some View {
        Toggle(isOn: Binding(
            get: { notificationPrefs.friendRequestNotificationsEnabled },
            set: { newValue in
                Task { await notificationPrefs.persistFriendRequestNotificationsEnabled(newValue) }
            }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Friend requests")
                    .font(SPFont.mono(13))
                    .foregroundStyle(Color(SPColor.fg))
                Text("When someone sends you a friend request")
                    .font(SPFont.serif(13, weight: .light))
                    .foregroundStyle(Color(SPColor.fg4))
            }
        }
        .tint(SPColor.green)
        .disabled(notificationPrefs.isSaving)
        .accessibilityIdentifier("notifications.friendRequestToggle")
    }
}
