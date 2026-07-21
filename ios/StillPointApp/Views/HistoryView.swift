import SwiftUI
import StillPointShared

struct HistoryView: View {
    let appVM: AppViewModel
    @State private var vm = HistoryViewModel()

    private let weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"]

    var body: some View {
        ScrollView {
            VStack(spacing: SPSpacing.s5) {
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
                    errorContent(errorMessage)
                } else if vm.sessions.isEmpty && vm.journeyRows.isEmpty {
                    emptyContent
                } else {
                    viewModeToggle

                    if vm.viewMode == .calendar {
                        calendarContent
                    } else {
                        journeyContent
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

    // MARK: - View Toggle

    private var viewModeToggle: some View {
        HStack(spacing: 8) {
            ForEach(HistoryViewMode.allCases, id: \.self) { mode in
                Button {
                    vm.viewMode = mode
                    if mode == .journey {
                        vm.calendarSubView = .default
                    }
                } label: {
                    Text(mode.label.uppercased())
                        .font(SPFont.mono(11, weight: .medium))
                        .tracking(1)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .foregroundStyle(vm.viewMode == mode ? Color(SPColor.fg) : Color(SPColor.fg3))
                        .background(vm.viewMode == mode ? Color(SPColor.surface2) : Color.clear)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4)
                                .stroke(
                                    vm.viewMode == mode ? SPColor.border3 : SPColor.border1,
                                    lineWidth: 1
                                )
                        )
                }
                .accessibilityIdentifier("history.viewMode.\(mode.rawValue)")
            }
        }
    }

    // MARK: - Calendar

    @ViewBuilder
    private var calendarContent: some View {
        if vm.calendarSubView == .yearInReview {
            yearInReviewContent
        } else {
            trailing4WeekStats
            mindStateTrendsSection
            allTimeProgressBar
            legacyStatsGrid
            priorMonthSummariesSection
            currentMonthGridSection
        }
    }

    private var trailing4WeekStats: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 2), spacing: SPSpacing.s3) {
            statCard(value: "\(vm.stats?.trailing4WeekDays ?? 0)", label: "DAYS MEDITATED")
            statCard(
                value: String(format: "%.1f%%", vm.stats?.trailing4WeekDayPercent ?? 0),
                label: "OF DAYS"
            )
            statCard(
                value: HistoryMonthGrid.formatTotalTime(vm.stats?.trailing4WeekTotalTime ?? 0),
                label: "TOTAL TIME"
            )
            statCard(
                value: String(format: "%.2f%%", vm.stats?.trailing4WeekTimePercent ?? 0),
                label: "OF TIME"
            )
        }
    }

    private var mindStateTrendsSection: some View {
        VStack(spacing: SPSpacing.s3) {
            Text("SIT-TIME COMPOSITION")
                .font(SPFont.serif(14))
                .foregroundStyle(Color(SPColor.fg2))
                .tracking(2)

            mindStateTrailing4WeekStatGrid

            Text(mindStateAllTimeSummaryText)
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .multilineTextAlignment(.center)

            let activeDays = vm.mindStateTrends.dailyTrend.filter { $0.totalSitSeconds > 0 }
            if activeDays.isEmpty {
                Text("No sits in the trailing 4 weeks yet.")
                    .font(SPFont.mono(11))
                    .foregroundStyle(Color(SPColor.fg4))
            } else {
                VStack(spacing: 6) {
                    ForEach(activeDays, id: \.date) { day in
                        mindStateDayRow(day)
                    }
                }
            }

            mindStateLegend
        }
        .frame(maxWidth: 480)
        .accessibilityIdentifier("history.mindStateTrends")
    }

    private var mindStateTrailing4WeekStatGrid: some View {
        let trailing = vm.mindStateTrends.trailing4Week
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 2), spacing: SPSpacing.s3) {
            mindStateStatCard(
                value: String(format: "%.1f%%", trailing.lightDistractionPercent),
                label: "LIGHT DISTRACTION",
                color: SPColor.amberText
            )
            mindStateStatCard(
                value: String(format: "%.1f%%", trailing.heavyDistractionPercent),
                label: "HEAVY DISTRACTION",
                color: SPColor.dangerMuted
            )
            mindStateStatCard(
                value: String(format: "%.1f%%", trailing.hyperfocusPercent),
                label: "HYPERFOCUS",
                color: Color(red: 96/255, green: 165/255, blue: 250/255).opacity(0.95)
            )
            mindStateStatCard(
                value: HistoryMonthGrid.formatTotalTime(trailing.totalSitSeconds),
                label: "SIT TIME",
                color: Color(SPColor.fg)
            )
        }
    }

    private var mindStateAllTimeSummaryText: String {
        let allTime = vm.mindStateTrends.allTime
        return "Trailing 4 weeks · all time "
            + String(format: "%.1f%%", allTime.lightDistractionPercent) + " light · "
            + String(format: "%.1f%%", allTime.heavyDistractionPercent) + " heavy · "
            + String(format: "%.1f%%", allTime.hyperfocusPercent) + " hyperfocus"
    }

    private func mindStateDayRow(_ day: MindStateDailyTrendBucket) -> some View {
        HStack(spacing: 8) {
            Text(shortTrendDayLabel(day.date))
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg3))
                .frame(width: 72, alignment: .trailing)
                .lineLimit(1)

            GeometryReader { geo in
                let totalWidth = geo.size.width
                HStack(spacing: 0) {
                    mindStateBarSegment(
                        width: totalWidth * day.composition.clearPercent / 100,
                        color: SPColor.green,
                        opacity: 0.75
                    )
                    mindStateBarSegment(
                        width: totalWidth * day.composition.lightDistractionPercent / 100,
                        color: SPColor.amber,
                        opacity: 0.85
                    )
                    mindStateBarSegment(
                        width: totalWidth * day.composition.heavyDistractionPercent / 100,
                        color: SPColor.dangerMuted,
                        opacity: 0.85
                    )
                    mindStateBarSegment(
                        width: totalWidth * day.composition.hyperfocusPercent / 100,
                        color: Color(red: 96/255, green: 165/255, blue: 250/255),
                        opacity: 0.85
                    )
                }
                .frame(width: totalWidth, height: 10)
                .background(Color(SPColor.surface1))
                .clipShape(RoundedRectangle(cornerRadius: 3))
            }
            .frame(height: 10)

            Text(HistoryMonthGrid.formatTotalTime(day.totalSitSeconds))
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 44, alignment: .leading)
        }
    }

    private func mindStateBarSegment(width: CGFloat, color: Color, opacity: Double) -> some View {
        Group {
            if width > 0 {
                Rectangle()
                    .fill(color.opacity(opacity))
                    .frame(width: width, height: 10)
            }
        }
    }

    private var mindStateLegend: some View {
        HStack(spacing: 12) {
            legendDot(color: SPColor.green, label: "aware")
            legendDot(color: SPColor.amber, label: "light distraction")
            legendDot(color: SPColor.dangerMuted, label: "heavy distraction")
            legendDot(color: Color(red: 96/255, green: 165/255, blue: 250/255), label: "hyperfocus")
        }
        .font(SPFont.mono(10))
        .foregroundStyle(Color(SPColor.fg3))
    }

    private var allTimeProgressBar: some View {
        VStack(spacing: 8) {
            HStack {
                Text("\(HistoryMonthGrid.formatTotalTime(vm.stats?.totalTimeAllTime ?? 0)) all time")
                Spacer()
                Text(String(format: "%.2f%% to 10,000 hours", vm.stats?.progressTo10kHours ?? 0))
            }
            .font(SPFont.mono(11))
            .foregroundStyle(Color(SPColor.fg3))

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color(SPColor.surface1))
                    RoundedRectangle(cornerRadius: 3)
                        .fill(SPColor.greenBgSubtle)
                        .frame(width: geo.size.width * min(1, (vm.stats?.progressTo10kHours ?? 0) / 100))
                }
            }
            .frame(height: 6)
        }
        .frame(maxWidth: 480)
    }

    private var legacyStatsGrid: some View {
        Group {
            if let stats = vm.stats {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: SPSpacing.s3) {
                    statCell(value: "\(stats.streak)", label: "STREAK")
                    statCell(value: "\(stats.avgClearPercent)%", label: "AVG CLEAR")
                    statCell(value: String(format: "%.1f", stats.avgThoughtsPerSession), label: "THOUGHTS/SESSION")
                    statCell(value: String(format: "%.2f", stats.avgThoughtsPerMinute), label: "THOUGHTS/MIN")
                    statCell(value: "\(stats.bonusMinutesTotal ?? 0)", label: "BONUS MIN TOTAL")
                }
            }
        }
    }

    @ViewBuilder
    private var priorMonthSummariesSection: some View {
        if !vm.priorMonthSummaries.isEmpty {
            VStack(spacing: 6) {
                ForEach(vm.priorMonthSummaries, id: \.yearMonth) { month in
                    HStack {
                        Text(month.label)
                            .foregroundStyle(Color(SPColor.fg2))
                        Spacer()
                        Text("\(month.daysActive)/\(month.daysInMonth) days · \(HistoryMonthGrid.formatTotalTime(month.totalTimeSeconds))")
                    }
                    .font(SPFont.mono(11))
                    .foregroundStyle(Color(SPColor.fg3))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(SPColor.surface1))
                    .overlay(
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(SPColor.border1, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                }
            }
            .frame(maxWidth: 480)
            .accessibilityIdentifier("history.priorMonths")
        }
    }

    private var currentMonthGridSection: some View {
        VStack(spacing: 12) {
            HStack {
                Text(vm.monthGrid.monthLabel.uppercased())
                    .font(SPFont.serif(14))
                    .foregroundStyle(Color(SPColor.fg2))
                    .tracking(2)
                Spacer()
                Button("Year in review") {
                    vm.calendarSubView = .yearInReview
                }
                .font(SPFont.mono(10, weight: .medium))
                .tracking(1)
                .foregroundStyle(Color(SPColor.fg3))
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(SPColor.border1, lineWidth: 1)
                )
                .accessibilityIdentifier("history.yearInReviewButton")
            }

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
                ForEach(Array(weekdayLabels.enumerated()), id: \.offset) { _, label in
                    Text(label)
                        .font(SPFont.mono(10))
                        .foregroundStyle(Color(SPColor.fg3))
                        .padding(.bottom, 4)
                }

                ForEach(Array(vm.monthGrid.cells.enumerated()), id: \.offset) { index, cell in
                    switch cell {
                    case .blank:
                        Color.clear.frame(minHeight: 36)
                            .accessibilityIdentifier("history.monthCell.blank.\(index)")
                    case .day(let day):
                        monthDayCell(day)
                    }
                }
            }

            HStack(spacing: 16) {
                legendDot(color: SPColor.greenBgSubtle, border: SPColor.greenBorder, label: "meditated")
                legendDot(color: Color(SPColor.surface1), border: SPColor.border1, label: "missed")
                legendDot(color: Color(SPColor.surface3), border: SPColor.border3, label: "today")
            }
        }
        .frame(maxWidth: 480)
        .accessibilityIdentifier("history.monthGrid")
    }

    private func monthDayCell(_ day: MonthGridDay) -> some View {
        let isTodayCell = day.isoDate == vm.todayIsoDate
        let isMeditated = day.state == .meditated
        let isMissed = day.state == .missed
        let isFuture = day.state == .future

        let background: Color = isMeditated
            ? SPColor.greenBgSubtle
            : isTodayCell ? Color(SPColor.surface3) : Color(SPColor.surface1)
        let border: Color = isTodayCell
            ? SPColor.border3
            : isMeditated ? SPColor.greenBorder : SPColor.border1
        let borderWidth: CGFloat = isTodayCell ? 2 : 1
        let opacity: Double = isMissed ? 0.45 : isFuture ? 0.35 : 1

        return VStack(spacing: 2) {
            Text("\(day.dayOfMonth)")
                .font(SPFont.mono(10))
                .foregroundStyle(isMeditated ? SPColor.greenText : Color(SPColor.fg3))
            if !day.durationLabels.isEmpty {
                Text(day.durationLabels.joined(separator: ", "))
                    .font(SPFont.mono(8))
                    .foregroundStyle(Color(SPColor.fg4))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 36)
        .padding(2)
        .background(background)
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(border, lineWidth: borderWidth)
        )
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .opacity(opacity)
        .accessibilityIdentifier("history.monthCell.\(day.isoDate)")
    }

    // MARK: - Year in Review

    private var yearInReviewContent: some View {
        VStack(spacing: SPSpacing.s4) {
            HStack {
                Button("← Calendar") {
                    vm.calendarSubView = .default
                }
                .font(SPFont.mono(11, weight: .medium))
                .tracking(1)
                .foregroundStyle(Color(SPColor.fg3))
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(SPColor.border1, lineWidth: 1)
                )
                .accessibilityIdentifier("history.yearInReviewBack")
                Spacer()
                Text("YEAR IN REVIEW")
                    .font(SPFont.serif(14))
                    .foregroundStyle(Color(SPColor.fg2))
                    .tracking(2)
                Spacer()
                Color.clear.frame(width: 88)
            }

            let totals = yearInReviewTotals
            HStack(spacing: SPSpacing.s4) {
                statCard(value: "\(totals.daysActive)", label: "DAYS ACTIVE")
                statCard(
                    value: HistoryMonthGrid.formatTotalTime(totals.totalTimeSeconds),
                    label: "TOTAL TIME"
                )
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(vm.trailing12MonthSummaries, id: \.yearMonth) { month in
                    yearMonthCard(month)
                }
            }

            Text("trailing 12 months · days active / days in month")
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: 480)
        .accessibilityIdentifier("history.yearInReview")
    }

    private var yearInReviewTotals: (daysActive: Int, totalTimeSeconds: Int) {
        let months = vm.trailing12MonthSummaries
        return (
            daysActive: months.reduce(0) { $0 + $1.daysActive },
            totalTimeSeconds: months.reduce(0) { $0 + $1.totalTimeSeconds }
        )
    }

    private func yearMonthCard(_ month: MonthlySummary) -> some View {
        let hasActivity = month.daysActive > 0
        let intensity = month.daysInMonth > 0
            ? Double(month.daysActive) / Double(month.daysInMonth)
            : 0
        let opacity = hasActivity ? 0.45 + intensity * 0.55 : 0.65

        return VStack(alignment: .leading, spacing: 6) {
            Text(HistoryMonthlyAggregation.formatShortMonthLabel(month.yearMonth))
                .font(SPFont.mono(10))
                .foregroundStyle(hasActivity ? SPColor.greenText : Color(SPColor.fg3))
            Text("\(month.daysActive)/\(month.daysInMonth)")
                .font(SPFont.mono(15, weight: .light))
                .foregroundStyle(Color(SPColor.fg))
            Text(HistoryMonthGrid.formatTotalTime(month.totalTimeSeconds))
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
        }
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.vertical, 12)
        .background(hasActivity ? SPColor.greenBgSubtle : Color(SPColor.surface1))
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(hasActivity ? SPColor.greenBorder : SPColor.border1, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .opacity(opacity)
        .accessibilityIdentifier("history.yearMonth.\(month.yearMonth)")
    }

    // MARK: - Journey

    private struct JourneyRowDisplay: Identifiable {
        let id: Int
        let row: HistoryJourneyListRow
        let showDateColumn: Bool
    }

    private var journeyRowDisplays: [JourneyRowDisplay] {
        var displays: [JourneyRowDisplay] = []
        var lastSessionDate: String?
        for (index, row) in vm.journeyRows.enumerated() {
            switch row {
            case .missed(let date):
                displays.append(JourneyRowDisplay(id: index, row: row, showDateColumn: false))
                lastSessionDate = date
            case .missedRange(_, let endDate, _):
                displays.append(JourneyRowDisplay(id: index, row: row, showDateColumn: false))
                lastSessionDate = endDate
            case .session(let session, let sessionIndex):
                let showDate = lastSessionDate.map { $0 != session.sessionDate } ?? true
                displays.append(
                    JourneyRowDisplay(
                        id: index,
                        row: .session(session: session, sessionIndexInDay: sessionIndex),
                        showDateColumn: showDate
                    )
                )
                lastSessionDate = session.sessionDate
            }
        }
        return displays
    }

    private var journeyContent: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("JOURNEY")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .tracking(2)
                .padding(.bottom, 4)

            ForEach(journeyRowDisplays) { display in
                switch display.row {
                case .missed(let date):
                    missedRow(date: date)
                case .missedRange(let startDate, _, let dayCount):
                    missedRangeRow(startDate: startDate, dayCount: dayCount)
                case .session(let session, let sessionIndex):
                    sessionRow(
                        session: session,
                        sessionIndexInDay: sessionIndex,
                        showDateColumn: display.showDateColumn
                    )
                }
            }

            todayPreview
        }
    }

    // MARK: - Empty / Error

    private var emptyContent: some View {
        VStack(spacing: SPSpacing.s3) {
            Text("No sessions yet")
                .font(SPFont.serifItalic(15))
                .foregroundStyle(Color(SPColor.fg4))
            todayPreview
        }
        .padding(.top, SPSpacing.s6)
    }

    private func errorContent(_ message: String) -> some View {
        VStack(spacing: SPSpacing.s3) {
            Text(message)
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
    }

    // MARK: - Shared Stat Helpers

    private func statCard(value: String, label: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(SPFont.mono(24, weight: .light))
                .foregroundStyle(Color(SPColor.fg))
            Text(label)
                .font(SPFont.mono(10, weight: .medium))
                .foregroundStyle(Color(SPColor.fg3))
                .tracking(1)
                .multilineTextAlignment(.center)
        }
    }

    private func mindStateStatCard(value: String, label: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(SPFont.mono(22, weight: .light))
                .foregroundStyle(color)
            Text(label)
                .font(SPFont.mono(10, weight: .medium))
                .foregroundStyle(Color(SPColor.fg3))
                .tracking(1)
                .multilineTextAlignment(.center)
        }
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

    private func legendDot(color: Color, border: Color? = nil, label: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .frame(width: 10, height: 10)
                .overlay {
                    if let border {
                        RoundedRectangle(cornerRadius: 2)
                            .stroke(border, lineWidth: 1)
                    }
                }
            Text(label)
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
                    Text(showDateColumn ? shortDateLabel(session.sessionDate) : "")
                        .font(SPFont.mono(10))
                        .foregroundStyle(Color(SPColor.fg4))
                        .frame(width: 56, alignment: .trailing)
                        .lineLimit(1)

                    Text(sessionLabel(session: session, index: sessionIndexInDay))
                        .font(SPFont.mono(11, weight: .medium))
                        .foregroundStyle(sessionLabelColor(session: session))
                        .frame(width: 72, alignment: .trailing)

                    GeometryReader { geo in
                        let barFraction = vm.maxDuration > 0
                            ? CGFloat(session.actualTime ?? session.duration) / CGFloat(vm.maxDuration)
                            : 0
                        let barWidth = geo.size.width * barFraction
                        let clearWidth = barWidth * CGFloat(session.clearPercent) / 100.0
                        let thinkWidth = barWidth - clearWidth

                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color(SPColor.surface1))
                                .frame(width: geo.size.width, height: 16)

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

    // MARK: - Session Label Helpers

    private func sessionLabel(session: SessionDTO, index: Int) -> String {
        switch session.sessionType {
        case .quick:
            return "Quick \(index)"
        case .breath:
            if let count = session.breathCount, count > 0 {
                return "Breath \(count)b"
            }
            return "Breath \(index)"
        case .standard:
            return "Session \(index)"
        }
    }

    private func sessionLabelColor(session: SessionDTO) -> Color {
        switch session.sessionType {
        case .quick:
            return SPColor.amberText
        case .breath:
            return SPColor.greenText
        case .standard:
            return Color(SPColor.fg3)
        }
    }

    // MARK: - Missed Row

    private func missedRow(date: String) -> some View {
        HStack(spacing: 8) {
            Text(shortDateLabel(date))
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 56, alignment: .trailing)
                .lineLimit(1)

            Text("\u{2014}")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg3))
                .frame(width: 72, alignment: .trailing)

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

            Color.clear
                .frame(width: 100)
        }
        .padding(.vertical, 2)
        .opacity(0.35)
    }

    private func missedRangeRow(startDate: String, dayCount: Int) -> some View {
        HStack(spacing: 8) {
            Text(shortDateLabel(startDate))
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 56, alignment: .trailing)
                .lineLimit(1)

            Text("\u{2014}")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg3))
                .frame(width: 72, alignment: .trailing)

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
            Text("today")
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 56, alignment: .trailing)

            Text("\u{2014}")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 72, alignment: .trailing)

            GeometryReader { geo in
                let barFraction = vm.maxDuration > 0
                    ? CGFloat(todayDuration) / CGFloat(vm.maxDuration)
                    : 0
                let barWidth = geo.size.width * barFraction

                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color(SPColor.surface1))
                        .frame(width: geo.size.width, height: 16)

                    RoundedRectangle(cornerRadius: 3)
                        .stroke(SPColor.border2, style: StrokeStyle(lineWidth: 1, dash: [4]))
                        .frame(width: max(0, barWidth), height: 16)
                }
            }
            .frame(height: 16)

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

    private static let trendDayFormatter: DateFormatter = {
        let df = DateFormatter()
        df.dateFormat = "EEE M/d"
        return df
    }()

    private func shortDateLabel(_ isoDate: String) -> String {
        guard let date = Self.isoDateFormatter.date(from: isoDate) else { return isoDate }
        return Self.displayDateFormatter.string(from: date)
    }

    private func shortTrendDayLabel(_ isoDate: String) -> String {
        guard let date = Self.isoDateFormatter.date(from: isoDate) else { return isoDate }
        return Self.trendDayFormatter.string(from: date)
    }
}
