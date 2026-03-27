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
                        Button("Retry") {
                            Task { await vm.load() }
                        }
                        .font(SPFont.mono(13, weight: .medium))
                        .foregroundStyle(SPColor.green)
                    }
                    .padding(.top, SPSpacing.s6)
                } else if vm.sessions.isEmpty {
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
                        ], spacing: SPSpacing.s3) {
                            statCell(value: "\(stats.streak)", label: "STREAK")
                            statCell(value: "\(stats.avgClearPercent)%", label: "AVG CLEAR")
                            statCell(value: String(format: "%.1f", stats.avgThoughtsPerSession), label: "THOUGHTS/SESSION")
                            statCell(value: String(format: "%.2f", stats.avgThoughtsPerMinute), label: "THOUGHTS/MIN")
                        }
                    }

                    // Journey
                    VStack(alignment: .leading, spacing: 4) {
                        Text("JOURNEY")
                            .font(SPFont.mono(11, weight: .medium))
                            .foregroundStyle(Color(SPColor.fg4))
                            .tracking(2)
                            .padding(.bottom, 4)

                        ForEach(vm.history) { entry in
                            if entry.missed {
                                missedRow(entry)
                            } else {
                                sessionRow(entry)
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
    private func sessionRow(_ entry: HistoryEntry) -> some View {
        let dayNumber = entry.dayNumber ?? 0
        let isExpanded = vm.expandedDay == dayNumber

        VStack(spacing: 0) {
            Button {
                Task { await vm.toggleDay(dayNumber) }
            } label: {
                HStack(spacing: 8) {
                    // Date label
                    Text(shortDateLabel(entry.date))
                        .font(SPFont.mono(10))
                        .foregroundStyle(Color(SPColor.fg4))
                        .frame(width: 56, alignment: .trailing)
                        .lineLimit(1)

                    // Day number
                    Text("D\(dayNumber)")
                        .font(SPFont.mono(11, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg3))
                        .frame(width: 28, alignment: .trailing)

                    // Proportional bar
                    GeometryReader { geo in
                        let barFraction = vm.maxDuration > 0
                            ? CGFloat(entry.actualTime) / CGFloat(vm.maxDuration)
                            : 0
                        let barWidth = geo.size.width * barFraction
                        let clearWidth = barWidth * CGFloat(entry.clearPercent) / 100.0
                        let thinkWidth = barWidth - clearWidth

                        ZStack(alignment: .leading) {
                            // Background track
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color(SPColor.surface1))
                                .frame(width: geo.size.width, height: 16)

                            // Proportional filled portion
                            HStack(spacing: 0) {
                                Rectangle()
                                    .fill(SPColor.green.opacity(entry.completed ? 0.7 : 0.4))
                                    .frame(width: max(0, clearWidth))
                                Rectangle()
                                    .fill(SPColor.amber.opacity(entry.completed ? 0.5 : 0.3))
                                    .frame(width: max(0, thinkWidth))
                            }
                            .frame(height: 16)
                            .clipShape(RoundedRectangle(cornerRadius: 3))
                        }
                    }
                    .frame(height: 16)

                    // Metadata: duration · clear% · thoughts
                    HStack(spacing: 4) {
                        Text("\(entry.actualTime)s")
                            .foregroundStyle(Color(SPColor.fg3))
                        Text("·")
                            .foregroundStyle(Color(SPColor.fg4))
                        Text("\(entry.clearPercent)%")
                            .foregroundStyle(SPColor.greenText)
                        Text("·")
                            .foregroundStyle(Color(SPColor.fg4))
                        Text("\(entry.thoughtCount)\u{1F4AD}")
                            .foregroundStyle(SPColor.amberText)
                    }
                    .font(SPFont.mono(10))
                    .frame(width: 100, alignment: .leading)
                    .lineLimit(1)
                }
                .padding(.vertical, 2)
            }

            // Expanded thoughts
            if isExpanded, let thoughts = vm.dayThoughts[dayNumber] {
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

    private func missedRow(_ entry: HistoryEntry) -> some View {
        HStack(spacing: 8) {
            // Date label
            Text(shortDateLabel(entry.date))
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 56, alignment: .trailing)
                .lineLimit(1)

            // Em-dash instead of day number
            Text("\u{2014}")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg3))
                .frame(width: 28, alignment: .trailing)

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

    // MARK: - Today Preview

    private var todayPreview: some View {
        let todayDuration = appVM.todayDuration

        return HStack(spacing: 8) {
            // Date label
            Text("today")
                .font(SPFont.mono(10))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 56, alignment: .trailing)

            // Day number
            Text("D\(appVM.currentDay)")
                .font(SPFont.mono(11, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 28, alignment: .trailing)

            // Proportional dashed bar
            GeometryReader { geo in
                let barFraction = vm.maxDuration > 0
                    ? CGFloat(todayDuration) / CGFloat(vm.maxDuration)
                    : 1.0
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

    /// Format "YYYY-MM-DD" → "Mon Mar 16" (short, fits mobile).
    private func shortDateLabel(_ isoDate: String) -> String {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        guard let date = df.date(from: isoDate) else { return isoDate }
        let out = DateFormatter()
        out.dateFormat = "EEE MMM d"
        return out.string(from: date)
    }
}
