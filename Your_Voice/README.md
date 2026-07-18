# 🗣️ Your Voice

Look up a legislative bill, take a stance, and send a letter to your representative.

Enter a bill number (e.g. `S. 4985` or `H.R. 1234`), optionally pick a state legislature
instead of the U.S. Congress, choose **Support** or **Oppose**, and optionally enter your
zip code. The app researches the bill, finds your representatives from the zip code,
drafts a letter addressed to the one you pick, and gives you a one-click **Email** button
(plus a copy button and a link to the member's official contact form).

## Run it

Requires Node.js 18+. No dependencies to install.

```sh
node server.js
# then open http://localhost:3000
```

## Data sources (no API key needed for national bills)

| What | Source |
|---|---|
| Federal bill info | GovTrack API (keyless) |
| Zip → location | Zippopotam.us (keyless) |
| Location → congressional district | U.S. Census geocoder (keyless) |
| Current members of Congress | unitedstates/congress-legislators (keyless) |

## Optional API keys

Set these as environment variables before starting the server:

- `ANTHROPIC_API_KEY` — enables **AI-drafted letters tailored to each specific bill**
  (written by Claude from the bill's title, status, sponsor, and official summary, plus
  your personal reason). Without it, letters use a built-in template that still weaves in
  the bill's stated purpose from its title. Key: https://platform.claude.com/
- `CONGRESS_API_KEY` — adds official bill summaries from Congress.gov (also makes the
  AI-drafted letters much more substantive). Free key: https://api.congress.gov/sign-up/
- `OPENSTATES_API_KEY` — **required for state legislature mode** (state bills and state
  legislators, who often have public email addresses).
  Free key: https://open.pluralpolicy.com/accounts/signup/

```sh
ANTHROPIC_API_KEY=sk-... OPENSTATES_API_KEY=abc123 CONGRESS_API_KEY=def456 node server.js
```

## Notes

- Members of Congress don't publish public email addresses; the Email button opens your
  mail app with the letter prefilled, and the app also links each member's official
  contact form (the most reliable way to be counted). State legislators found through
  OpenStates often do have email addresses, which are prefilled automatically.
- The House district is estimated from the center of your zip code; zips that span
  multiple districts may match a neighboring one. Senators are always correct for your state.
- If a bill number isn't found in the current Congress, the app automatically checks the
  previous Congress and tells you the bill would need to be reintroduced.
