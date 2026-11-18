<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# AMZY

AMZY streams video posts from Telegram groups and channels in a Netflix-style interface. Connect a public group/channel with its `t.me` link, or a private one with an invite link; private groups and channels require joining with the signed-in Telegram account. Photos and text posts are not shown in the Home feed. The Home hero banner rotates through the latest ten video posts, with swipe and previous/next controls, and uses each Telegram video's own thumbnail when available.

## Run locally

**Prerequisites:**  Node.js

1. Install dependencies with `npm install --legacy-peer-deps`.
2. Copy `.env.example` to `.env`.
3. Start the app with `npm run dev`. Open the URL printed by the server (usually `http://localhost:3000`).

## Build the Android app

The React frontend is bundled inside the Android app; it does not need to be hosted as a website. Install Android Studio and the Android SDK, then run:

```powershell
npm install --legacy-peer-deps
npm run android:sync
npm run android:open
```

In Android Studio, build or run the `android` project on a device. The Android app uses TDLib for an in-app Telegram phone/code login; Telegram account authorization stays on the device.

The Android app uses immersive fullscreen and adapts its layout to different screen sizes and display cutouts. System bars can be temporarily revealed by swiping from the edge. Videos keep their original aspect ratio, so black bars may remain when the video's shape differs from the screen. The native Telegram libraries support 64-bit Android devices only.

### Configure native Telegram login

