# iOS / iPhone native shell

Prepared on Windows so the next step is Mac/Xcode only.

## Already in repo
- `@capacitor/ios`
- `ios/` Capacitor native project (`App`)
- Scripts: `ios:sync`, `cap:sync:ios`, `cap:open:ios`
- Remote shell URL: `https://team-connect-app.com` (see `capacitor.config.ts`)

## On a Mac (when ready)
1. Install Xcode + CocoaPods
2. `npm ci`
3. `npx cap sync ios`
4. `npx cap open ios`
5. Set Signing Team + bundle id `com.teamconnect.heb`
6. Optional: enable Push (APNs) — Android FCM path exists; iOS APNs still TODO in `src/lib/native-push.ts`
7. Archive → TestFlight → App Store

Windows cannot build/sign the App Store binary.