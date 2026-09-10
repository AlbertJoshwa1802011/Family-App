# Albert iOS — Native Apple Companion

Albert iOS is a **native SwiftUI companion** to the Family Vault (Albert) web app.
It is not a website wrapper. The web app remains the source of truth for accounts,
Google Sign-In, Drive/Calendar, and business logic.

```bash
open ios/Albert.xcodeproj
```

## Requirements

- macOS with **Xcode 16+** (iOS 17 deployment target)
- Apple Developer account (personal team is enough for your own iPhone)
- Physical iPhone on the same Apple ID used for signing
- Network access to Albert Web (`https://fam.connect-cloud.workers.dev` by default)

This Linux CI environment cannot compile the Xcode project — build on your Mac.

## Bundle identifiers

| Target | Bundle ID |
|---|---|
| Albert app | `com.albert.familyvault` |
| Widget extension | `com.albert.familyvault.widget` |
| App Group | `group.com.albert.familyvault` |
| URL scheme | `albert://` |

Replace `DEVELOPMENT_TEAM` in Xcode (Signing & Capabilities) with **your** Team ID.
Do not commit someone else’s team id or signing certificates.

## First-time Xcode setup

1. `git clone` this repo and open `ios/Albert.xcodeproj`.
2. Select the **Albert** target → Signing & Capabilities:
   - Enable **Automatically manage signing**
   - Choose your Team
   - Confirm App Group `group.com.albert.familyvault`
   - Confirm Associated Domains `applinks:fam.connect-cloud.workers.dev`
3. Select **AlbertWidget** → same Team + App Group.
4. Plug in your iPhone, trust the computer, select the device as the run destination.
5. Product → Run (⌘R).

If Xcode complains about the App Group, create
`group.com.albert.familyvault` under your Team in the Apple Developer portal
(or let Xcode create it).

## Backend URL configuration

Default API base: `https://fam.connect-cloud.workers.dev`

For local Worker testing (Debug only):

```swift
UserDefaults.standard.set("http://127.0.0.1:5173", forKey: "albert.apiBaseURL")
```

Or set it once from the debugger. Release builds require `https`.

## Authentication flow

1. Tap **Continue with Albert**.
2. `ASWebAuthenticationSession` opens Albert’s existing Google OAuth
   (`/api/auth/google/start?client=ios`).
3. After Google consent, the Worker redirects to
   `albert://oauth-callback?code=…` (one-time code — **not** the session token).
4. The app calls `POST /api/auth/mobile/exchange` and stores the session token in
   the **Keychain**.
5. Subsequent API calls send `Authorization: Bearer <token>`.

Albert never asks for your Google password, OTP, or bank credentials inside the
native UI.

## Widgets

1. Long-press the Home Screen → **+** → search **Albert**.
2. Add Small / Medium / Large **Important** widgets.
3. On Lock Screen, add the **Don’t Forget** accessory widget.

Widget data comes from the App Group file `widget-state.json` (titles, priority,
due dates only — **no** session tokens).

Interactive **Done** uses `CompleteImportantItemIntent` (App Intents). Offline
completions stay pending until the next sync.

## Notifications

On first launch after sign-in, Albert requests notification permission.
Only **critical** (`high` priority) open items schedule local reminders:

- Due soon (1 day before, 09:00)
- Due now (due day, 09:00)
- Overdue (day after, 09:00)

## Universal Links

`public/.well-known/apple-app-site-association` is served by the Worker assets.
Replace `TEAMID` with your Apple Team ID before relying on Universal Links in
production. Custom scheme `albert://tasks/<id>` works immediately.

## Tests

In Xcode: Product → Test (⌘U), or:

```bash
xcodebuild test \
  -project ios/Albert.xcodeproj \
  -scheme Albert \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```

## Regenerating the Xcode project

If you add Swift files:

```bash
python3 ios/Scripts/generate_xcodeproj.py
```

Then re-open the project and verify target membership.

## Security checklist

- [ ] Session token only in Keychain
- [ ] App Group has no credentials
- [ ] No secrets in source / git
- [ ] HTTPS in Release
- [ ] Sign out clears Keychain + caches + widget state

## Related docs

- [`docs/ios-architecture.md`](../docs/ios-architecture.md)
- [`docs/ios-backend-contract.md`](../docs/ios-backend-contract.md)
