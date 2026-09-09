import Foundation
import Testing
@testable import Albert

/// URLProtocol stub for AlbertAPIClient contract tests.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let (status, data) = try handler(request)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: status,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

struct AlbertAPIClientTests {
    private func makeClient() -> (AlbertAPIClient, KeychainStore) {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: config)
        let keychain = KeychainStore()
        try? keychain.saveSessionToken("11111111-1111-4111-8111-111111111111")
        let client = AlbertAPIClient(
            baseURL: URL(string: "https://example.test")!,
            session: session,
            keychain: keychain
        )
        return (client, keychain)
    }

    @Test func successfulMe() async throws {
        StubURLProtocol.handler = { _ in
            let body = #"{ "user": { "id": "u1", "email": "a@b.c", "name": "A", "picture": null }, "families": [] }"#
            return (200, Data(body.utf8))
        }
        let (client, _) = makeClient()
        let me = try await client.getCurrentUser()
        #expect(me.user?.email == "a@b.c")
    }

    @Test func authenticationFailure() async {
        StubURLProtocol.handler = { _ in (401, Data(#"{ "error": "unauthorized" }"#.utf8)) }
        let (client, _) = makeClient()
        await #expect(throws: AlbertAPIError.unauthorized) {
            _ = try await client.getCurrentUser()
        }
    }

    @Test func serverFailure() async {
        StubURLProtocol.handler = { _ in (500, Data("oops".utf8)) }
        let (client, _) = makeClient()
        await #expect(throws: AlbertAPIError.server(status: 500)) {
            _ = try await client.getCurrentUser()
        }
    }

    @Test func malformedResponse() async {
        StubURLProtocol.handler = { _ in (200, Data("not-json".utf8)) }
        let (client, _) = makeClient()
        await #expect(throws: AlbertAPIError.malformedResponse) {
            _ = try await client.getCurrentUser()
        }
    }

    @Test func networkUnavailable() async {
        StubURLProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        let (client, _) = makeClient()
        await #expect(throws: AlbertAPIError.networkUnavailable) {
            _ = try await client.getCurrentUser()
        }
    }
}
