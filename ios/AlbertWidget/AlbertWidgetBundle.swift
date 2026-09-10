import WidgetKit
import SwiftUI
import AppIntents

struct ImportantItemsProvider: TimelineProvider {
    func placeholder(in context: Context) -> ImportantEntry {
        ImportantEntry(date: Date(), state: WidgetState(items: [
            ImportantItem(
                id: "demo",
                title: "Take passport",
                priority: .critical,
                dueDate: Self.tomorrowString(),
                familyId: "demo"
            )
        ]))
    }

    func getSnapshot(in context: Context, completion: @escaping (ImportantEntry) -> Void) {
        completion(ImportantEntry(date: Date(), state: WidgetStateStore.shared.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ImportantEntry>) -> Void) {
        let state = WidgetStateStore.shared.load()
        let entry = ImportantEntry(date: Date(), state: state)
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private static func tomorrowString() -> String {
        let d = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
}

struct ImportantEntry: TimelineEntry {
    let date: Date
    let state: WidgetState
}

struct AlbertWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    var entry: ImportantEntry

    var body: some View {
        switch family {
        case .systemSmall:
            SmallImportantWidget(state: entry.state)
        case .systemMedium:
            MediumImportantWidget(state: entry.state)
        case .systemLarge:
            LargeImportantWidget(state: entry.state)
        case .accessoryRectangular, .accessoryInline, .accessoryCircular:
            LockScreenImportantWidget(state: entry.state, family: family)
        default:
            SmallImportantWidget(state: entry.state)
        }
    }
}

struct SmallImportantWidget: View {
    let state: WidgetState

    var body: some View {
        if let item = state.topItem {
            VStack(alignment: .leading, spacing: 6) {
                Label(item.priority.label, systemImage: item.priority.symbolName)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(item.priority == .critical ? .red : .orange)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Text(item.title)
                    .font(.headline)
                    .lineLimit(3)
                Text(NotificationScheduler.formatDue(item.dueDate))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .containerBackground(for: .widget) { Color(.systemBackground) }
            .widgetURL(item.deepLinkURL)
        } else {
            empty
        }
    }

    private var empty: some View {
        VStack(alignment: .leading) {
            Text("Albert")
                .font(.caption.weight(.bold))
            Spacer()
            Text("All clear")
                .font(.headline)
        }
        .containerBackground(for: .widget) { Color(.systemBackground) }
    }
}

struct MediumImportantWidget: View {
    let state: WidgetState

    var body: some View {
        let items = Array(state.items.prefix(3))
        VStack(alignment: .leading, spacing: 8) {
            Label("IMPORTANT", systemImage: "flame.fill")
                .font(.caption.weight(.bold))
                .foregroundStyle(.orange)
            if items.isEmpty {
                Text("All clear")
                    .font(.headline)
                Spacer()
            } else {
                ForEach(items) { item in
                    HStack {
                        Text(item.title)
                            .lineLimit(1)
                        Spacer()
                        Text(NotificationScheduler.formatDue(item.dueDate))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if !item.isCompleted {
                            Button(intent: CompleteImportantItemIntent(itemId: item.id)) {
                                Image(systemName: "checkmark.circle")
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .containerBackground(for: .widget) { Color(.systemBackground) }
        .widgetURL(items.first?.deepLinkURL)
    }
}

struct LargeImportantWidget: View {
    let state: WidgetState

    var body: some View {
        let items = Array(state.items.prefix(6))
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Albert")
                    .font(.headline)
                Spacer()
                if state.isStale {
                    Text("Offline")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            if items.isEmpty {
                Text("Nothing urgent right now.")
                    .foregroundStyle(.secondary)
                Spacer()
            } else {
                ForEach(items) { item in
                    HStack(alignment: .top) {
                        Image(systemName: item.priority.symbolName)
                            .foregroundStyle(item.priority == .critical ? .red : .orange)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title)
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(2)
                            Text("\(item.priority.label) · \(NotificationScheduler.formatDue(item.dueDate))")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(intent: CompleteImportantItemIntent(itemId: item.id)) {
                            Text("Done")
                                .font(.caption.weight(.semibold))
                        }
                        .buttonStyle(.bordered)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .containerBackground(for: .widget) { Color(.systemBackground) }
    }
}

struct LockScreenImportantWidget: View {
    let state: WidgetState
    let family: WidgetFamily

    var body: some View {
        let item = state.topItem
        switch family {
        case .accessoryInline:
            if let item {
                Label("\(item.title)", systemImage: "exclamationmark.circle")
            } else {
                Text("Albert · clear")
            }
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: item == nil ? "checkmark" : "exclamationmark")
            }
            .widgetURL(item?.deepLinkURL)
        default:
            if let item {
                VStack(alignment: .leading, spacing: 2) {
                    Text("🔴 \(item.title)")
                        .font(.headline)
                        .lineLimit(1)
                    Text(NotificationScheduler.formatDue(item.dueDate))
                        .font(.caption)
                }
                .widgetURL(item.deepLinkURL)
            } else {
                Text("Albert · all clear")
            }
        }
    }
}

@main
struct AlbertWidgetBundle: WidgetBundle {
    var body: some Widget {
        AlbertImportantWidget()
        AlbertLockScreenWidget()
    }
}

struct AlbertImportantWidget: Widget {
    let kind = "AlbertImportantWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ImportantItemsProvider()) { entry in
            AlbertWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Important")
        .description("Glance at Albert’s highest-priority items.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct AlbertLockScreenWidget: Widget {
    let kind = "AlbertLockScreenWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ImportantItemsProvider()) { entry in
            AlbertWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Don’t Forget")
        .description("Lock Screen glance for the top important item.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline, .accessoryCircular])
    }
}
