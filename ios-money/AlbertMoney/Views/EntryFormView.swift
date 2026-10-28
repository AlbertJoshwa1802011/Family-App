import SwiftData
import SwiftUI

struct EntryFormView: View {
    let entry: Entry?

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @AppStorage(Money.currencyKey) private var currency = Money.defaultCurrency

    @State private var kind: EntryKind = .expense
    @State private var title = ""
    @State private var amountText = ""
    @State private var category = "Other"
    @State private var date = Date.now
    @State private var note = ""
    @State private var confirmingDelete = false
    @FocusState private var amountFocused: Bool

    private var amountCents: Int? { Money.cents(from: amountText) }
    private var canSave: Bool {
        amountCents != nil && !title.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Type", selection: $kind) {
                        ForEach(EntryKind.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                Section("Amount (\(currency))") {
                    TextField("0", text: $amountText)
                        .keyboardType(.decimalPad)
                        .font(.system(size: 32, weight: .semibold, design: .rounded))
                        .focused($amountFocused)
                }

                Section {
                    TextField(kind == .expense ? "What was it for?" : "Where did it come from?", text: $title)
                    Picker("Category", selection: $category) {
                        ForEach(kind.categories, id: \.self) { Text($0).tag($0) }
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    TextField("Note (optional)", text: $note, axis: .vertical)
                        .lineLimit(1...4)
                }

                if entry != nil {
                    Section {
                        Button("Delete entry", role: .destructive) { confirmingDelete = true }
                    }
                }
            }
            .navigationTitle(entry == nil ? "New entry" : "Edit entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save).disabled(!canSave).bold()
                }
            }
            .onChange(of: kind) { _, newKind in
                if !newKind.categories.contains(category) { category = "Other" }
            }
            .confirmationDialog("Delete this entry?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    if let entry { context.delete(entry) }
                    dismiss()
                }
            }
            .onAppear(perform: load)
        }
    }

    private func load() {
        guard let entry else {
            amountFocused = true
            return
        }
        kind = entry.kind
        title = entry.title
        amountText = Money.inputString(from: entry.amountCents)
        category = entry.category
        date = entry.date
        note = entry.note
    }

    private func save() {
        guard let cents = amountCents else { return }
        let cleanTitle = title.trimmingCharacters(in: .whitespaces)
        let cleanNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if let entry {
            entry.kind = kind
            entry.title = cleanTitle
            entry.amountCents = cents
            entry.category = category
            entry.date = date
            entry.note = cleanNote
        } else {
            context.insert(Entry(title: cleanTitle, amountCents: cents, kind: kind,
                                 category: category, date: date, note: cleanNote))
        }
        dismiss()
    }
}
