import Foundation

/// Build-time / runtime configuration for the Albert iOS companion.
/// Secrets never live here — only public endpoints and identifiers.
public enum AppConfig {
    /// Production Albert Web / Worker origin.
    public static let productionAPIBaseURL = URL(string: "https://fam.connect-cloud.workers.dev")!

    /// Override with UserDefaults key `albert.apiBaseURL` for local Worker testing
    /// (e.g. `http://127.0.0.1:5173`). Debug builds only honor http.
    public static var apiBaseURL: URL {
        if let override = UserDefaults.standard.string(forKey: "albert.apiBaseURL"),
           let url = URL(string: override),
           url.scheme == "https" || (url.scheme == "http" && isDebug) {
            return url
        }
        return productionAPIBaseURL
    }

    public static let appGroupID = "group.com.albert.familyvault"
    public static let bundleID = "com.albert.familyvault"
    public static let widgetBundleID = "com.albert.familyvault.widget"
    public static let urlScheme = "albert"
    public static let oauthCallbackURL = URL(string: "albert://oauth-callback")!

    public static var isDebug: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }
}
