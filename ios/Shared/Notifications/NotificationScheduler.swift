import Foundation
import UserNotifications

/// Schedules local notifications for critical Important Items only.
public final class NotificationScheduler: @unchecked Sendable {
    public static let shared = NotificationScheduler()

    public static let categoryId = "albert.important"

    public func requestAuthorization() async -> Bool {
        do {
            return try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            return false
        }
    }

    public func reschedule(for items: [ImportantItem]) {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()

        let critical = ImportantItemSorting.active(items).filter { $0.priority == .critical }
        for item in critical {
            guard let due = item.dueDate, let day = Self.parseDay(due) else { continue }
            schedule(
                id: "albert.due-soon.\(item.id)",
                title: "Albert",
                body: "⚠️ \(item.title) is due in 1 day.",
                at: day.addingTimeInterval(-24 * 3600).addingTimeInterval(9 * 3600),
                taskId: item.id
            )
            schedule(
                id: "albert.due-now.\(item.id)",
                title: "Albert",
                body: "🔴 \(item.title) is due now.",
                at: day.addingTimeInterval(9 * 3600),
                taskId: item.id
            )
            schedule(
                id: "albert.overdue.\(item.id)",
                title: "Albert",
                body: "⚠️ \(item.title) is overdue.",
                at: day.addingTimeInterval(24 * 3600 + 9 * 3600),
                taskId: item.id
            )
        }
    }

    private func schedule(id: String, title: String, body: String, at date: Date, taskId: String) {
        guard date > Date() else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.categoryIdentifier = Self.categoryId
        content.userInfo = ["deepLink": "albert://tasks/\(taskId)"]

        let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
        let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
    }

    public static func parseDay(_ yyyyMmDd: String) -> Date? {
        let parts = yyyyMmDd.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var comps = DateComponents()
        comps.year = parts[0]
        comps.month = parts[1]
        comps.day = parts[2]
        comps.hour = 0
        comps.minute = 0
        return Calendar.current.date(from: comps)
    }

    public static func formatDue(_ yyyyMmDd: String?, relativeTo now: Date = Date()) -> String {
        guard let yyyyMmDd, let day = parseDay(yyyyMmDd) else { return "No due date" }
        let cal = Calendar.current
        if cal.isDateInToday(day) { return "Today" }
        if cal.isDateInTomorrow(day) { return "Tomorrow" }
        if day < cal.startOfDay(for: now) { return "Overdue · \(yyyyMmDd)" }
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        return formatter.string(from: day)
    }
}
