import Foundation
import Security

/// Minimal Keychain wrapper for the Albert session token.
/// Tokens never go to UserDefaults, App Group files, logs, or URLs.
public final class KeychainStore: @unchecked Sendable {
    public static let shared = KeychainStore()

    private let service = "com.albert.familyvault.session"
    private let account = "sessionToken"

    public init() {}

    /// Prefer the shared keychain access group from entitlements; fall back to
    /// the app’s default keychain so Debug/simulator still works.
    private func queries() -> [[String: Any]] {
        let shared: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: "com.albert.familyvault",
        ]
        let local: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        return [shared, local]
    }

    public func saveSessionToken(_ token: String) throws {
        let data = Data(token.utf8)
        var lastStatus: OSStatus = errSecParam
        for base in queries() {
            SecItemDelete(base as CFDictionary)
            var add = base
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            lastStatus = SecItemAdd(add as CFDictionary, nil)
            if lastStatus == errSecSuccess { return }
        }
        throw KeychainError.unhandled(lastStatus)
    }

    public func readSessionToken() -> String? {
        for base in queries() {
            var query = base
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var item: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &item)
            if status == errSecSuccess, let data = item as? Data {
                return String(data: data, encoding: .utf8)
            }
        }
        return nil
    }

    public func clearSessionToken() {
        for base in queries() {
            SecItemDelete(base as CFDictionary)
        }
    }
}

public enum KeychainError: Error {
    case unhandled(OSStatus)
}
