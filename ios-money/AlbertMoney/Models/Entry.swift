import Foundation
import SwiftData

enum EntryKind: String, Codable, CaseIterable, Identifiable {
    case expense
    case income

    var id: String { rawValue }
    var label: String { self == .expense ? "Expense" : "Income" }

    var categories: [String] {
        switch self {
        case .expense:
            return ["Food", "Groceries", "Transport", "Bills", "Rent", "Shopping",
                    "Health", "Education", "Church", "Family", "Travel", "Other"]
        case .income:
            return ["Salary", "Business", "Gift", "Refund", "Interest", "Other"]
        }
    }
}

@Model
final class Entry {
    var title: String = ""
    /// Integer minor units (cents/paise) so sums never drift like Double would.
    var amountCents: Int = 0
    var kindRaw: String = EntryKind.expense.rawValue
    var category: String = "Other"
    var date: Date = Date.now
    var note: String = ""

    init(title: String, amountCents: Int, kind: EntryKind, category: String, date: Date, note: String = "") {
        self.title = title
        self.amountCents = amountCents
        self.kindRaw = kind.rawValue
        self.category = category
        self.date = date
        self.note = note
    }

    var kind: EntryKind {
        get { EntryKind(rawValue: kindRaw) ?? .expense }
        set { kindRaw = newValue.rawValue }
    }

    var signedCents: Int { kind == .income ? amountCents : -amountCents }
}
