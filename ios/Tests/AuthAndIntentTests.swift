import Foundation
import Testing
@testable import Albert

struct CompleteIntentLogicTests {
    @Test func markCompleteLocallySetsPending() {
        let cache = LocalCache(fileURL: FileManager.default.temporaryDirectory
            .appending(path: "albert-test-\(UUID().uuidString).json"))
        let item = ImportantItem(
            id: "abc",
            title: "Passport",
            priority: .critical,
            dueDate: "2026-09-10",
            familyId: "fam"
        )
        cache.save(LocalCache.Snapshot(items: [item], lastSyncAt: Date(), activeFamilyId: "fam"))

        var snap = cache.load()
        if let idx = snap.items.firstIndex(where: { $0.id == "abc" }) {
            snap.items[idx].isCompleted = true
            snap.items[idx].pendingCompletion = true
        }
        cache.save(snap)

        let loaded = cache.load().items.first
        #expect(loaded?.isCompleted == true)
        #expect(loaded?.pendingCompletion == true)
    }
}

struct AuthSessionTests {
    @Test func keychainRoundTrip() throws {
        let store = KeychainStore()
        store.clearSessionToken()
        try store.saveSessionToken("22222222-2222-4222-8222-222222222222")
        #expect(store.readSessionToken() == "22222222-2222-4222-8222-222222222222")
        store.clearSessionToken()
        #expect(store.readSessionToken() == nil)
    }

    @Test func deepLinkOAuthAndTask() {
        let oauth = DeepLinkRouter.parse(URL(string: "albert://oauth-callback?code=abc")!)
        #expect(oauth == .oauthCallback(code: "abc", error: nil))

        let task = DeepLinkRouter.parse(URL(string: "albert://tasks/task-1")!)
        #expect(task == .task(id: "task-1"))

        let uni = DeepLinkRouter.parse(URL(string: "https://fam.connect-cloud.workers.dev/tasks/t9")!)
        #expect(uni == .task(id: "t9"))
    }
}
