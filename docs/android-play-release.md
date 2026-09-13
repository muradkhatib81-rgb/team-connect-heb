# Google Play release prep (Team Connect Android)

## Already prepared in the repo
- Capacitor Android shell (`android/`, `com.teamconnect.heb`)
- Production shell URL: `https://team-connect-app.com`
- Release signing wiring in `android/app/build.gradle` via `android/keystore.properties`
- Example props: `android/keystore.properties.example`
- Build script: `scripts/build-android-aab.ps1`
- Public privacy page: `https://team-connect-app.com/privacy.html`

## Local secrets (NOT in git — back these up)
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
`android/app/build/outputs/bundle/release/app-release.aab`

npm alias: `npm run android:aab`

## Play Console checklist (manual)
1. Create a Google Play Console developer account (one-time fee).
2. Create app: Team Connect / `com.teamconnect.heb`.
3. Upload the AAB to **Internal testing** first.
4. Store listing: title, short/full description (AR/HE/EN as needed), screenshots, feature graphic.
5. Privacy policy URL: `https://team-connect-app.com/privacy.html`
6. Data safety form — declare:
   - App collects account info (email/name) via Supabase auth
   - App may use push notifications (FCM) when enabled
   - Data is required for app functionality / account management
7. Content rating questionnaire.
8. Target audience / news apps declarations as applicable.
9. Promote Internal → Closed → Production when ready.

## Version bumps
Edit in `android/app/build.gradle`:
- `versionCode` (integer, must increase every Play upload)
- `versionName` (user-visible, e.g. `1.0.1`)

## Notes
- Installed debug APKs keep their old remote URL until you rebuild after `cap sync`.
- Do not commit `*.jks`, `keystore.properties`, or `google-services.json`.