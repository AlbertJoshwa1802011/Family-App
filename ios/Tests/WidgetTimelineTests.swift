import Foundation
import Testing
@testable import Albert

struct WidgetTimelineTests {
    @Test func emptyState() {
        let state = WidgetState()
        #expect(state.topItem == nil)
        #expect(state.items.isEmpty)
    }

    @Test func oneItem() {
        let item = ImportantItem(id: "1", title: "Passport", priority: .critical, dueDate: "2026-09-10", familyId: "f")
        let state = WidgetState(items: [item])
        #expect(state.topItem?.title == "Passport")
    }

    @Test func multipleItemsPreferCritical() {
        let state = WidgetState(items: [
            ImportantItem(id: "1", title: "Call", priority: .important, dueDate: "2026-09-09", familyId: "f"),
            ImportantItem(id: "2", title: "Passport", priority: .critical, dueDate: "2026-09-11", familyId: "f"),
        ])
        #expect(state.topItem?.id == "2")
        #expect(state.items.count == 2)
    }

    @Test func overdueFormatting() {
        let text = NotificationScheduler.formatDue("2000-01-01")
        #expect(text.contains("Overdue"))
    }

    @Test func criticalLabel() {
        #expect(ImportantPriority.critical.label == "DON'T FORGET")
    }
}
