import SwiftUI
import AuthenticationServices

struct SignInView: View {
    @EnvironmentObject private var session: SessionController

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.07, green: 0.10, blue: 0.18),
                    Color(red: 0.12, green: 0.16, blue: 0.28),
                    Color(red: 0.08, green: 0.22, blue: 0.28),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 28) {
                Spacer()
                VStack(spacing: 10) {
                    Text("Albert")
                        .font(.system(size: 48, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    Text("Don’t forget what matters.")
                        .font(.title3)
                        .foregroundStyle(.white.opacity(0.78))
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 28)

                Spacer()

                VStack(spacing: 12) {
                    Button {
                        session.signIn()
                    } label: {
                        HStack {
                            Image(systemName: "person.crop.circle.badge.checkmark")
                            Text(session.isBusy ? "Opening Google…" : "Continue with Albert")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color(red: 0.20, green: 0.55, blue: 0.62))
                    .disabled(session.isBusy)

                    Text("Uses your existing Albert (Family Vault) Google sign-in. Albert never asks for your Google password.")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.55))
                        .multilineTextAlignment(.center)

                    if let authError = session.authError {
                        Text(authError)
                            .font(.footnote)
                            .foregroundStyle(.orange)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 36)
            }
        }
    }
}
