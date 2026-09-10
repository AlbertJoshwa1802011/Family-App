import AppIntents
import WidgetKit

/// Interactive widget / Shortcuts action: mark an Important Item done.
public struct CompleteImportantItemIntent: AppIntent {
    public static var title: LocalizedStringResource = "Complete Important Item"
    public static var description = IntentDescription("Marks an Albert important item as done.")
    /// Run in the host app so Keychain session access is reliable without
    /// requiring a team-prefixed keychain group at compile time.
    public static var openAppWhenRun: Bool = false

    @Parameter(title: "Item ID")
    public var itemId: String

    public init() {}

    public init(itemId: String) {
        self.itemId = itemId
    }

    public func perform() async throws -> some IntentResult {
        // Prefer local optimistic update + API using shared Keychain (entitlements).
        let ok = await SyncManager.shared.completeItem(id: itemId)
        WidgetCenter.shared.reloadAllTimelines()
        _ = ok
        return .result()
    }
}
