import Foundation

/// Shape of `public/ios-money/version.json`, served by the Family Vault Worker.
struct UpdateInfo: Decodable, Equatable {
    let latestVersion: String
    let notes: String?
    let updateURL: URL
}

@MainActor
final class UpdateChecker: ObservableObject {
    enum Status: Equatable {
        case idle
        case checking
        case upToDate
        case available(UpdateInfo)
        case failed(String)
    }

    static let manifestURL = URL(string: "https://fam.connect-cloud.workers.dev/ios-money/version.json")!
    private static let automaticInterval: TimeInterval = 6 * 60 * 60

    @Published private(set) var status: Status = .idle
    private var lastCheck: Date?

    static var currentVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    }

    static var currentBuild: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
    }

    var available: UpdateInfo? {
        if case .available(let info) = status { return info }
        return nil
    }

    /// Automatic checks are throttled; pass `force: true` from the "Check for updates" button.
    func check(force: Bool = false) async {
        if status == .checking { return }
        if !force, let lastCheck, Date.now.timeIntervalSince(lastCheck) < Self.automaticInterval { return }

        status = .checking
        lastCheck = .now
        let request = URLRequest(url: Self.manifestURL,
                                 cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: 15)
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                status = .failed("The update server didn't respond. Try again later.")
                return
            }
            let info = try JSONDecoder().decode(UpdateInfo.self, from: data)
            status = Self.isVersion(info.latestVersion, newerThan: Self.currentVersion)
                ? .available(info)
                : .upToDate
        } catch {
            status = .failed("Couldn't check for updates. Check your internet connection.")
        }
    }

    nonisolated static func isVersion(_ candidate: String, newerThan current: String) -> Bool {
        let a = candidate.split(separator: ".").map { Int($0) ?? 0 }
        let b = current.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(a.count, b.count) {
            let x = i < a.count ? a[i] : 0
            let y = i < b.count ? b[i] : 0
            if x != y { return x > y }
        }
        return false
    }
}
