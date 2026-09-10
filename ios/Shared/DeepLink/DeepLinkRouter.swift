import Foundation

public enum DeepLinkRouter {
    public enum Destination: Equatable, Sendable {
        case importantList
        case task(id: String)
        case oauthCallback(code: String?, error: String?)
        case web(URL)
    }

    public static func parse(_ url: URL) -> Destination {
        if url.scheme == AppConfig.urlScheme {
            if url.host == "oauth-callback" {
                let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
                let code = items?.first(where: { $0.name == "code" })?.value
                let error = items?.first(where: { $0.name == "error" })?.value
                return .oauthCallback(code: code, error: error)
            }
            if url.host == "tasks", let id = url.pathComponents.dropFirst().first {
                return .task(id: String(id))
            }
            return .importantList
        }

        // Universal Link: https://…/tasks/:id
        if url.path.hasPrefix("/tasks/") {
            let id = url.lastPathComponent
            if !id.isEmpty { return .task(id: id) }
        }
        return .web(url)
    }

    public static func webURL(forTaskId id: String) -> URL {
        AppConfig.apiBaseURL.appending(path: "tasks").appending(path: id)
    }
}
