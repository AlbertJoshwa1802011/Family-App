import Foundation

/// Priority as shown on native surfaces. Maps from backend task priority.
public enum ImportantPriority: String, Codable, CaseIterable, Sendable {
    case critical
    case important

    public var label: String {
        switch self {
        case .critical: return "DON'T FORGET"
        case .important: return "IMPORTANT"
        }
    }

    public var symbolName: String {
        switch self {
        case .critical: return "exclamationmark.circle.fill"
        case .important: return "flame.fill"
        }
    }

    public var sortRank: Int {
        switch self {
        case .critical: return 0
        case .important: return 1
        }
    }

    /// Backend `tasks.priority` → companion priority. `low` is omitted.
    public static func fromTaskPriority(_ raw: String) -> ImportantPriority? {
        switch raw {
        case "high": return .critical
        case "medium": return .important
        default: return nil
        }
    }

    public var taskPriority: String {
        switch self {
        case .critical: return "high"
        case .important: return "medium"
        }
    }
}

/// Glanceable “Don't Forget” item — mapped from Family Vault tasks.
public struct ImportantItem: Identifiable, Codable, Equatable, Sendable, Hashable {
    public let id: String
    public var title: String
    public var priority: ImportantPriority
    /// ISO `yyyy-mm-dd` or nil.
    public var dueDate: String?
    public var isCompleted: Bool
    public var pendingCompletion: Bool
    public var familyId: String
    public var lastSyncedAt: Date?

    public init(
        id: String,
        title: String,
        priority: ImportantPriority,
        dueDate: String? = nil,
        isCompleted: Bool = false,
        pendingCompletion: Bool = false,
        familyId: String,
        lastSyncedAt: Date? = nil
    ) {
        self.id = id
        self.title = title
        self.priority = priority
        self.dueDate = dueDate
        self.isCompleted = isCompleted
        self.pendingCompletion = pendingCompletion
        self.familyId = familyId
        self.lastSyncedAt = lastSyncedAt
    }

    public var webPath: String { "/tasks/\(id)" }

    public var webURL: URL {
        AppConfig.apiBaseURL.appending(path: "tasks").appending(path: id)
    }

    public var deepLinkURL: URL {
        URL(string: "\(AppConfig.urlScheme)://tasks/\(id)")!
    }
}

public enum ImportantItemSorting {
    /// Critical first, then important; within a band, earlier due dates first; undated last.
    public static func sort(_ items: [ImportantItem]) -> [ImportantItem] {
        items.sorted { a, b in
            if a.priority.sortRank != b.priority.sortRank {
                return a.priority.sortRank < b.priority.sortRank
            }
            switch (a.dueDate, b.dueDate) {
            case let (ad?, bd?):
                if ad != bd { return ad < bd }
            case (_?, nil):
                return true
            case (nil, _?):
                return false
            case (nil, nil):
                break
            }
            return a.title.localizedCaseInsensitiveCompare(b.title) == .orderedAscending
        }
    }

    public static func active(_ items: [ImportantItem]) -> [ImportantItem] {
        sort(items.filter { !$0.isCompleted })
    }
}

/// Payload shared with WidgetKit via App Group (no secrets).
public struct WidgetState: Codable, Equatable, Sendable {
    public var items: [ImportantItem]
    public var lastSyncAt: Date?
    public var isStale: Bool

    public init(items: [ImportantItem] = [], lastSyncAt: Date? = nil, isStale: Bool = false) {
        self.items = ImportantItemSorting.active(items)
        self.lastSyncAt = lastSyncAt
        self.isStale = isStale
    }

    public var topItem: ImportantItem? { items.first }
}
