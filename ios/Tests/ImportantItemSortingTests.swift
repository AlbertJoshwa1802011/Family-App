import Foundation
import Testing
@testable import Albert

struct ImportantItemSortingTests {
    @Test func priorityThenDueDate() {
        let items = [
            ImportantItem(id: "1", title: "B", priority: .important, dueDate: "2026-09-10", familyId: "f"),
            ImportantItem(id: "2", title: "A", priority: .critical, dueDate: "2026-09-12", familyId: "f"),
            ImportantItem(id: "3", title: "C", priority: .critical, dueDate: "2026-09-11", familyId: "f"),
            ImportantItem(id: "4", title: "D", priority: .important, dueDate: nil, familyId: "f"),
        ]
        let sorted = ImportantItemSorting.sort(items).map(\.id)
        #expect(sorted == ["3", "2", "1", "4"])
    }

    @Test func activeFiltersCompleted() {
        let items = [
            ImportantItem(id: "1", title: "A", priority: .critical, isCompleted: true, familyId: "f"),
            ImportantItem(id: "2", title: "B", priority: .important, isCompleted: false, familyId: "f"),
        ]
        #expect(ImportantItemSorting.active(items).map(\.id) == ["2"])
    }

    @Test func emptyState() {
        #expect(ImportantItemSorting.active([]).isEmpty)
    }

    @Test func mapsTaskPriorities() {
        #expect(ImportantPriority.fromTaskPriority("high") == .critical)
        #expect(ImportantPriority.fromTaskPriority("medium") == .important)
        #expect(ImportantPriority.fromTaskPriority("low") == nil)
    }
}
