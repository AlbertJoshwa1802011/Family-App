import SwiftData
import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var updates: UpdateChecker
    @EnvironmentObject private var lock: AppLock
    @AppStorage(Money.currencyKey) private var currency = Money.defaultCurrency
    @AppStorage(AppLock.enabledKey) private var lockEnabled = false
    @State private var confirmingErase = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Preferences") {
                    Picker("Currency", selection: $currency) {
                        ForEach(Money.supportedCurrencies, id: \.self) { Text($0).tag($0) }
                    }
                    Toggle("Lock with Face ID", isOn: $lockEnabled)
                        .onChange(of: lockEnabled) { _, enabled in
                            if enabled { lock.isUnlocked = true }
                        }
                }

                Section {
                    LabeledContent("Version", value: "\(UpdateChecker.currentVersion) (\(UpdateChecker.currentBuild))")
                    updateRow
                    Button {
                        Task { await updates.check(force: true) }
                    } label: {
                        HStack {
                            Text("Check for updates")
                            Spacer()
                            if updates.status == .checking { ProgressView() }
                        }
                    }
                    .disabled(updates.status == .checking)
                } header: {
                    Text("App updates")
                } footer: {
                    Text("Updates are delivered through TestFlight. Tapping Update opens TestFlight so you can install the newest build.")
                }

                Section {
                    Button("Erase all entries", role: .destructive) { confirmingErase = true }
                } footer: {
                    Text("Your entries are stored only on this iPhone.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Erase every entry? This can't be undone.",
                                isPresented: $confirmingErase, titleVisibility: .visible) {
                Button("Erase all", role: .destructive) {
                    try? context.delete(model: Entry.self)
                }
            }
        }
    }

    @ViewBuilder
    private var updateRow: some View {
        switch updates.status {
        case .available(let info):
            VStack(alignment: .leading, spacing: 8) {
                Label("Version \(info.latestVersion) is available", systemImage: "arrow.down.app.fill")
                    .foregroundStyle(.tint)
                if let notes = info.notes, !notes.isEmpty {
                    Text(notes).font(.footnote).foregroundStyle(.secondary)
                }
                Button("Update now") { openURL(info.updateURL) }
                    .buttonStyle(.borderedProminent)
            }
            .padding(.vertical, 4)
        case .upToDate:
            Label("You're on the latest version", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
        case .idle, .checking:
            EmptyView()
        }
    }
}
