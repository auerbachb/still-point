import SwiftUI
import StillPointShared

struct BuddyWaitingRoomView: View {
    @Bindable var vm: BuddySessionViewModel
    let onExit: () -> Void

    @State private var isUpdatingReady = false
    @State private var myReady = false

    var body: some View {
        ScrollView {
            VStack(spacing: SPSpacing.s4) {
                Text("Shared session")
                    .font(SPFont.serifItalic(28, weight: .light))
                    .foregroundStyle(Color(SPColor.fg))
                    .padding(.top, SPSpacing.s4)

                if let pollError = vm.pollError {
                    Text(pollError)
                        .font(SPFont.mono(12))
                        .foregroundStyle(Color(SPColor.fg2))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, SPSpacing.s4)
                }

                if let actionError = vm.actionError {
                    Text(actionError)
                        .font(SPFont.mono(12))
                        .foregroundStyle(Color(SPColor.fg2))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, SPSpacing.s4)
                }

                waitingStatusCard
                participantsList

                if let me = meParticipant {
                    Toggle(isOn: Binding(
                        get: { me.ready || myReady },
                        set: { newValue in
                            myReady = newValue
                            Task {
                                isUpdatingReady = true
                                await vm.setReady(newValue)
                                await MainActor.run {
                                    isUpdatingReady = false
                                }
                            }
                        }
                    )) {
                        Text("I'm ready")
                            .font(SPFont.serifItalic(20, weight: .light))
                            .foregroundStyle(Color(SPColor.fg))
                    }
                    .toggleStyle(.switch)
                    .tint(SPColor.green)
                    .padding(.horizontal, SPSpacing.s4)
                    .padding(.vertical, SPSpacing.s3)
                    .background((me.ready || myReady) ? SPColor.greenBgFaint : SPColor.surface1)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke((me.ready || myReady) ? SPColor.greenBorder : SPColor.border2)
                    )
                    .padding(.horizontal, SPSpacing.s4)
                    .disabled(isUpdatingReady)
                }

                if vm.isHost {
                    VStack(spacing: SPSpacing.s2) {
                        Button {
                            Task { await vm.startSession() }
                        } label: {
                            Text("Start for everyone")
                                .font(SPFont.serifItalic(19, weight: .light))
                                .foregroundStyle(Color(SPColor.bg))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, SPSpacing.s3)
                                .background(
                                    snapshot?.state == "ready_check" ? LinearGradient.greenHorizontal : LinearGradient(
                                        colors: [SPColor.surface2, SPColor.surface2],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                                .clipShape(Capsule())
                        }
                        .disabled(snapshot?.state != "ready_check")
                        .opacity(snapshot?.state == "ready_check" ? 1 : 0.45)

                        Button {
                            Task {
                                await vm.cancelSession()
                                onExit()
                            }
                        } label: {
                            Text("Cancel session")
                                .font(SPFont.mono(11, weight: .medium))
                                .foregroundStyle(Color(SPColor.fg3))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, SPSpacing.s2)
                                .background(SPColor.surface1)
                                .clipShape(Capsule())
                                .overlay(Capsule().stroke(SPColor.border2))
                        }
                    }
                    .padding(.horizontal, SPSpacing.s4)
                } else {
                    Text("Only the host can start or cancel the shared session.")
                        .font(SPFont.mono(11))
                        .foregroundStyle(Color(SPColor.fg4))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, SPSpacing.s4)
                }

                Button {
                    Task {
                        _ = await vm.leaveSession()
                        onExit()
                    }
                } label: {
                    Text("Leave")
                        .font(SPFont.mono(11, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg3))
                        .padding(.horizontal, SPSpacing.s3)
                        .padding(.vertical, SPSpacing.s2)
                        .background(SPColor.surface1)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SPColor.border2))
                }
                .padding(.bottom, SPSpacing.s5)
            }
            .padding(.horizontal, SPSpacing.s3)
        }
        .stillPointBackground()
        .onAppear {
            if let me = meParticipant {
                myReady = me.ready
            }
        }
        .onChange(of: meParticipant?.ready) { _, newValue in
            if let newValue {
                myReady = newValue
            }
        }
    }

    private var snapshot: BuddySnapshotDTO? { vm.snapshot }

    private var activeParticipants: [BuddyParticipantDTO] {
        snapshot?.participants.filter { $0.leftAt == nil } ?? []
    }

    private var meParticipant: BuddyParticipantDTO? {
        activeParticipants.first(where: { $0.userId == vm.currentUserId })
    }

    private var waitingStatusCard: some View {
        let isReadyCheck = snapshot?.state == "ready_check"
        return Text(isReadyCheck ? "Everyone is ready — host can start." : "Waiting for everyone to join and mark ready.")
            .font(SPFont.mono(14))
            .foregroundStyle(isReadyCheck ? SPColor.greenText : Color(SPColor.fg2))
            .multilineTextAlignment(.center)
            .padding(.horizontal, SPSpacing.s4)
            .padding(.vertical, SPSpacing.s4)
            .frame(maxWidth: .infinity)
            .background(isReadyCheck ? SPColor.greenBgSubtle : SPColor.surface1)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(isReadyCheck ? SPColor.greenBorder : SPColor.border2, lineWidth: isReadyCheck ? 2 : 1)
            )
            .padding(.horizontal, SPSpacing.s4)
    }

    private var participantsList: some View {
        VStack(spacing: SPSpacing.s2) {
            ForEach(activeParticipants, id: \.userId) { participant in
                HStack(spacing: SPSpacing.s2) {
                    Text(participant.username + (participant.isHost ? " · host" : ""))
                        .font(SPFont.serifItalic(18, weight: .light))
                        .foregroundStyle(Color(SPColor.fg))
                    Spacer()
                    Circle()
                        .fill(participant.connected ? SPColor.green : SPColor.fg4)
                        .frame(width: 10, height: 10)
                    Text(participant.connected ? "online" : "away")
                        .font(SPFont.mono(11))
                        .foregroundStyle(Color(SPColor.fg3))
                    if participant.ready {
                        Text("· ready")
                            .font(SPFont.mono(11))
                            .foregroundStyle(SPColor.greenText)
                    }
                }
                .padding(.horizontal, SPSpacing.s3)
                .padding(.vertical, SPSpacing.s3)
                .background(SPColor.surface1)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(
                    RoundedRectangle(cornerRadius: 14).stroke(SPColor.border2)
                )
            }
        }
        .padding(.horizontal, SPSpacing.s4)
    }
}
