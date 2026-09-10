import SwiftUI
import UIKit
import AuthenticationServices

@main
struct AlbertApp: App {
    @StateObject private var session = SessionController()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .onOpenURL { url in
                    Task { await session.handle(url: url) }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var session: SessionController

    var body: some View {
        Group {
            if session.isAuthenticated {
                ImportantItemsView()
            } else {
                SignInView()
            }
        }
        .task {
            await session.bootstrap()
        }
    }
}

@MainActor
final class SessionController: ObservableObject {
    @Published var isAuthenticated = false
    @Published var user: AlbertUser?
    @Published var families: [AlbertFamily] = []
    @Published var authError: String?
    @Published var isBusy = false

    private var webAuthSession: ASWebAuthenticationSession?

    func bootstrap() async {
        guard await AlbertAPIClient.shared.hasSession() else {
            isAuthenticated = false
            return
        }
        do {
            let me = try await AlbertAPIClient.shared.getCurrentUser()
            if let user = me.user {
                self.user = user
                self.families = me.families
                isAuthenticated = true
                _ = await SyncManager.shared.sync(force: true)
                _ = await NotificationScheduler.shared.requestAuthorization()
                try? await AlbertAPIClient.shared.registerDevice()
            } else {
                await logout()
            }
        } catch {
            // Keep cached session optimistic if offline.
            isAuthenticated = true
        }
    }

    func signIn() {
        authError = nil
        isBusy = true
        let startURL = AlbertAPIClient.shared.googleStartURL()
        let session = ASWebAuthenticationSession(
            url: startURL,
            callbackURLScheme: AppConfig.urlScheme
        ) { [weak self] callbackURL, error in
            Task { @MainActor in
                guard let self else { return }
                self.isBusy = false
                if let error {
                    self.authError = error.localizedDescription
                    return
                }
                guard let callbackURL else {
                    self.authError = "Sign-in was cancelled"
                    return
                }
                await self.handle(url: callbackURL)
            }
        }
        session.prefersEphemeralWebBrowserSession = false
        session.presentationContextProvider = WebAuthPresenter.shared
        self.webAuthSession = session
        session.start()
    }

    func handle(url: URL) async {
        switch DeepLinkRouter.parse(url) {
        case .oauthCallback(let code, let error):
            if let error {
                authError = error
                return
            }
            guard let code else {
                authError = "Missing sign-in code"
                return
            }
            await finishExchange(code: code)
        case .task, .importantList, .web:
            break
        }
    }

    private func finishExchange(code: String) async {
        isBusy = true
        defer { isBusy = false }
        do {
            let result = try await AlbertAPIClient.shared.authenticate(code: code)
            user = result.user
            families = result.families
            isAuthenticated = true
            _ = await SyncManager.shared.sync(force: true)
            _ = await NotificationScheduler.shared.requestAuthorization()
            try? await AlbertAPIClient.shared.registerDevice()
        } catch AlbertAPIError.invalidCode {
            authError = "Sign-in code expired. Try again."
        } catch AlbertAPIError.networkUnavailable {
            authError = "Network unavailable"
        } catch {
            authError = "Couldn’t finish sign-in"
        }
    }

    func logout() async {
        try? await AlbertAPIClient.shared.logout()
        LocalCache.shared.clear()
        WidgetStateStore.shared.clear()
        user = nil
        families = []
        isAuthenticated = false
    }
}

final class WebAuthPresenter: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = WebAuthPresenter()
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
