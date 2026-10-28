import SwiftData
import SwiftUI

struct HomeView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var updates: UpdateChecker
    @Query(sort: \Entry.date, order: .reverse) private var entries: [Entry]
    @AppStorage(Money.currencyKey) private var currency = Money.defaultCurrency

    @State private var showingAdd = false
    @State private var showingSettings = false
    @State private var editing: Entry?

    var body: some View {
        NavigationStack {
            List {
                if let info = updates.available {
                    Section { UpdateBanner(info: info) }
                }

                Section { SummaryCard(entries: entries, currency: currency) }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)

                if entries.isEmpty {
                    ContentUnavailableView {
                        Label("No entries yet", systemImage: "banknote")
                    } description: {
                        Text("Tap + to record your first expense or income.")
                    }
                } else {
                    ForEach(monthSections, id: \.start) { section in
                        Section(section.start.formatted(.dateTime.month(.wide).year())) {
                            ForEach(section.entries) { entry in
                                Button { editing = entry } label: {
                                    EntryRow(entry: entry, currency: currency)
                                }
                                .buttonStyle(.plain)
                            }
                            .onDelete { offsets in
                                for index in offsets { context.delete(section.entries[index]) }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Money")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showingSettings = true } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Settings")
                    .overlay(alignment: .topTrailing) {
                        if updates.available != nil {
                            Circle().fill(.red).frame(width: 8, height: 8).offset(x: 4, y: -2)
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingAdd = true } label: {
                        Image(systemName: "plus.circle.fill").font(.title2)
                    }
                    .accessibilityLabel("Add entry")
                }
            }
            .sheet(isPresented: $showingAdd) { EntryFormView(entry: nil) }
            .sheet(item: $editing) { EntryFormView(entry: $0) }
            .sheet(isPresented: $showingSettings) { SettingsView() }
        }
    }

    private var monthSections: [(start: Date, entries: [Entry])] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: entries) {
            calendar.dateInterval(of: .month, for: $0.date)?.start ?? $0.date
        }
        return grouped
            .map { (start: $0.key, entries: $0.value.sorted { $0.date > $1.date }) }
            .sorted { $0.start > $1.start }
    }
}

private struct SummaryCard: View {
    let entries: [Entry]
    let currency: String

    var body: some View {
        let monthStart = Calendar.current.dateInterval(of: .month, for: .now)?.start ?? .now
        let thisMonth = entries.filter { $0.date >= monthStart }
        let income = thisMonth.filter { $0.kind == .income }.reduce(0) { $0 + $1.amountCents }
        let spent = thisMonth.filter { $0.kind == .expense }.reduce(0) { $0 + $1.amountCents }
        let balance = entries.reduce(0) { $0 + $1.signedCents }

        VStack(alignment: .leading, spacing: 14) {
            Text("Balance").font(.subheadline).foregroundStyle(.white.opacity(0.8))
            Text(Money.format(balance, code: currency))
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            HStack {
                stat("This month in", income, "arrow.down.left")
                Spacer()
                stat("This month out", spent, "arrow.up.right")
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [.indigo, .teal], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 22, style: .continuous)
        )
        .padding(.vertical, 4)
    }

    private func stat(_ title: String, _ cents: Int, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(title, systemImage: icon).font(.caption).foregroundStyle(.white.opacity(0.8))
            Text(Money.format(cents, code: currency)).font(.headline).foregroundStyle(.white)
        }
    }
}

private struct EntryRow: View {
    let entry: Entry
    let currency: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: entry.kind == .income ? "arrow.down.left.circle.fill" : "arrow.up.right.circle.fill")
                .font(.title2)
                .foregroundStyle(entry.kind == .income ? .green : .orange)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title).font(.body.weight(.medium)).lineLimit(1)
                Text("\(entry.category) · \(entry.date.formatted(date: .abbreviated, time: .omitted))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text((entry.kind == .income ? "+" : "−") + Money.format(entry.amountCents, code: currency))
                .font(.body.monospacedDigit().weight(.semibold))
                .foregroundStyle(entry.kind == .income ? .green : .primary)
        }
        .contentShape(Rectangle())
    }
}

struct UpdateBanner: View {
    let info: UpdateInfo
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "arrow.down.app.fill").font(.title2).foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 2) {
                Text("Update available · v\(info.latestVersion)").font(.subheadline.bold())
                if let notes = info.notes, !notes.isEmpty {
                    Text(notes).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer()
            Button("Update") { openURL(info.updateURL) }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        }
    }
}
