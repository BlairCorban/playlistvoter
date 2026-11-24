# Playlist Vote

A "best of" vote for the group playlist. Everyone goes through every song from the two old playlists (654 unique songs, 6 appear in both), listens to a snippet, and votes **👍 up, 👎 down, ⭐ super (15 each) or skip**. When voting closes you set a cut-off, copy the winners, and build the new playlist. There are stats and a Wrapped-style breakdown ("you downvoted X but everyone else loves them", "you were the only one who liked this", pickiest voter, and so on).

- Static page in `public/` plus a few serverless functions in `api/` (Vercel).
- Votes live in Neon Postgres. Each voter has their own passphrase, stored only as a salted hash.
- Results, Stats and Wrapped stay locked for everyone except the admin (Blair) until the admin closes voting, so nobody's votes get influenced by the others.
- **Test mode** (🧪 button, top right) is fully local: nothing is sent to the server or counted. It has random votes and fake voters so you can try the stats screens.

## Deploy (about 10 minutes)

1. **Import the repo in Vercel.** Add New, Project, pick this repo. Leave the framework as Other. Don't deploy yet if you want to set env vars first (or just redeploy after).
2. **Add a database.** In the Vercel project, Storage (or Marketplace), add **Neon**. It sets `DATABASE_URL` for you.
3. **Set `SESSION_SECRET`** in Project Settings, Environment Variables. Use a long random string:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. **Create the tables and voter accounts** from your own computer:
   ```bash
   npm install
   npx vercel link            # once, pick this project
   npx vercel env pull .env.local
   # on Windows PowerShell: $env:DATABASE_URL = (Select-String DATABASE_URL .env.local).Line.Split('=',2)[1].Trim('"')
   # on Mac/Linux:          export $(grep DATABASE_URL .env.local | tr -d '"')
   node scripts/setup.js
   ```
   It prints each person's passphrase **once**. Copy them and send them out (Discord DMs). They are not stored anywhere readable.
   - Lost one? `node scripts/setup.js --reset Chad` issues a new one.
   - Running it again is safe. It only creates missing voters.
5. **Deploy** (push to `main`, or Redeploy in Vercel). Open the site and sign in as Blair to check it works.

If the vote API errors with "Unknown song" or can't find `songs.json`, confirm `public/songs.json` is in the repo. The API reads it to validate votes.

## Running it

- Voting: each person signs in with their name and passphrase. Their votes autosave. They can change any vote under **My votes**.
- Close voting: sign in as Blair, open **Results**, **Close voting and reveal results to everyone**. You can reopen it.
- Results tab: pick a cut-off (score or upvote count), then **Copy list** to get the winners with links.

## Rules you can change

`lib/config.js`: super upvote limit (15) and the voter list/admin. Scoring (👍 +1, ⭐ +3, 👎 −1) is in `public/index.html` (`aggregate`). Voters are only created by `scripts/setup.js`, so after adding a name run it again.

## Tests

```bash
npm install
npm test   # API + UI tests against an in-memory Postgres (PGlite), no database needed
```

## Notes

- Artist names are guessed from video titles/channels, so a few Wrapped artist cards may group things oddly.
- Some YouTube videos block embedding. The voting card always has "open in YouTube Music / YouTube" links as a fallback.
- Songs were read from the two playlists on 24 Nov 2026. YouTube hides deleted/private videos, so the counts are a bit lower than the playlist headers.
- Sign-in lockout: 10 wrong tries locks that name for 15 minutes.
