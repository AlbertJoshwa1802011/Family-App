import SwiftData
import SwiftUI

@main
struct AlbertMoneyApp: App {
    @StateObject private var updates = UpdateChecker()
    @StateObject private var lock = AppLock()
    @AppStorage(AppLock.enabledKey) private var lockEnabled = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ZStack {
                HomeView()
                if lockEnabled && !lock.isUnlocked {
                    LockView()
                        .transition(.opacity)
                }
            }
            .environmentObject(updates)
            .environmentObject(lock)
            .task { await updates.check() }
            .onChange(of: scenePhase) { _, phase in
                switch phase {
                case .background:
                    lock.isUnlocked = false
                case .active:
                    Task { await updates.check() }
                default:
                    break
                }
            }
        }
        .modelContainer(for: Entry.self)
    }
}
