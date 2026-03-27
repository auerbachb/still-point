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
                    VStack(alignment: .leading, spacing: SPSpacing.s2) {
                        Text("JOURNEY")
                            .font(SPFont.mono(11, weight: .medium))
                            .foregroundStyle(Color(SPColor.fg4))
                            .tracking(2)

                        ForEach(vm.sessions, id: \.id) { session in
                            sessionRow(session)
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

    @ViewBuilder
    private func sessionRow(_ session: SessionDTO) -> some View {
        let isExpanded = vm.expandedDay == session.dayNumber

        VStack(spacing: 0) {
            Button {
                Task { await vm.toggleDay(session.dayNumber) }
            } label: {
                HStack(spacing: SPSpacing.s2) {
                    Text("D\(session.dayNumber)")
                        .font(SPFont.mono(12, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg3))
                        .frame(width: 36, alignment: .leading)

                    // Stacked bar
                    GeometryReader { geo in
                        let clearWidth = geo.size.width * Double(session.clearPercent) / 100.0
                        let thinkWidth = geo.size.width - clearWidth

                        HStack(spacing: 0) {
                            Rectangle()
                                .fill(SPColor.green.opacity(0.6))
                                .frame(width: max(0, clearWidth))
                            Rectangle()
                                .fill(SPColor.amber.opacity(0.5))
                                .frame(width: max(0, thinkWidth))
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                    }
                    .frame(height: 16)

                    Text("\(session.clearPercent)%")
                        .font(SPFont.mono(11))
                        .foregroundStyle(SPColor.greenText)
                        .frame(width: 36, alignment: .trailing)
                }
                .padding(.vertical, SPSpacing.s1)
            }

            // Expanded thoughts
            if isExpanded, let thoughts = vm.dayThoughts[session.dayNumber] {
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
                .padding(.vertical, SPSpacing.s1)
            }
        }
    }

    private var todayPreview: some View {
        HStack(spacing: SPSpacing.s2) {
            Text("D\(appVM.currentDay)")
                .font(SPFont.mono(12, weight: .medium))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 36, alignment: .leading)

            RoundedRectangle(cornerRadius: 3)
                .stroke(SPColor.border2, style: StrokeStyle(lineWidth: 1, dash: [4]))
                .frame(height: 16)

            Text("\(appVM.todayDuration)s")
                .font(SPFont.mono(11))
                .foregroundStyle(Color(SPColor.fg4))
                .frame(width: 36, alignment: .trailing)
        }
        .padding(.vertical, SPSpacing.s1)
    }
}
