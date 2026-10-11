import LocalAuthentication
import SwiftUI

@MainActor
final class AppLock: ObservableObject {
    static let enabledKey = "faceIDLockEnabled"

    @Published var isUnlocked = false
    @Published private(set) var lastError: String?

    func unlock() async {
        let context = LAContext()
        var error: NSError?
        // Falls back to the device passcode when Face ID is unavailable or fails.
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            isUnlocked = true
            return
        }
        do {
            isUnlocked = try await context.evaluatePolicy(.deviceOwnerAuthentication,
                                                          localizedReason: "Unlock your Money app")
            lastError = nil
        } catch {
            isUnlocked = false
            lastError = "Not unlocked. Tap to try again."
        }
    }
}

struct LockView: View {
    @EnvironmentObject private var lock: AppLock

    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThickMaterial).ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(.tint)
                Text("Money is locked")
                    .font(.title2.bold())
                if let message = lock.lastError {
                    Text(message).foregroundStyle(.secondary)
                }
                Button {
                    Task { await lock.unlock() }
                } label: {
                    Label("Unlock", systemImage: "faceid")
                        .frame(maxWidth: 220)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            .padding()
        }
        .task { await lock.unlock() }
    }
}
