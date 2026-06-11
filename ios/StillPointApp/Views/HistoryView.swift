import SwiftUI
import StillPointShared

struct HistoryView: View {
    let appVM: AppViewModel
    @State private var vm = HistoryViewModel()

    var body: some View {
        ScrollView {
            VStack(spacing: SPSpacing.s5) {
                // Welcome header
                if let username = appVM.currentUser?.username {
                    Text("WELCOME, \(username.uppercased())")
                        .font(SPFont.mono(11, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg3))
                        .tracking(3)
                        .padding(.top, SPSpacing.s3)
                }

                Text("Progress")
                    .font(SPFont.serifItalic(28, weight: .light))
                    .foregroundStyle(Color(SPColor.fg))
                    .accessibilityIdentifier("history.title")

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
                            .accessibilityIdentifier("history.errorMessage")
                        Button("Retry") {
                            Task { await vm.load() }
                        }
                        .font(SPFont.mono(13, weight: .medium))
                        .foregroundStyle(SPColor.green)
                    }
                    .padding(.top, SPSpacing.s6)
                } else if vm.journeyRows.isEmpty {
                    VStack(spacing: SPSpacing.s3) {
                        Text("No sessions yet")
                            .font(SPFont.serifItalic(15))
                            .foregroundStyle(Color(SPColor.fg4))

                        todayPreview
                    }
                    .padding(.top, SPSpacing.s6)
                } else {
                    // Aggregate stats
                    if let stats = vm.stats {
                        LazyVGrid(columns: [
                            GridItem(.flexible()),
                            GridItem(.flexible()),
                            GridItem(.flexible()),
                            GridItem(.flexible()),
                            GridItem(.flexible()),
                        ], spacing: SPSpacing.s3) {
                            statCell(value: "\(stats.streak)", label: "STREAK")
                            statCell(value: "\(stats.avgClearPercent)%", label: "AVG CLEAR")
                            statCell(value: String(format: "%.1f", stats.avgThoughtsPerSession), label: "THOUGHTS/SESSION")
                            statCell(value: String(format: "%.2f", stats.avgThoughtsPerMinute), label: "THOUGHTS/MIN")
                            statCell(value: "\(stats.bonusMinutesTotal ?? 0)", label: "BONUS MIN TOTAL")
                        }
                    }

                    // Journey
                    VStack(alignment: .leading, spacing: 4) {
                        Text("JOURNEY")
                            .font(SPFont.mono(11, weight: .medium))
                            .foregroundStyle(Color(SPColor.fg4))
                            .tracking(2)
                            .padding(.bottom, 4)

                        ForEach(0..<vm.journeyRows.count, id: \.self) { index in
                            let row = vm.journeyRows[index]
                            let prevDate: String? = index > 0 ? previousSessionDate(before: index) : nil
                            switch row {
                            case .missed(let date):
                                missedRow(date: date)
                            case .missedRange(let startDate, _, let dayCount):
                                missedRangeRow(startDate: startDate, dayCount: dayCount)
                            case .session(let session, let sessionIndex):
                                let showDate = prevDate.map { $0 != session.sessionDate } ?? true
                                sessionRow(session: session, sessionIndexInDay: sessionIndex, showDateColumn: showDate)
                            }
                        }

                        todayPreview
                    }
                }

                Spacer().frame(height: SPSpacing.s6)
            }
            .padding(.horizontal, SPSpacing.s4)
        }
        .stillPointBackground()
        .task {
            await vm.load()
        }
    }

    private func previousSessionDate(before index: Int) -> String? {
        var i = index - 1
        while i >= 0 {
            switch vm.journeyRows[i] {
            case .missed(let date):
                return date
            case .missedRange(_, let endDate, _):
                return endDate
            case .session(let session, _):
                return session.sessionDate
            }
            i -= 1
        }
        return nil
    }

    private func statCell(value: String, label: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(SPFont.mono(18, weight: .light))
                .foregroundStyle(SPColor.green)
            Text(label)
                .font(SPFont.mono(9, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(1)
                .multilineTextAlignment(.center)
        }
    }

    // MARK: - Session Row

    @ViewBuilder
    private func sessionRow(session: SessionDTO, sessionIndexInDay: Int, showDateColumn: Bool) -> some View {
        let isExpanded = vm.expandedSessionId == session.id

        VStack(spacing: 0) {
            Button {
                Task { await vm.toggleSession(session.id) }
            } label: {
                HStack(spacing: 8) {
                    // Date label (only first row of each calendar day)
                    Text(showDateColumn ? shortDateLabel(session.sessionDate) : "")
                        .font(SPFont.mono(10))
                        .foregroundStyle(Color(SPColor.fg4))
                        .frame(width: 56, alignment: .trailing)
                        .lineLimit(1)

                    // Session label within the day (quick sits visually distinct)
                    Text(session.sessionType == .quick ? "Quick \(sessionIndexInDay)" : "Session \(sessionIndexInDay)")
                        .font(SPFont.mono(11, weight: .medium))
                        .foregroundStyle(session.sessionType == .quick ? SPColor.amberText : SPColor.fg3)
                        .frame(width: 72, alignment: .trailing)

                    // Proportional bar
                    GeometryReader { geo in
                        let barFraction = vm.maxDuration > 0
                            ? CGFloat(session.actualTime ?? session.duration) / CGFloat(vm.maxDuration)
                            : 0
                        let barWidth = geo.size.width * barFraction
                        let clearWidth = barWidth * CGFloat(session.clearPercent) / 100.0
                        let thinkWidth = barWidth - clearWidth

                        ZStack(alignment: .leading) {
                            // Background track
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color(SPColor.surface1))
                                .frame(width: geo.size.width, height: 16)

                            // Proportional filled portion
                            HStack(spacing: 0) {
                                Rectangle()
                                    .fill(SPColor.green.opacity(session.completed ? 0.7 : 0.4))
                                    .frame(width: max(0, clearWidth))
                                Rectangle()
                                    .fill(SPColor.amber.opacity(session.completed ? 0.5 : 0.3))
                                    .frame(width: max(0, thinkWidth))
                            }
                            .frame(height: 16)
                            .clipShape(RoundedRectangle(cornerRadius: 3))
                        }
                    }
                    .frame(height: 16)

                    // Metadata: duration · clear% · thoughts
                    HStack(spacing: 4) {
                        Text("\(session.actualTime ?? session.duration)s")
                            .foregroundStyle(Color(SPColor.fg3))
                        Text("·")
                            .foregroundStyle(Color(SPColor.fg4))
                        Text("\(session.clearPercent)%")
                            .foregroundStyle(SPColor.greenText)
                        Text("·")
                            .foregroundStyle(Color(SPColor.fg4))
                        Text("\(session.thoughtCount)\u{1F4AD}")
                            .foregroundStyle(SPColor.amberText)
                        if let bonus = session.bonusSeconds, bonus > 0 {
                            Text("·")
                                .foregroundStyle(Color(SPColor.fg4))
                            Text("+\(Int((Double(bonus) / 60.0).rounded()))m bonus")
                                .foregroundStyle(Color(SPColor.fg2))
                        }
                    }
                    .font(SPFont.mono(10))
                    .frame(width: 100, alignment: .leading)
                    .lineLimit(1)
                }
                .padding(.vertical, 2)
            }
            .accessibilityIdentifier("history.session.\(session.id)")

            // Expanded thoughts
            if isExpanded, let thoughts = vm.sessionThoughts[session.id] {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(thoughts, id: \.id) { thought in
                        HStack(alignment: .top, spacing: SPSpacing.s2) {
                            Text(thought.timeInSession == -1 ? "note" : "@\(thought.timeInSession)s")
                                .font(SPFont.mono(10))
                                .foregroundStyle(SPColor.amberText)
                                .frame(width: 44, alignment: .trailing)

                            Text(thought.text)
                                .font(SPFont.serifItalic(13))
                                .foregroundStyle(Color(SPColor.fg3))
                        }
                    }
                }
                .padding(.leading, 44)
                .padding(.vertical, 4)
            }
        }
    }

    // MARK: - Missed Row

    private func missedRow(date: String) -> some View {
        HStack(spacing: 8) {
            // Date label
            Text(shortDateLabel(date))
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 56, alignment: .trailing)
                .lineLimit(1)

            // Em-dash instead of session label
            Text("\u{2014}")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg3))
                .frame(width: 72, alignment: .trailing)

            // Dashed border container
            RoundedRectangle(cornerRadius: 3)
                .stroke(SPColor.border2, style: StrokeStyle(lineWidth: 1, dash: [4]))
                .frame(height: 16)
                .overlay(alignment: .leading) {
                    Text("missed")
                        .font(SPFont.mono(10))
                        .foregroundStyle(Color(SPColor.fg4))
                        .italic()
                        .padding(.leading, 8)
                }

            // Empty metadata spacer
            Color.clear
                .frame(width: 100)
        }
        .padding(.vertical, 2)
        .opacity(0.35)
    }

    // MARK: - Missed Range Row

    /// Compact summary for a collapsed run of consecutive missed days (#379).
    private func missedRangeRow(startDate: String, dayCount: Int) -> some View {
        HStack(spacing: 8) {
            // Date label (first missed day of the range)
            Text(shortDateLabel(startDate))
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 56, alignment: .trailing)
                .lineLimit(1)

            // Em-dash instead of session label
            Text("\u{2014}")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg3))
                .frame(width: 72, alignment: .trailing)

            // Dashed border container
            RoundedRectangle(cornerRadius: 3)
                .stroke(SPColor.border2, style: StrokeStyle(lineWidth: 1, dash: [4]))
                .frame(height: 16)
                .overlay(alignment: .leading) {
                    Text(dayCount == 1 ? "1 day missed" : "\(dayCount) days missed")
                        .font(SPFont.mono(10))
                        .foregroundStyle(Color(SPColor.fg4))
                        .italic()
                        .padding(.leading, 8)
                        .lineLimit(1)
                }

            // Empty metadata spacer
            Color.clear
                .frame(width: 100)
        }
        .padding(.vertical, 2)
        .opacity(0.35)
        .accessibilityIdentifier("history.missedRange.\(startDate)")
    }

    // MARK: - Today Preview

    private var todayPreview: some View {
        let todayDuration = appVM.todayDuration

        return HStack(spacing: 8) {
            // Date label
            Text("today")
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 56, alignment: .trailing)

            // Placeholder aligned with session label column
            Text("\u{2014}")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 72, alignment: .trailing)

            // Proportional dashed bar
            GeometryReader { geo in
                let barFraction = vm.maxDuration > 0
                    ? CGFloat(todayDuration) / CGFloat(vm.maxDuration)
                    : 0
                let barWidth = geo.size.width * barFraction

                ZStack(alignment: .leading) {
                    // Background track
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color(SPColor.surface1))
                        .frame(width: geo.size.width, height: 16)

                    // Dashed outline scaled to duration
                    RoundedRectangle(cornerRadius: 3)
                        .stroke(SPColor.border2, style: StrokeStyle(lineWidth: 1, dash: [4]))
                        .frame(width: max(0, barWidth), height: 16)
                }
            }
            .frame(height: 16)

            // Duration label
            Text("\(todayDuration)s")
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 100, alignment: .leading)
        }
        .padding(.vertical, 2)
    }

    // MARK: - Helpers

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

    /// Format "YYYY-MM-DD" → "Mon Mar 16" (short, fits mobile).
    private func shortDateLabel(_ isoDate: String) -> String {
        guard let date = Self.isoDateFormatter.date(from: isoDate) else { return isoDate }
        return Self.displayDateFormatter.string(from: date)
    }
}
