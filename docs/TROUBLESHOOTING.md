# Daily operation and troubleshooting

Open a terminal in the project directory and run `npm run build` for the first launch and after source updates. Run `npm start` to launch ClipFlow and its publishing worker. Open the URL configured by `APP_URL`, then check the worker indicator. Stop both processes with Ctrl+C. The launcher checks for pending migrations and leaves an up-to-date SQLite schema alone. Use the same working directory, database, media paths, and master key on every start.

If port 3001 is occupied, set `APP_URL` to the chosen localhost address in `.env.local` or stop the old ClipFlow terminal. Keep the registered Google OAuth redirect aligned with the address shown in Integrations. Keep the app and Meta callback on loopback.

If the browser repeatedly reloads while `npm run dev` is running, stop the development terminal with Ctrl+C and start the built app with `npm start`. The built app runs without Next.js Fast Refresh.

If SQLite reports a lock while a migration is pending, stop other ClipFlow terminals, then restart. Keep the SQLite database, WAL, and SHM files together until every database process has stopped. Do not resolve a lock by deleting the database or its sidecar files. If the worker is offline, check the startup terminal, stop the launcher, and restart. The worker recovers expired leases and checks stored provider upload identifiers. Review ambiguous jobs in the provider console before making a new submission.

Scheduled local jobs run while ClipFlow, the computer, and the network are available. The default missed schedule policy sends overdue jobs to Needs Review. The Calendar separates unconfirmed draft plans from jobs. A YouTube upload handed to native scheduling can be released by YouTube at the selected time even when ClipFlow is offline. ClipFlow verifies it after reconnecting.

Use **Review and publish** from Prepare content for an immediate post. Review lets you type the YouTube title, choose the audience and visibility, or return to **Write with Gemini**. A blank title uses the clip name. The default category is People & Blogs. Check the selected account, then confirm the publication and follow its status in Queue.

If Google reports high demand for the saved Gemini model, choose **gemini-3.1-flash-lite** in the composer and try again. The selection applies to the current editor session. If a new provider's setup shows **Unknown provider** after a source update, stop ClipFlow, run `npm run build`, and restart with `npm start` so both pages and API routes use the same release.

When updating, stop ClipFlow, back up the database, the protected master key, managed media, and your local environment configuration, then update the source and run `npm ci`. Start ClipFlow and check Integrations, Accounts, and Queue. Restore the matching database, media, and key together while everything is stopped. See [credential backups](INTEGRATIONS.md#credentials-and-backups) for the default key location. Restrict backup access because it includes your local credentials and drafts.

ClipFlow is a single user app without an application password. Other processes on the same machine and people with access to your OS account may access the workspace. Keep loopback binding and use OS account controls. The callback listener on port 3443 serves only the Instagram callback. If Meta needs a public URL, that requirement needs a separately approved setup.

## Manual acceptance

1. Import one disposable MP4 and confirm that playback and seeking work. Open Create Post, add a short description in Step 3, generate a suggestion, and review and save it in a draft. For video analysis, read the sending notice before confirming.
2. Check Accounts and refresh Analytics for a connected YouTube channel. Confirm the channel name, period, and timestamp.
3. Obtain approval for a live test with one selected video and one selected YouTube channel. Choose Private, review the selected audience and disclosure, and confirm once. Check Queue until processing and the intended visibility are verified. Confirm the remote ID and result in History and YouTube Studio.
4. With disposable clips, verify the default keeps the clip and **Remove from Clip Library** removes it once all destinations are verified and no draft or unsettled post needs it. Check that publication history and the original source remain. Upload the original again and verify it appears in the library.
5. For scheduling, use a mock provider first. A real scheduled test also needs approval for the selected clip, account, visibility, and time. With Instagram configured, start with one eligible professional account and one approved Reel. Check the published media ID and permalink in History.
