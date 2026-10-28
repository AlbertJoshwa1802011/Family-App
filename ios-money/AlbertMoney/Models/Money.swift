import Foundation

enum Money {
    static let currencyKey = "currencyCode"
    static let supportedCurrencies = ["INR", "USD", "EUR", "GBP", "AED", "CAD", "AUD", "SGD"]

    static var defaultCurrency: String {
        let local = Locale.current.currency?.identifier ?? "INR"
        return supportedCurrencies.contains(local) ? local : "INR"
    }

    static func format(_ cents: Int, code: String) -> String {
        (Decimal(cents) / 100).formatted(.currency(code: code))
    }

    /// Parses user input like "1,250.50" or "99" into minor units. Returns nil for zero/invalid.
    static func cents(from text: String) -> Int? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        let separator = Locale.current.decimalSeparator ?? "."
        var normalized = trimmed
        if separator == "," {
            normalized = normalized.replacingOccurrences(of: ".", with: "")
                .replacingOccurrences(of: ",", with: ".")
        } else {
            normalized = normalized.replacingOccurrences(of: ",", with: "")
        }
        guard let value = Decimal(string: normalized), value > 0 else { return nil }
        var scaled = value * 100
        var rounded = Decimal()
        NSDecimalRound(&rounded, &scaled, 0, .plain)
        return NSDecimalNumber(decimal: rounded).intValue
    }

    static func inputString(from cents: Int) -> String {
        let value = Decimal(cents) / 100
        return value.formatted(.number.precision(.fractionLength(0...2)).grouping(.never))
    }
}
