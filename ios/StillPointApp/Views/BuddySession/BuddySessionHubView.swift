import SwiftUI
import UIKit
import StillPointShared

struct BuddySessionHubView: View {
    let appVM: AppViewModel

    @State private var joinToken = ""
    @State private var createdPath: String?
    @State private var createdSessionId: String?
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var didCopy = false

    var body: some View {
        ScrollView {
            VStack(spacing: SPSpacing.s4) {
                Text("Meditate with a friend")
                    .font(SPFont.serifItalic(28, weight: .light))
                    .foregroundStyle(Color(SPColor.fg))
                    .multilineTextAlignment(.center)
                    .padding(.top, SPSpacing.s4)

                Text("Create a room, share the link, mark ready when both of you are set, then the host starts one shared timer.")
                    .font(SPFont.serif(16, weight: .light))
                    .foregroundStyle(Color(SPColor.fg2))
                    .multilineTextAlignment(.center)

                if let errorMessage {
                    Text(errorMessage)
                        .font(SPFont.mono(12))
                        .foregroundStyle(Color(SPColor.fg2))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, SPSpacing.s3)
                        .padding(.vertical, SPSpacing.s2)
                        .background(SPColor.surface1)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(SPColor.border2))
                }

                if let createdPath, let createdSessionId {
                    createdSessionSection(createdPath: createdPath, sessionId: createdSessionId)
                } else {
                    createOrJoinSection
                }

                Button {
                    withAnimation {
                        appVM.leaveBuddySession()
                    }
                } label: {
                    Text("Back to home")
                        .font(SPFont.mono(12, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg3))
                }
                .accessibilityIdentifier("buddy.backToHomeButton")
                .padding(.top, SPSpacing.s2)
            }
            .padding(.horizontal, SPSpacing.s4)
            .padding(.bottom, SPSpacing.s5)
        }
        .stillPointBackground()
        .onAppear {
            if let inviteError = appVM.buddyInviteError {
                errorMessage = inviteError
            }
        }
        .onChange(of: appVM.buddyInviteError) { _, newError in
            if let newError {
                errorMessage = newError
            }
        }
        .onDisappear {
            appVM.buddyInviteError = nil
        }
    }

    private var createOrJoinSection: some View {
        VStack(spacing: SPSpacing.s3) {
            Button {
                Task { await createSession() }
            } label: {
                Text("Start shared session")
                    .font(SPFont.serifItalic(20, weight: .light))
                    .foregroundStyle(Color(SPColor.bg))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, SPSpacing.s3)
                    .background(LinearGradient.greenHorizontal)
                    .clipShape(Capsule())
            }
            .disabled(busy)
            .opacity(busy ? 0.6 : 1)

            Divider()
                .background(SPColor.border1)
                .padding(.vertical, SPSpacing.s2)

            VStack(alignment: .leading, spacing: SPSpacing.s2) {
                Text("Join with link or token")
                    .font(SPFont.mono(11, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg4))
                    .tracking(2)

                TextEditor(text: $joinToken)
                    .font(SPFont.mono(13))
                    .frame(minHeight: 90)
                    .padding(SPSpacing.s1)
                    .background(SPColor.surface1)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(SPColor.border2))
                    .foregroundStyle(Color(SPColor.fg))

                Button {
                    Task { await joinSession() }
                } label: {
                    Text("Join session")
                        .font(SPFont.mono(12, weight: .medium))
                        .foregroundStyle(Color(SPColor.fg))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, SPSpacing.s2)
                        .background(SPColor.surface2)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(SPColor.border2))
                }
                .disabled(busy)
                .opacity(busy ? 0.6 : 1)
            }
        }
    }

    private func createdSessionSection(createdPath: String, sessionId: String) -> some View {
        VStack(alignment: .leading, spacing: SPSpacing.s3) {
            Text("Share this link with your friend (they must be signed in):")
                .font(SPFont.serif(15, weight: .light))
                .foregroundStyle(Color(SPColor.fg2))

            Text(fullLink(for: createdPath))
                .font(SPFont.mono(12))
                .foregroundStyle(Color(SPColor.fg))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(SPSpacing.s2)
                .background(SPColor.surface1)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(SPColor.border2))

            Button {
                copyLink(fullLink(for: createdPath))
            } label: {
                Text(didCopy ? "Copied" : "Copy link")
                    .font(SPFont.mono(11, weight: .medium))
                    .foregroundStyle(Color(SPColor.fg))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, SPSpacing.s2)
                    .background(SPColor.surface1)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(SPColor.border2))
            }

            Button {
                withAnimation {
                    appVM.enterBuddySession(sessionId: sessionId)
                }
            } label: {
                Text("Enter waiting room")
                    .font(SPFont.serifItalic(20, weight: .light))
                    .foregroundStyle(Color(SPColor.bg))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, SPSpacing.s3)
                    .background(LinearGradient.greenHorizontal)
                    .clipShape(Capsule())
            }
        }
    }

    private func createSession() async {
        busy = true
        errorMessage = nil
        defer { busy = false }

        do {
            let created = try await APIClient.shared.createBuddySession()
            createdPath = created.sharePath
            createdSessionId = created.id
            didCopy = false
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = "Could not create session."
        }
    }

    private func joinSession() async {
        busy = true
        errorMessage = nil
        defer { busy = false }

        let token = extractBuddyToken(joinToken)
        guard !token.isEmpty else {
            errorMessage = "Paste a full invite link or token."
            return
        }

        do {
            let sessionId = try await APIClient.shared.joinBuddySession(token: token)
            withAnimation {
                appVM.enterBuddySession(sessionId: sessionId)
            }
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = "Could not join session."
        }
    }

    private func extractBuddyToken(_ raw: String) -> String {
        BuddyInviteTokenParser.token(from: raw, allowRawFallback: true) ?? ""
    }

    private func fullLink(for sharePath: String) -> String {
        "https://still-point.me\(sharePath)"
    }

    private func copyLink(_ text: String) {
        UIPasteboard.general.string = text
        didCopy = true
    }
}
