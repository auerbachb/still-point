import SwiftUI
import StillPointShared

struct PublicBoardView: View {
    let currentUsername: String?
    @State private var vm = BoardViewModel()

    var body: some View {
        ScrollView {
            VStack(spacing: SPSpacing.s5) {
                Text("Practitioners")
                    .font(SPFont.serifItalic(28, weight: .light))
                    .foregroundStyle(Color(SPColor.fg))
                    .padding(.top, SPSpacing.s4)

                Text("Not a competition — a community of people training attention together.")
                    .font(SPFont.serifItalic(15, weight: .light))
                    .foregroundStyle(Color(SPColor.fg4))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, SPSpacing.s3)

                // Board table
                if !vm.entries.isEmpty {
                    VStack(spacing: 0) {
                        // Header
                        boardRow(
                            rank: "#",
                            username: "USERNAME",
                            day: "DAY",
                            streak: "STREAK",
                            clear: "CLEAR",
                            isHeader: true,
                            isCurrentUser: false
                        )

                        ForEach(Array(vm.entries.enumerated()), id: \.element.username) { index, entry in
                            boardRow(
                                rank: "\(index + 1)",
                                username: entry.username,
                                day: "\(entry.currentDay)",
                                streak: "\(entry.streak)",
                                clear: "\(entry.avgClear)%",
                                isHeader: false,
                                isCurrentUser: entry.username == currentUsername,
                                isTopThree: index < 3
                            )
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(SPColor.border1)
                    )
                }

                if vm.entries.isEmpty && !vm.isLoading {
                    Text("No public practitioners yet")
                        .font(SPFont.serifItalic(15))
                        .foregroundStyle(Color(SPColor.fg4))
                        .padding(.top, SPSpacing.s6)
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

    private func boardRow(
        rank: String,
        username: String,
        day: String,
        streak: String,
        clear: String,
        isHeader: Bool,
        isCurrentUser: Bool,
        isTopThree: Bool = false
    ) -> some View {
        HStack(spacing: 0) {
            Text(rank)
                .frame(width: 32, alignment: .center)
                .foregroundStyle(isTopThree && !isHeader ? SPColor.amber : Color(SPColor.fg3))
            Text(isCurrentUser ? "\(username) (you)" : username)
                .frame(maxWidth: .infinity, alignment: .leading)
                .lineLimit(1)
                .truncationMode(.tail)
            Text(day)
                .frame(width: 44, alignment: .center)
            Text(streak)
                .frame(width: 50, alignment: .center)
            Text(clear)
                .frame(width: 50, alignment: .center)
                .foregroundStyle(isHeader ? Color(SPColor.fg4) : SPColor.greenText)
        }
        .font(isHeader ? SPFont.mono(10, weight: .medium) : SPFont.mono(12))
        .foregroundStyle(isHeader ? Color(SPColor.fg4) : Color(SPColor.fg2))
        .padding(.vertical, isHeader ? SPSpacing.s1 : SPSpacing.s2)
        .padding(.horizontal, SPSpacing.s2)
        .background(
            isCurrentUser ? SPColor.greenBgFaint :
            isHeader ? SPColor.surface2 :
            Color.clear
        )
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundStyle(SPColor.border1),
            alignment: .bottom
        )
    }
}