1. Create your own Telegram API ID and API hash at [my.telegram.org/apps](https://my.telegram.org/apps).
2. Add them to the ignored `android/local.properties` file (keep any existing `sdk.dir` line):
   ```properties
   telegram.apiId=YOUR_API_ID
   telegram.apiHash=YOUR_API_HASH
   ```
   The API hash is a Telegram client identifier, not a user password. Do not commit `local.properties`.
3. Run `npm run android:sync`, then rebuild and install the Android app from Android Studio.

Telegram phone numbers, login codes, two-step verification passwords, and the TDLib account session are handled by the native app and are not sent to Supabase. After a native Telegram account is ready, the app automatically starts the separate Telegram verification needed for Supabase cloud sync. Complete that verification once in the browser using the same Telegram account; channel references and favorites can then sync to Supabase, while the TDLib session and private media access remain on the device.

Add one Telegram group or channel link at a time. Available history is paged and only videos at least 10 minutes long are included in feeds; videos with unknown durations are excluded. Public groups and channels page through their available history using Telegram's Client API. Videos use AndroidX Media3 ExoPlayer with a TDLib-backed byte-range data source that fetches bounded segments on demand instead of intentionally downloading the whole file before playback. The AMZY controls drive the native Android player. Already-joined private groups and channels load directly; other valid invite links show a join action first. Telegram-protected content that cannot be saved is not made available in the app.

The first available videos appear while older accessible history loads in the background. Loading time depends on channel size, Telegram access and connectivity; an error is shown if loading or saving the history fails. Reopening the app retries full history. Search and channel lists show more results in batches to keep large feeds responsive.

## Watch Party rooms

Open **Plus → Watch together** to create a room or join with its 10-character code. A device can be in one room at a time; leave the current room before creating or joining another. Created and joined room codes are saved on that device, so leaving does not remove the room card and the participant can rejoin later. Room participants use nicknames and do not need an AMZY login. Everyone can see the active member count and current admin; the admin can transfer control to another active participant. Only the current admin's play, pause, seek, and video selection are synchronized. A guest who joins while a video is already shared sees it paused at the room's current position and must press Play to join; this does not pause or change playback for anyone else. Leaving a room does not delete it or interrupt other participants' playback: when its admin leaves, control passes to an active participant, or to the next participant who joins if nobody remains. Only the admin can explicitly delete the room. Rooms otherwise remain joinable for up to 12 hours. A participant whose heartbeat has been missing for 45 seconds is shown as offline and does not count toward the active-member limit; reconnecting restores their presence.

Videos with a shareable HTTPS stream can be watched in browser and Android rooms. Telegram Client-API-only streams (including private Telegram videos) are Android-only: every participant must use the Android app, sign in to Telegram on that device, and already have access to that Telegram group/video. Room membership does not grant Telegram access or distribute Telegram file credentials. Browser participants are rejected from private-video rooms.

Watch rooms require the `watch_rooms` migration and updated API deployment. Apply the migration and deploy the Edge Function before expecting rooms to work in installed or hosted builds:

```powershell
npx supabase db push
npx supabase functions deploy teleflix-api --no-verify-jwt --project-ref yzoxjvxgepzfsnyeiwdx
```

The backend uses the existing server-side `SESSION_SECRET` to issue short-lived room participant tokens; do not expose this secret in frontend variables. Local development uses the Express API and the same Supabase project/database configuration.

## Configure browser Telegram login

The backend is the Supabase project `yzoxjvxgepzfsnyeiwdx`. Browser-based Telegram OIDC uses the HTTPS callback below and returns to the browser app. The Android native Telegram login does not use BotFather's Login/OIDC domain settings.

1. Link the Supabase project and apply the database migration:
   ```powershell
   npx supabase login
   npx supabase link --project-ref yzoxjvxgepzfsnyeiwdx
   npx supabase db push
   ```
2. In Supabase Dashboard → Edge Functions → Secrets, configure `TELEGRAM_BOT_ID`, `TELEGRAM_CLIENT_ID`, `TELEGRAM_CLIENT_SECRET`, and a `SESSION_SECRET` of at least 32 bytes. Set:
   - `FRONTEND_URL=https://amzy.chakrabortycompliance.in` (registered Telegram OIDC origin; it does not host the app UI)
   - `TELEGRAM_REDIRECT_URI=https://yzoxjvxgepzfsnyeiwdx.supabase.co/functions/v1/teleflix-api/auth/telegram/callback`
   - `APP_REDIRECT_URI=amzy://auth`

   Generate a session signing secret locally if needed:
   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```
3. Deploy the Edge Function:
   ```powershell
   npx supabase functions deploy teleflix-api --no-verify-jwt --project-ref yzoxjvxgepzfsnyeiwdx
   ```
4. In BotFather's Telegram Login/OIDC allowed URLs, register:
   - Origin: `https://amzy.chakrabortycompliance.in`
   - Callback: `https://yzoxjvxgepzfsnyeiwdx.supabase.co/functions/v1/teleflix-api/auth/telegram/callback`
5. The public Edge Function URL is set in `.env.local` for browser builds. Keep private keys out of `VITE_` variables.

Keep the Telegram OIDC client secret and session signing secret in Supabase Edge Function secrets. The native API ID/hash are separate client identifiers described above. The public channel feed and Telegram media proxy are served by the `teleflix-api` Supabase Edge Function, so deploy the updated function before building or installing the Android app:

```powershell
npx supabase functions deploy teleflix-api --no-verify-jwt --project-ref yzoxjvxgepzfsnyeiwdx
```

### Deploy the admin page to GitHub Pages

The GitHub Actions workflow builds the Vite site and publishes `dist` to GitHub Pages whenever a commit is pushed to `main`. For a private repository, the GitHub account or organization must have a plan that supports Pages for private repositories.

1. In repository **Settings → Pages**, set the source to **GitHub Actions**.
2. In **Settings → Secrets and variables → Actions → Variables**, add:
   - `VITE_SUPABASE_FUNCTION_URL`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Keep the existing Supabase Edge Function `FRONTEND_URL` unchanged, then add `ADDITIONAL_FRONTEND_URLS=https://chakraborty8653.github.io` under **Supabase Dashboard → Edge Functions → Secrets**. This allows GitHub Pages requests without removing the existing website origin.
4. Deploy the updated Edge Function, then push the project to the `main` branch. The admin page will be at `https://chakraborty8653.github.io/amzy-admin/admin.html`.

The anon/publishable key is included in the public browser bundle; never use the service-role key or put it in a `VITE_` variable. The admin page is static, while database requests continue to use the Supabase Edge Function.

### Admin panel

The admin panel is a separate web page, not part of the AMZY app UI. Open the hosted `/admin.html` page and sign in with a Supabase Auth email/password account. Create or invite the admin account in Supabase Authentication, then add its email to the server-side `ADMIN_SUPABASE_EMAILS` allowlist (comma-separated). For the hosted app, set this under Supabase Dashboard → Edge Functions → Secrets, then deploy `teleflix-api`; for local Express development, set it in the server `.env`. On localhost, admin API requests use the local Express server; hosted admin pages use the deployed Edge Function. Set the public Supabase URL and anon/publishable key as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; the anon key is safe for browser use with RLS enabled. Never expose the service-role key or admin email allowlist through a `VITE_` variable.

The panel shows the row counts and searchable, paginated records for the app's Supabase tables: users, channels, favorites, announcements, watch rooms and participants, Telegram login records, native login challenges, registered devices, rate limits, and deleted-account records. Public channels get clickable `t.me` links; newly added private channels retain the original invite link for admins. Older private channel records do not contain their original invite link and are marked as unavailable. Data table cells can be selected or copied. Admins can publish, edit, or delete announcements in the app's existing notifications feed. Admin API calls retry once after refreshing an expired access token when the Supabase Auth refresh session is still valid. Telegram-generated placeholder addresses are hidden from the user list; a real email appears only when one is stored in `users.email`. When adding an email field to the app, save the user's email to that column; subsequent Telegram logins preserve it instead of replacing it with the placeholder. Telegram API keys, bot tokens, auth hashes, device public keys, rate-limit identifiers, and active room codes are never exposed; room codes are masked.

The Channels table lists each distinct channel once, even when multiple users added it, and shows the associated user IDs and count. Avatar URLs, subscriber counts, monetization status, and ad network are omitted from this admin view.

The Android app needs the public `VITE_SUPABASE_FUNCTION_URL` configured at build time. Bot sync and MTProto test routes still use the Express backend and are not available in the standalone Android app.
