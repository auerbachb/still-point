import SwiftUI
import StillPointShared

struct BuddyCalendarView: View {
    let appVM: AppViewModel
    let mode: BuddyCalendarMode

    @State private var vm = BuddyCalendarViewModel()

    var body: some View {
        ScrollView {
            VStack(spacing: SPSpacing.s5) {
                header

                subtitle

                if !vm.fromDate.isEmpty, !vm.toDate.isEmpty {
                    Text("\(vm.fromDate) — \(vm.toDate)")
                        .font(SPFont.mono(11))
                        .foregroundStyle(Color(SPColor.fg4))
                        .multilineTextAlignment(.center)
                }

                if vm.showBuddyFilters {
                    BuddyFilterChips(
                        buddyIds: vm.allBuddyIds,
                        hiddenBuddyIds: vm.hiddenBuddyIds,
                        usernameForBuddy: { vm.username(for: $0) },
                        onToggle: { vm.toggleBuddyVisibility(buddyId: $0) }
                    )
                }

                content

                if vm.hasMore, !vm.isLoading {
                    loadMoreSection
                }

                Spacer().frame(height: SPSpacing.s6)
            }
            .padding(.horizontal, SPSpacing.s4)
            .padding(.top, SPSpacing.s3)
        }
        .stillPointBackground()
        .task(id: mode) {
            await vm.load(mode: mode, viewerUserId: appVM.currentUser?.id)
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button {
                withAnimation {
                    switch mode {
                    case .unified:
                        appVM.closeBuddyCalendar()
                    case .perBuddy:
                        appVM.openBuddyCalendar()
                    }
                }
            } label: {
                Text("← Back")
                    .font(SPFont.mono(12, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg3))
            }
            .accessibilityIdentifier("buddyCalendar.backButton")

            Spacer()

            Text(title)
                .font(SPFont.serifItalic(24, weight: .light))
                .foregroundStyle(Color(SPColor.fg))
                .multilineTextAlignment(.trailing)

            Spacer()

            Color.clear.frame(width: 56)
        }
    }

    private var title: String {
        switch mode {
        case .unified:
            return "Buddy calendar"
        case .perBuddy(_, let username):
            return username
        }
    }

