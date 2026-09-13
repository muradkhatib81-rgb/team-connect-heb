# Google Play release prep (Team Connect Android)

## Domain note
Canonical app URL is `https://www.team-connect-app.com`. Apex `https://team-connect-app.com` 308-redirects to www — old links keep working.

## Already prepared in the repo
- Capacitor Android shell (`android/`, `com.teamconnect.heb`)
- Production shell URL: `https://www.team-connect-app.com`
- Release signing wiring in `android/app/build.gradle` via `android/keystore.properties`
- Example props: `android/keystore.properties.example`
- Build script: `scripts/build-android-aab.ps1`
- Public privacy page: `https://www.team-connect-app.com/privacy.html`

## Local secrets (NOT in git â€” back these up)
On this machine only:
- `android/team-connect-release.jks`
- `android/keystore.properties`
- `android/app/google-services.json` (push)

If you lose the keystore, you cannot update the same Play listing with a new app signing key (unless you enrolled in Play App Signing recovery options). Copy both files to a secure backup now.

## Build the upload AAB
From the repo root on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-android-aab.ps1
```

Output:
`%TEMP%\tc-android-build\app\outputs\bundle\release\app-release.aab (also copied to Documents\TeamConnect-Play-Release)`

npm alias: `npm run android:aab`

## Play Console checklist (manual)
1. Create a Google Play Console developer account (one-time fee).
2. Create app: Team Connect / `com.teamconnect.heb`.
3. Upload the AAB to **Internal testing** first.
4. Store listing: title, short/full description (AR/HE/EN as needed), screenshots, feature graphic.
5. Privacy policy URL: `https://www.team-connect-app.com/privacy.html`
6. Data safety form â€” declare:
   - App collects account info (email/name) via Supabase auth
   - App may use push notifications (FCM) when enabled
   - Data is required for app functionality / account management
7. Content rating questionnaire.
8. Target audience / news apps declarations as applicable.
9. Promote Internal â†’ Closed â†’ Production when ready.

## Version bumps
Edit in `android/app/build.gradle`:
- `versionCode` (integer, must increase every Play upload)
- `versionName` (user-visible, e.g. `1.0.1`)

## Notes
- Installed debug APKs keep their old remote URL until you rebuild after `cap sync`.
- Native splash is a solid `#0f172a` (`drawable/splash.xml`). Do not regenerate `splash.png` logos with `@capacitor/assets` — the app icon grow animation is the web overlay.
- After changing splash drawables or `capacitor.config.ts`, run `npx cap sync android` before rebuilding the APK/AAB.
- Do not commit `*.jks`, `keystore.properties`, or `google-services.json`.