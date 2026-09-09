import Foundation

/// App-local cache for the Important Items screen (not the Keychain).
public final class LocalCache: @unchecked Sendable {
    public static let shared = LocalCache()

    private let fileURL: URL
    private let lock = NSLock()

    public init(fileURL: URL? = nil) {
        if let fileURL {
            self.fileURL = fileURL
        } else {
            let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            let folder = dir.appending(path: "Albert", directoryHint: .isDirectory)
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            self.fileURL = folder.appending(path: "important-items.json")
        }
    }

    public struct Snapshot: Codable, Equatable, Sendable {
        public var items: [ImportantItem]
        public var lastSyncAt: Date?
        public var activeFamilyId: String?

        public init(items: [ImportantItem] = [], lastSyncAt: Date? = nil, activeFamilyId: String? = nil) {
            self.items = items
            self.lastSyncAt = lastSyncAt
            self.activeFamilyId = activeFamilyId
        }
    }

    public func load() -> Snapshot {
        lock.lock()
        defer { lock.unlock() }
        guard let data = try? Data(contentsOf: fileURL) else {
            return Snapshot()
        }
        return (try? JSONDecoder().decode(Snapshot.self, from: data)) ?? Snapshot()
    }

    public func save(_ snapshot: Snapshot) {
        lock.lock()
        defer { lock.unlock() }
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: fileURL, options: [.atomic])
    }

    public func clear() {
        lock.lock()
        defer { lock.unlock() }
        try? FileManager.default.removeItem(at: fileURL)
    }
}

/// App Group shared state for WidgetKit — never contains credentials.
public final class WidgetStateStore: @unchecked Sendable {
    public static let shared = WidgetStateStore()

    public static let fileName = "widget-state.json"

    private let containerURL: URL?

    public init(appGroupID: String = AppConfig.appGroupID) {
        containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)
    }

    private var fileURL: URL? {
        containerURL?.appending(path: Self.fileName)
    }

    public func load() -> WidgetState {
        guard let fileURL,
              let data = try? Data(contentsOf: fileURL),
              let state = try? JSONDecoder().decode(WidgetState.self, from: data)
        else {
            return WidgetState()
        }
        return state
    }

    public func save(_ state: WidgetState) {
        guard let fileURL, let data = try? JSONEncoder().encode(state) else { return }
        try? data.write(to: fileURL, options: [.atomic])
    }

    public func clear() {
        guard let fileURL else { return }
        try? FileManager.default.removeItem(at: fileURL)
    }
}
