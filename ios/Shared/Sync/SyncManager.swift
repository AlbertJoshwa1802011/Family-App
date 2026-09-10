import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Fetches Important Items, updates local + widget caches, reconciles pending completions.
public actor SyncManager {
    public static let shared = SyncManager()

    private let api: AlbertAPIClient
    private let cache: LocalCache
    private let widgetStore: WidgetStateStore
    private var lastAttempt: Date?
    private let minInterval: TimeInterval = 15

    public enum SyncResult: Equatable, Sendable {
        case success(count: Int, at: Date)
        case offline(cachedCount: Int)
        case unauthorized
        case failed(message: String)
        case skipped
    }

    public init(
        api: AlbertAPIClient = .shared,
        cache: LocalCache = .shared,
        widgetStore: WidgetStateStore = .shared
    ) {
        self.api = api
        self.cache = cache
        self.widgetStore = widgetStore
    }

    @discardableResult
    public func sync(force: Bool = false) async -> SyncResult {
        if !force, let lastAttempt, Date().timeIntervalSince(lastAttempt) < minInterval {
            return .skipped
        }
        lastAttempt = Date()

        guard await api.hasSession() else {
            return .unauthorized
        }

        do {
            let me = try await api.getCurrentUser()
            guard let user = me.user else { return .unauthorized }
            _ = user
            guard let family = me.families.first else {
                let empty = LocalCache.Snapshot(items: [], lastSyncAt: Date(), activeFamilyId: nil)
                cache.save(empty)
                publishWidget(from: empty, stale: false)
                return .success(count: 0, at: Date())
            }

            var remote = try await api.getImportantItems(familyId: family.id)
            let previous = cache.load()

            // Reconcile offline "Done" taps that never reached the server.
            let pendingIds = Set(previous.items.filter(\.pendingCompletion).map(\.id))
            for id in pendingIds {
                do {
                    try await api.completeImportantItem(id: id)
                    if let idx = remote.firstIndex(where: { $0.id == id }) {
                        remote[idx].isCompleted = true
                        remote[idx].pendingCompletion = false
                    }
                } catch AlbertAPIError.networkUnavailable {
                    // Keep pending flag locally.
                    if let idx = remote.firstIndex(where: { $0.id == id }) {
                        remote[idx].pendingCompletion = true
                        remote[idx].isCompleted = true
                    } else if let local = previous.items.first(where: { $0.id == id }) {
                        remote.append(local)
                    }
                } catch {
                    // Leave pending; next sync retries.
                    if let idx = remote.firstIndex(where: { $0.id == id }) {
                        remote[idx].pendingCompletion = true
                    }
                }
            }

            let snapshot = LocalCache.Snapshot(
                items: ImportantItemSorting.sort(remote),
                lastSyncAt: Date(),
                activeFamilyId: family.id
            )
            cache.save(snapshot)
            publishWidget(from: snapshot, stale: false)
            NotificationScheduler.shared.reschedule(for: snapshot.items)
            return .success(count: ImportantItemSorting.active(snapshot.items).count, at: snapshot.lastSyncAt!)
        } catch AlbertAPIError.unauthorized {
            return .unauthorized
        } catch AlbertAPIError.networkUnavailable {
            let cached = cache.load()
            publishWidget(from: cached, stale: true)
            return .offline(cachedCount: ImportantItemSorting.active(cached.items).count)
        } catch {
            return .failed(message: "Couldn’t refresh")
        }
    }

    public func markCompleteLocally(id: String) {
        var snapshot = cache.load()
        if let idx = snapshot.items.firstIndex(where: { $0.id == id }) {
            snapshot.items[idx].isCompleted = true
            snapshot.items[idx].pendingCompletion = true
        }
        cache.save(snapshot)
        publishWidget(from: snapshot, stale: false)
        NotificationScheduler.shared.reschedule(for: snapshot.items)
    }

    public func completeItem(id: String) async -> Bool {
        markCompleteLocally(id: id)
        do {
            try await api.completeImportantItem(id: id)
            var snapshot = cache.load()
            if let idx = snapshot.items.firstIndex(where: { $0.id == id }) {
                snapshot.items[idx].pendingCompletion = false
                snapshot.items[idx].isCompleted = true
            }
            cache.save(snapshot)
            publishWidget(from: snapshot, stale: false)
            return true
        } catch AlbertAPIError.networkUnavailable {
            // Pending state retained for next sync.
            return false
        } catch {
            return false
        }
    }

    private func publishWidget(from snapshot: LocalCache.Snapshot, stale: Bool) {
        let state = WidgetState(
            items: snapshot.items,
            lastSyncAt: snapshot.lastSyncAt,
            isStale: stale
        )
        widgetStore.save(state)
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}