    @ViewBuilder
    private var subtitle: some View {
        switch mode {
        case .unified:
            Text("Shared buddy sits from the last 90 days. Solo history is unchanged on Progress.")
                .font(SPFont.mono(11))
                .foregroundStyle(Color(SPColor.fg3))
                .multilineTextAlignment(.center)
        case .perBuddy(_, let username):
            Text("Shared sits with \(username) only — not their solo sessions.")
                .font(SPFont.mono(11))
                .foregroundStyle(Color(SPColor.fg3))
                .multilineTextAlignment(.center)
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if vm.isLoading {
            ProgressView()
                .tint(SPColor.green)
                .padding(.top, SPSpacing.s6)
        } else if let errorMessage = vm.errorMessage {
            VStack(spacing: SPSpacing.s3) {
                Text(errorMessage)
                    .font(SPFont.serif(15))
                    .foregroundStyle(SPColor.dangerMuted)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("buddyCalendar.errorMessage")

                Button("Retry") {
                    Task { await vm.load(mode: mode, viewerUserId: appVM.currentUser?.id) }
                }
                .font(SPFont.mono(13, weight: .medium))
                .foregroundStyle(SPColor.green)
            }
            .padding(.top, SPSpacing.s6)
        } else if vm.visibleSessions.isEmpty {
            Text(emptyMessage)
                .font(SPFont.serifItalic(15))
                .foregroundStyle(Color(SPColor.fg4))
                .multilineTextAlignment(.center)
                .padding(.top, SPSpacing.s6)
        } else {
            VStack(spacing: SPSpacing.s3) {
                ForEach(vm.sessionsByDate, id: \.date) { group in
                    dateSection(date: group.date, sessions: group.sessions)
                }
            }
        }
    }

    private var emptyMessage: String {
        switch mode {
        case .unified:
            return "No shared buddy sits in this period yet."
        case .perBuddy(_, let username):
            return "No shared sits with \(username) in this period."
        }
    }

    private var loadMoreSection: some View {
        VStack(spacing: SPSpacing.s2) {
            if vm.isLoadingMore {
                ProgressView()
                    .tint(SPColor.green)
            } else {
                Button("Load more") {
                    Task { await vm.loadMore(mode: mode) }
                }
                .font(SPFont.mono(12, weight: .medium))
                .foregroundStyle(SPColor.green)
            }

            Text("More sessions available in this range.")
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .multilineTextAlignment(.center)
        }
        .padding(.top, SPSpacing.s2)
    }

    // MARK: - Date sections

    private func dateSection(date: String, sessions: [BuddyCalendarSession]) -> some View {
        HStack(alignment: .top, spacing: SPSpacing.s2) {
            Text(shortDateLabel(date))
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg3))
                .frame(width: 60, alignment: .trailing)
                .lineLimit(2)
                .padding(.top, 10)

            VStack(spacing: SPSpacing.s2) {
                ForEach(sessions, id: \.id) { session in
                    sessionCard(session)
                }
            }
        }
    }

    private func sessionCard(_ session: BuddyCalendarSession) -> some View {
        let focusBuddyId: String? = {
            if case .perBuddy(let buddyId, _) = mode { return buddyId }
            return nil
        }()
        let primaryId = primaryBuddyId(session: session, focusBuddyId: focusBuddyId)
        let accent = primaryId.map { buddyColorFromUserId($0) } ?? Color(SPColor.fg3)
        let label = buddyLabel(session: session, focusBuddyId: focusBuddyId)
        let time = formatTime(session.startedAt) ?? formatTime(session.scheduledStartAt)
        let durationMin = max(1, Int((Double(session.durationSeconds) / 60.0).rounded()))

        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                Text(label)
                    .font(SPFont.serif(16, weight: .regular))
                    .foregroundStyle(Color(SPColor.fg))

                Spacer(minLength: 8)

                SessionStateBadge(state: session.state)
            }

            Text("\(durationMin) min\(time.map { " · \($0)" } ?? "")")
                .font(SPFont.mono(11))
                .foregroundStyle(Color(SPColor.fg3))

            if case .unified = mode, session.buddyIds.count == 1, let buddyId = session.buddyIds.first {
                Button {
                    withAnimation {
                        appVM.openBuddyCalendarForBuddy(
                            buddyId: buddyId,
                            username: vm.username(for: buddyId)
                        )
                    }
                } label: {
                    Text("View with \(vm.username(for: buddyId))")
                        .font(SPFont.mono(10, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg3))
                        .underline()
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, SPSpacing.s3)
        .padding(.vertical, SPSpacing.s2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(SPColor.surface1))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(SPColor.border2)
        )
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2)
                .fill(accent)
                .frame(width: 3)
                .padding(.vertical, 4)
                .padding(.leading, 4)
        }
        .accessibilityIdentifier("buddyCalendar.session.\(session.id)")
    }

    // MARK: - Session helpers

    private func buddyLabel(session: BuddyCalendarSession, focusBuddyId: String?) -> String {
        let viewerId = appVM.currentUser?.id
        let others = session.participants.filter { $0.userId != viewerId }
        if let focusBuddyId, let focus = others.first(where: { $0.userId == focusBuddyId }) {
            return focus.username
        }
        if others.isEmpty { return "Buddy sit" }
        if others.count == 1 { return others[0].username }
        return others.map(\.username).joined(separator: ", ")
    }

    private func primaryBuddyId(session: BuddyCalendarSession, focusBuddyId: String?) -> String? {
        if let focusBuddyId, session.buddyIds.contains(focusBuddyId) {
            return focusBuddyId
        }
        let viewerId = appVM.currentUser?.id
        return session.buddyIds.first(where: { $0 != viewerId }) ?? session.buddyIds.first
    }

    private func formatTime(_ iso: String?) -> String? {
        guard let iso, !iso.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = formatter.date(from: iso)
        if date == nil {
            formatter.formatOptions = [.withInternetDateTime]
            date = formatter.date(from: iso)
        }
        guard let date else { return nil }
        let display = DateFormatter()
        display.timeStyle = .short
        display.dateStyle = .none
        return display.string(from: date)
    }

    private static let isoDateFormatter: DateFormatter = {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.locale = Locale(identifier: "en_US_POSIX")
        df.calendar = Calendar(identifier: .gregorian)
        return df
    }()

    private static let displayDateFormatter: DateFormatter = {
        let df = DateFormatter()
        df.dateFormat = "EEE MMM d"
        return df
    }()

    private func shortDateLabel(_ isoDate: String) -> String {
        guard let date = Self.isoDateFormatter.date(from: isoDate) else { return isoDate }
        return Self.displayDateFormatter.string(from: date)
    }
}
