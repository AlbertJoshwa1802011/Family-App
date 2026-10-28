# Money — personal iOS money tracker

A small native SwiftUI app for tracking your own expenses and income on your iPhone.
It is separate from the Albert companion in `ios/`. It needs no sign-in, and entries
stay on the phone (SwiftData).

**Features**

- Balance card with this month's money in and out
- Add, edit, and delete expenses or income, each with a category, date, and note (swipe a row to delete it)
- Entries grouped by month
- Currency picker (INR, USD, EUR, GBP, AED, CAD, AUD, SGD)
- Optional **Face ID lock**, which falls back to your passcode
- **Check for updates**: the app reads `https://fam.connect-cloud.workers.dev/ios-money/version.json`
  when it launches or comes back to the foreground (at most every 6 hours), and from
  Settings → Check for updates. When a newer version exists, it shows an "Update available"
  banner with an **Update** button that opens TestFlight.

## Requirements

- A Mac with **Xcode 16 or newer** (the project uses Xcode 16 folder sync, so any new `.swift`
  file in `AlbertMoney/` is picked up automatically)
- An iPhone on iOS 17 or newer
- An Apple ID. A free account can install on your own phone. A paid Apple Developer account
  (99 USD/year) is needed for TestFlight updates.

## Install on your iPhone (first time)

1. On your Mac: `git clone` the repo, then `open ios-money/AlbertMoney.xcodeproj`.
2. Click the **AlbertMoney** target → **Signing & Capabilities** →
   check *Automatically manage signing* → pick your **Team** (your Apple ID).
   If Xcode says the bundle ID is taken, change `com.albert.money` to something unique,
   like `com.yourname.money`.
3. Plug in your iPhone and unlock it. Tap *Trust This Computer*. On iOS 16 and later, turn on
   **Settings → Privacy & Security → Developer Mode** and restart when prompted.
4. In Xcode, choose your iPhone as the run destination and press **⌘R**.
5. With a free account, the first launch is blocked until you trust yourself as a developer:
   **Settings → General → VPN & Device Management → your Apple ID → Trust**.

With a free account, the app stops opening after **7 days**. Press ⌘R again to reinstall it.
Your data is kept.

## Updates: so only you get them, automatically

Use **TestFlight internal testing**. Only people you add can install it, and nothing is
public on the App Store.

**One-time setup**

1. Enroll in the Apple Developer Program.
2. In [App Store Connect](https://appstoreconnect.apple.com) → *Apps* → **+** → *New App*.
   Use the same bundle ID as Xcode. The name can be anything unique, like "Albert Money".
3. Install the **TestFlight** app on your iPhone.

**Every release**

1. In Xcode, select the target → *General* → bump **Version** (for example `1.0.0` → `1.0.1`)
   and **Build** (`1` → `2`).
2. Choose the *Any iOS Device* destination, then go to **Product → Archive** → *Distribute App* →
   *TestFlight & App Store* (or *TestFlight Internal Only*) → Upload.
3. In App Store Connect → *TestFlight* → *Internal Testing*, add yourself once. Later
   builds go to you automatically after processing.
4. When the build shows up in TestFlight, edit `public/ios-money/version.json`:

   ```json
   {
     "latestVersion": "1.0.1",
     "notes": "What changed in this version.",
     "updateURL": "itms-beta://"
   }
   ```

   Commit and merge it. The Worker deploy publishes the file, and the app then shows
   **Update available**. Tapping **Update** opens TestFlight, where you tap *Update*.
   You can also turn on *Automatic Updates* for the app in TestFlight.

`tests/ios-money-update.test.ts` fails if `version.json` announces a version newer than the
Xcode project's `MARKETING_VERSION`. Bump the app version first, then the manifest.

## Project layout

```
ios-money/
  AlbertMoney.xcodeproj
  AlbertMoney/
    AlbertMoneyApp.swift      app entry, Face ID lock overlay, update check on launch
    Models/Entry.swift        SwiftData model (amounts stored as integer cents)
    Models/Money.swift        currency formatting + amount parsing
    Update/UpdateChecker.swift version.json fetch + semantic version compare
    Security/AppLock.swift    Face ID / passcode lock
    Views/                    HomeView, EntryFormView, SettingsView
    Assets.xcassets           AppIcon (drop a 1024×1024 PNG in), AccentColor
public/ios-money/version.json  update manifest served by the Worker
```

This Linux environment can't compile Swift or iOS code, so build the app on your Mac.
