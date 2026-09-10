import Foundation

public struct AlbertUser: Codable, Equatable, Sendable {
    public let id: String
    public let email: String
    public let name: String?
    public let picture: String?
}

public struct AlbertFamily: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let role: String
}

public struct MeResponse: Codable, Equatable, Sendable {
    public let user: AlbertUser?
    public let families: [AlbertFamily]
}

public struct MobileExchangeResponse: Codable, Equatable, Sendable {
    public let sessionToken: String
    public let expiresAt: Int
    public let user: AlbertUser
    public let families: [AlbertFamily]
}

struct TaskListResponse: Codable, Sendable {
    let tasks: [TaskDTO]
}

struct TaskDTO: Codable, Sendable {
    let id: String
    let familyId: String
    let title: String
    let dueDate: String?
    let status: String
    let priority: String
}

struct TaskEnvelope: Codable, Sendable {
    let task: TaskDTO
}

public enum AlbertAPIError: Error, Equatable, Sendable {
    case unauthorized
    case server(status: Int)
    case malformedResponse
    case networkUnavailable
    case invalidCode
    case validation
    case message(String)
}

/// Thin HTTP client for Albert’s existing Worker APIs.
public actor AlbertAPIClient {
    public static let shared = AlbertAPIClient()

    private let session: URLSession
    private let baseURL: URL
    private let keychain: KeychainStore

    public init(
        baseURL: URL = AppConfig.apiBaseURL,
        session: URLSession = .shared,
        keychain: KeychainStore = .shared
    ) {
        self.baseURL = baseURL
        self.session = session
        self.keychain = keychain
    }

    public func authenticate(code: String) async throws -> MobileExchangeResponse {
        let body = try JSONEncoder().encode(["code": code])
        var req = URLRequest(url: baseURL.appending(path: "api/auth/mobile/exchange"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        let (data, response) = try await perform(req, authed: false)
        guard let http = response as? HTTPURLResponse else { throw AlbertAPIError.malformedResponse }
        if http.statusCode == 401 {
            throw AlbertAPIError.invalidCode
        }
        if http.statusCode == 400 {
            throw AlbertAPIError.validation
        }
        guard (200..<300).contains(http.statusCode) else {
            throw AlbertAPIError.server(status: http.statusCode)
        }
        do {
            let decoded = try JSONDecoder().decode(MobileExchangeResponse.self, from: data)
            try keychain.saveSessionToken(decoded.sessionToken)
            return decoded
        } catch is DecodingError {
            throw AlbertAPIError.malformedResponse
        }
    }

    public func getCurrentUser() async throws -> MeResponse {
        var req = URLRequest(url: baseURL.appending(path: "api/auth/me"))
        req.httpMethod = "GET"
        let (data, response) = try await perform(req, authed: true)
        guard let http = response as? HTTPURLResponse else { throw AlbertAPIError.malformedResponse }
        if http.statusCode == 401 { throw AlbertAPIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw AlbertAPIError.server(status: http.statusCode)
        }
        do {
            return try JSONDecoder().decode(MeResponse.self, from: data)
        } catch {
            throw AlbertAPIError.malformedResponse
        }
    }

    public func getImportantItems(familyId: String) async throws -> [ImportantItem] {
        var components = URLComponents(
            url: baseURL.appending(path: "api/tasks"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "familyId", value: familyId),
            URLQueryItem(name: "view", value: "priority"),
        ]
        var req = URLRequest(url: components.url!)
        req.httpMethod = "GET"
        let (data, response) = try await perform(req, authed: true)
        guard let http = response as? HTTPURLResponse else { throw AlbertAPIError.malformedResponse }
        if http.statusCode == 401 { throw AlbertAPIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw AlbertAPIError.server(status: http.statusCode)
        }
        let decoded: TaskListResponse
        do {
            decoded = try JSONDecoder().decode(TaskListResponse.self, from: data)
        } catch {
            throw AlbertAPIError.malformedResponse
        }
        let now = Date()
        return decoded.tasks.compactMap { task in
            guard let priority = ImportantPriority.fromTaskPriority(task.priority) else { return nil }
            return ImportantItem(
                id: task.id,
                title: task.title,
                priority: priority,
                dueDate: task.dueDate,
                isCompleted: task.status == "done",
                pendingCompletion: false,
                familyId: task.familyId,
                lastSyncedAt: now
            )
        }
    }

    public func completeImportantItem(id: String) async throws {
        var req = URLRequest(url: baseURL.appending(path: "api/tasks/\(id)"))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["status": "done"])
        let (_, response) = try await perform(req, authed: true)
        guard let http = response as? HTTPURLResponse else { throw AlbertAPIError.malformedResponse }
        if http.statusCode == 401 { throw AlbertAPIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw AlbertAPIError.server(status: http.statusCode)
        }
    }

    public func registerDevice(deviceToken: String? = nil) async throws {
        var req = URLRequest(url: baseURL.appending(path: "api/auth/mobile/device"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: String] = ["platform": "ios"]
        if let deviceToken { payload["deviceToken"] = deviceToken }
        req.httpBody = try JSONEncoder().encode(payload)
        let (_, response) = try await perform(req, authed: true)
        guard let http = response as? HTTPURLResponse else { throw AlbertAPIError.malformedResponse }
        if http.statusCode == 401 { throw AlbertAPIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw AlbertAPIError.server(status: http.statusCode)
        }
    }

    public func logout() async throws {
        var req = URLRequest(url: baseURL.appending(path: "api/auth/logout"))
        req.httpMethod = "POST"
        _ = try? await perform(req, authed: true)
        keychain.clearSessionToken()
    }

    public func googleStartURL() -> URL {
        var components = URLComponents(
            url: baseURL.appending(path: "api/auth/google/start"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "client", value: "ios")]
        return components.url!
    }

    public func hasSession() -> Bool {
        keychain.readSessionToken() != nil
    }

    private func perform(_ request: URLRequest, authed: Bool) async throws -> (Data, URLResponse) {
        var req = request
        if authed {
            guard let token = keychain.readSessionToken() else {
                throw AlbertAPIError.unauthorized
            }
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        do {
            return try await session.data(for: req)
        } catch {
            throw AlbertAPIError.networkUnavailable
        }
    }
}
