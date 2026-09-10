import UIKit
import SwiftUI

struct ImportantItemsView: View {
    @EnvironmentObject private var session: SessionController
    @StateObject private var model = ImportantItemsModel()

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.items.isEmpty {
                    ProgressView("Loading…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = model.error, model.items.isEmpty {
                    ContentUnavailableView(
                        "Couldn’t load",
                        systemImage: "wifi.exclamationmark",
                        description: Text(error)
                    )
                } else if model.items.isEmpty {
                    ContentUnavailableView(
                        "All clear",
                        systemImage: "checkmark.seal",
                        description: Text("No open important items right now.")
                    )
                } else {
                    List {
                        if model.isStale {
                            Section {
                                Label("Showing cached items — offline or stale", systemImage: "icloud.slash")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        ForEach(grouped, id: \.priority) { group in
                            Section {
                                ForEach(group.items) { item in
                                    ImportantItemRow(
                                        item: item,
                                        onComplete: { await model.complete(item) },
                                        onOpen: { model.openInWeb(item) }
                                    )
                                }
                            } header: {
                                HStack(spacing: 6) {
                                    Image(systemName: group.priority.symbolName)
                                    Text(group.priority.label)
                                }
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(group.priority == .critical ? Color.red : Color.orange)
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Albert")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.refresh(force: true) }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(model.isLoading)
                }
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        if let user = session.user {
                            Text(user.email)
                        }
                        Button("Sign out", role: .destructive) {
                            Task { await session.logout() }
                        }
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                }
            }
            .refreshable { await model.refresh(force: true) }
            .task { await model.refresh(force: false) }
        }
    }

    private var grouped: [(priority: ImportantPriority, items: [ImportantItem])] {
        let active = ImportantItemSorting.active(model.items)
        return ImportantPriority.allCases.compactMap { priority in
            let items = active.filter { $0.priority == priority }
            return items.isEmpty ? nil : (priority, items)
        }
    }
}

struct ImportantItemRow: View {
    let item: ImportantItem
    let onComplete: () async -> Void
    let onOpen: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.body.weight(.semibold))
                    .strikethrough(item.isCompleted || item.pendingCompletion)
                Text(NotificationScheduler.formatDue(item.dueDate))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if item.pendingCompletion {
                    Text("Pending sync")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }
            Spacer()
            Button {
                onOpen()
            } label: {
                Image(systemName: "safari")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Open in Albert Web")

            Button {
                Task { await onComplete() }
            } label: {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Mark done")
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .onTapGesture { onOpen() }
    }
}

@MainActor
final class ImportantItemsModel: ObservableObject {
    @Published var items: [ImportantItem] = []
    @Published var isLoading = false
    @Published var isStale = false
    @Published var error: String?

    func refresh(force: Bool) async {
        isLoading = true
        defer { isLoading = false }
        let cached = LocalCache.shared.load()
        items = cached.items
        let result = await SyncManager.shared.sync(force: force)
        let latest = LocalCache.shared.load()
        items = latest.items
        switch result {
        case .success:
            isStale = false
            error = nil
        case .offline:
            isStale = true
            error = nil
        case .unauthorized:
            error = "Session expired — sign in again"
        case .failed(let message):
            if items.isEmpty { error = message }
        case .skipped:
            break
        }
    }

    func complete(_ item: ImportantItem) async {
        _ = await SyncManager.shared.completeItem(id: item.id)
        items = LocalCache.shared.load().items
    }

    func openInWeb(_ item: ImportantItem) {
        #if canImport(UIKit)
        UIApplication.shared.open(DeepLinkRouter.webURL(forTaskId: item.id))
        #endif
    }
}
