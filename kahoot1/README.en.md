# MangosGo

A real-time quiz game built from scratch — write your questions, put them on the big
screen, and players join with a PIN or by scanning a QR code. Handles 50 players per room,
has 6 game modes, and runs in both Thai and English.

The server is a **single Node process** serving both the web pages and the WebSocket on the
same port. The code is split by responsibility under `server/`, leaving `server.js` as just
the wiring and the listen call. No framework, no build step — edit a file, refresh the browser.

🇹🇭 [อ่านฉบับภาษาไทย](README.md)

---

## Contents

- [Up and running in 3 minutes](#up-and-running-in-3-minutes)
- [Accounts and roles](#accounts-and-roles)
- [Dashboards](#dashboards)
- [How to use it](#how-to-use-it)
- [Project layout](#project-layout)
- [How the system works](#how-the-system-works)
- [Game modes](#game-modes)
- [Two languages](#two-languages)
- [Where to change things](#where-to-change-things)
- [Limits you should know before real use](#limits-you-should-know-before-real-use)

---

## Up and running in 3 minutes

**Needs Node 22.5 or newer** — it uses `node:sqlite`, which ships with Node, so there is no
separate database to install. Check with `node -v`.

```bash
npm install
```

```bash
npm start
```

Open <http://localhost:8000> — that's it.

**The very first thing to do is go to <http://localhost:8000/auth/> and sign up.**
The first person to register becomes the **admin** automatically. Everyone after that can only
pick student or teacher.

Change the port with `PORT=8100 npm start`
Point the database somewhere else with `DB_PATH=/path/to/db.sqlite3 npm start` (handy for testing
without touching real data).

### Letting others on the same Wi-Fi join

Find your machine's IP first (on Windows run `ipconfig` and look at the IPv4 address, e.g.
`192.168.1.50`), then have players open `http://192.168.1.50:8000` on their phones. Everyone
has to be on the same Wi-Fi network.

---

## Accounts and roles

Sign-up and sign-in share one page at `/auth/`, switched with the tabs at the top.

| Role | Can self-register | Can do |
| --- | --- | --- |
| **student** | yes | Join games with a PIN |
| **teacher** | yes | Create and edit question sets, host games, and play too |
| **admin** | no | Everything — the first account created on the system gets this automatically |

`/Make/` and `/host/` are teacher/admin only. Signed-out visitors are sent to `/auth/` with the page
they wanted remembered, so they land back there after signing in. Someone signed in without the right
role gets a message explaining they cannot open it.

Every permission check runs on the server, in **three places** — not just by hiding buttons:

1. Requests for files under `Make/` or `host/` — role checked before the file is served
2. `POST /api/quizzes` — role checked before saving, and the quiz is stamped with the author's `owner_id`
3. The `HOST_ROOM` WebSocket message — checked again, because a WebSocket can be opened directly
   without ever loading the page

**Joining with a PIN stays open to everyone** — no account needed, same as Kahoot. A signed-in student
can join the same way; the account is there to support score history later.

**What the auth layer already does**

- Passwords stored as scrypt hashes with a per-user salt (via `node:crypto`, no extra dependency),
  compared in constant time
- Sessions live in SQLite rather than memory, so a server restart does not sign everyone out; they
  last 7 days
- The cookie is `HttpOnly` + `SameSite=Lax`, so page scripts cannot read the token
- A failed sign-in returns the same message whether the email exists or the password was wrong, so it
  never reveals which accounts exist
- `role: "admin"` cannot be requested at sign-up; the server only accepts student/teacher

> Not built yet: password reset, email verification, sign-in rate limiting, and an admin screen for
> changing other people's roles.

---

## Dashboards

`/dashboard/` is one page that shows different things per role, open to anyone signed in. Signing in
lands you here.

| Role | Sees |
| --- | --- |
| **student** | Games played, total score, correct answers, best rank, and every game they have played |
| **teacher** | Their own question sets (host / delete), games already run, and a result report per game |
| **admin** | Everything a teacher sees but system-wide, plus every account with a role dropdown |

### Per-game report

Hit **Results** on any game to open a panel with:

- The full standings with scores and correct-answer counts
- **Correct answers per question** as coloured bars — green means most people got it, red marks the
  questions worth re-teaching

Teachers can only open reports for games from question sets they own (or that they hosted); admins
can open any.

### One set, many runs

A PIN can be played over and over, and **the previous results are kept**, because every run is its
own row in `game_sessions`. One question set can be used across several classes and the results
compared. (Start another run by opening the host page with the same PIN and hitting Start again.)

---

## How to use it

Three roles, three different pages.

| Who | Opens | Does what |
| --- | --- | --- |
| **Teacher / admin** | `/Make/` | Write questions, add images, mark the correct answer, hit Save to get a PIN |
| **Big screen (host)** | `/host/?pin=XXXXXX` | Shows the PIN, picks a mode, hits Start, then displays the questions |
| **Player** | `/page/` | Enter PIN → pick a nickname and avatar → answer on their phone |

### Order of play

0. Sign in as a teacher or admin at `/auth/`
1. Build a question set at `/Make/` and hit **Save** — you get a 6-digit PIN
2. Open `/host/?pin=PIN` on the big screen or projector — it shows the PIN alongside a **QR code to join**
3. Players scan the QR (or open `/page/` and type the PIN), pick a nickname and an astronaut colour.
   Nicknames are capped at 10 characters; the dice button rolls a random one
4. The host picks a game mode and hits **Start**
5. **That's the last button anyone presses** — from here the game runs itself:
   time runs out → answer revealed → standings → next question → podium at the end

### Corner buttons (on every page)

🌐 switch Thai/English · 🔊 sound on/off · ⛶ fullscreen · the signed-in user's name plus a
sign-in/sign-out button (on `/page/`, `/Make/` and `/host/`)

The three live in one bar (`.corner-tools`), and JS measures its real width back into the CSS variable
`--tools-w`. Pages reserve space using that variable rather than a hard-coded number, because pages carry
different buttons and the language button changes width between languages.

Every page is checked for overlaps, horizontal overflow, and **nothing moving when the language is
switched**, at **320 / 360 / 390 / 768 / 1024 / 1280 / 1440 / 1736 px** wide.

---

## Project layout

```
server.js            Entry point — wires up the modules in server/ and listens (15 lines)
server/              The server, split by responsibility
├── config.js        Every constant (imports nothing — the bottom layer)
├── modes.js         Rules for all 6 modes + the streak bonus formula
├── db.js            SQLite, prepared queries, image file storage
├── rooms.js         Live rooms in memory + send/broadcast helpers
├── game.js          One question's cycle: ask → reveal → next or finish
├── auth.js          Passwords, cookies, sessions
├── api.js           Static file serving + REST
└── socket.js        Every WebSocket message

mangosgo.sqlite3     Database holding question sets and past results
uploads/             Question images (filename is a hash of the file contents)

auth/                Sign-up / sign-in page
dashboard/           Student, teacher and admin dashboards
Make/                Question authoring page
page/                PIN entry (the landing page)
lobby/               Nickname + avatar picker, then waiting room
game/                Player screen during play (phone)
host/                Big screen

shared/              Code every page uses
├── i18n.js          Thai/English dictionary + language toggle
├── sound.js         All sound (synthesised live — no audio files)
├── avatar.js        SVG astronaut in 12 colours
├── run.js           The chase scene for Black Hole Run
├── blocks.js        The answer-platform stage for Block Jump
├── qr.js            Builds the join QR code, no external library
├── preload.js       Pre-fetches question images while players wait in the lobby
├── nickname.js      Random nickname generator (10 characters max)
├── fullscreen.js    Fullscreen button
└── shared.css       Shared styles
```

Every page follows the same shape: `xxx.html` + `xxx.css` + `xxx.js`

---

## How the system works

### The one rule to remember

> **The server decides everything. The web pages are just displays.**

Which answer is correct, the scores, the time remaining, the question order, who is
eliminated — all computed on the server. The pages only draw what they receive and send
answers back. You cannot cheat by editing the client code.

There is no polling anywhere — everything is **pushed** over the WebSocket.

### Game state lives in memory

`server/rooms.js` keeps active rooms in a `Map` called `rooms`, keyed by PIN. Each room has its
own state, players, scores and timers, completely independent of other rooms. You can run
as many rooms at once as you like (the only cap is 50 players per room).

SQLite is only used to store **question sets from the Make page** and to log results
afterwards. It is not touched during play.

### Messages on the wire

**Page → server**

| Message | Sent by | Effect |
| --- | --- | --- |
| `HOST_ROOM {pin}` | Host screen | Loads the question set into a room and registers as a host (several screens at once is fine) |
| `JOIN_ROOM {pin, name, avatar, playerId?}` | Player | Joins the room. A `playerId` means "same person reconnecting" |
| `START_GAME {mode}` | Host | Starts the game in the chosen mode |
| `ANSWER {answer}` | Player | Submits an answer — one per question |

**Server → page**

| Message | Meaning |
| --- | --- |
| `HOST_READY` | You are hosting this room; includes the mode list and question count |
| `JOINED` | You are in; includes your id, score and avatar |
| `ROOM_STATE` | Latest player list and room phase |
| `QUESTION` | Current question, options, image and the real time remaining (ms) |
| `ANSWER_ACCEPTED` | Answer received — **but not whether it was right** |
| `ANSWER_RESULT` | That player's result, sent only when time is up |
| `ANSWER_COUNT` | How many have answered (host screens only) |
| `LEADERBOARD` | Correct answer, per-option counts, standings, and ms until the next question |
| `FINAL` | Final scores |
| `ERROR` | Problems, sent as a `code` for the page to translate |

### Rules the server enforces

- **Scoring** — a correct answer gives `100 + 900 × (time left ÷ total time)`, so answering
  faster is worth more
- **Streak bonus** — the second correct answer in a row adds +100, rising by 100 each time
  up to +500. A wrong answer or no answer breaks the streak immediately
- **Results are held back until time is up** — after answering you only see "waiting for
  others", so everyone learns the result at the same moment
- **The full timer always runs** — the question does not end early even when everyone has
  answered (set `END_WHEN_ALL_ANSWERED = true` to cut the question short instead)
- **15-second reconnect window** using the `playerId` stored in `sessionStorage` — score and
  streak survive, and reconnecting mid-question gets you the current question state
- **50 players per room.** Reconnecting players are exempt from this cap, otherwise someone
  already playing could be locked out of their own game

### Images in questions

The Make page sends images as data URLs, but the server does not store them that way — it
writes them into `uploads/` with the file's own hash as the filename, and keeps only
`/uploads/<hash>.png` in the question set.

**Why it matters:** if the image stayed embedded, that same blob would be sent inside every
`QUESTION` message to every player. A 50-player room with a 500 KB image is **25 MB for a
single question**. Sending just a URL makes the message ~0.2 KB per player, and the browser
caches the image for a long time.

The lobby also pre-fetches every image while players wait for the host to press Start, so
images appear instantly once the game begins.

Older question sets that still embed data URLs are converted automatically the first time
their room is opened.

---

## Game modes

Chosen on the host screen before Start. All modes share the same engine — only the rules differ.

| Mode | Rules |
| --- | --- |
| 🎯 **Classic** | Faster answers score more, plus the streak bonus (default) |
| 🎓 **Accuracy** | Every correct answer is worth 1000 — speed is irrelevant, so slower thinkers are not punished |
| 💀 **Survival** | A wrong answer or no answer knocks you out. You can keep watching but not answering. Last one standing ends the game |
| 🕳️ **Black Hole Run** | Your astronaut outruns a black hole: correct answer +1 distance (+2 if fast), wrong −1. Reach 0 and you get sucked in |
| 🧱 **Block Jump** | Jump onto the block you picked. Wrong blocks crumble and you fall — but nobody is eliminated, everyone plays every question |
| ⚡ **Rush** | Every question is squeezed to 5 seconds regardless of what the slide says |

### How Black Hole Run works

The chase scene lives on the **host screen only** — players' phones just show answer
buttons. In this mode the big screen never shows the question
text at all; the scene stays up the whole time, with every pilot in one shared arena. The
black hole sits on the left, so whoever is furthest right is winning. Every pilot is labelled
with their name.

Everyone starts at distance 5, the cap is 10, and hitting 0 means you are sucked in. Once
everybody is gone, the game ends immediately.

### How Block Jump works

Same pattern as Black Hole Run: the stage lives on the **host screen only** and the big screen
never shows the question text. Players see the question and the four coloured buttons on their
phones as usual, and each block on the big screen matches the colour of the button they tapped.

While the clock runs, the big screen shows empty blocks with every avatar floating above them
(the server withholds answers until time is up, so nobody can copy). At the reveal everyone drops
onto their chosen block at once. **Every block that is not the correct answer crumbles**, whether
or not anyone is standing on it, leaving the correct one alone. Players on a wrong block fall into
the pit with it; players who never answered fall from the sky through the gap between blocks.

The fall is per-question decoration — **nobody is actually eliminated**. Everyone floats back up
for the next question, and the winner is decided on total score, just like Classic.

---

## Two languages

Every page has a 🌐 button that switches between **Thai and English** instantly, with no
page reload. The choice is remembered in `localStorage`, so every page you open afterwards
uses the same language. Thai is the default.

The dictionary lives in exactly one place — [`shared/i18n.js`](shared/i18n.js) — with 120
keys present in both languages.

| Where the text lives | How to translate it |
| --- | --- |
| Static text in HTML | Add `data-i18n="key"` |
| placeholder / title attributes | Add `data-i18n-attr="placeholder"` |
| Browser tab title | `data-i18n-title` on the `<html>` tag |
| Text built by JS | `KG.i18n.t('key', { variables })` |
| Text drawn once and left alone | Register `KG.i18n.onChange(...)` so it redraws |

**The server never sends finished sentences**, because those could not be re-translated after
being sent. `ERROR` carries a `code` for the page to translate, and mode names are stored as
`{ th, en }` and sent as a pair.

Quiz titles and question text typed by the author are not translated — they appear as written.

---

## Where to change things

| You want to | Edit |
| --- | --- |
| Add a new game mode | `MODES` in `server/modes.js` — add one object and the card appears on the host screen by itself |
| Change the scoring formula | The `ANSWER` handler in `server/socket.js` |
| Change the ask/reveal/finish flow | `server/game.js` |
| Change how long results stay up | `LEADERBOARD_HOLD_MS` in `server/config.js` (currently 6s) |
| Change the player cap | `MAX_PLAYERS_PER_ROOM` in `server/config.js` |
| Add or fix a translation | `shared/i18n.js` |
| Change permission rules / guard another page | `GUARDED_PAGES` in `server/api.js` |
| Change the sign-in page | `auth/` |
| Change the dashboards / reports | `dashboard/` and `dashboardFor()` in `server/api.js` |
| Add avatar colours | `AVATARS` in `server/config.js` (the picker reads `GET /api/avatars`) |
| Add database tables or queries | `server/db.js` |
| Change the max nickname length | `MAX_NICKNAME_LENGTH` in `server/config.js` — also update `maxlength` in `lobby/lobby.html`, `NAME_LIMIT` in `lobby/lobby.js`, and the word lists in `shared/nickname.js` |
| Change the sounds | `shared/sound.js` — synthesised with Web Audio, there are no files to swap |
| Restyle the host screen | `host/host.css` — the layout switches on `<body>` classes (below) |

### Host screen `<body>` classes

| Class | Phase | Look |
| --- | --- | --- |
| (none) | Lobby | Big PIN + mode cards + Start button |
| `is-playing is-question` | Question | Lobby chrome hidden; question and options fill the screen |
| `is-playing is-reveal` | Reveal | Same, plus standings and per-option counts |
| `is-run` | Black hole mode | Question hidden, only the chase scene |
| `is-blocks` | Block Jump mode | Question hidden, only the answer-platform stage |
| `is-final` | Game over | Full-screen podium |

### Mode options (used inside `MODES`)

`flatScore` / `noSpeed` (ignore the clock) · `noStreak` (no streak bonus) · `duration`
(force a time limit) · `eliminate` (wrong answer knocks you out) · `blackhole` (distance
mechanic) · `blocks` (answer-platform stage) · `endWhenAlive` (how many survivors ends the game)

---

## Limits you should know before real use

**Fine for a classroom or a shared Wi-Fi network today.** It has been tested with 50
simultaneous players, reconnects work, multiple rooms do not interfere with each other, and
throwing malformed data at the server does not bring it down.

**But do not put it on the public internet yet:**

1. **No password reset or email verification.** If someone forgets their password an admin has to fix
   it in the database
2. **Restarting the server wipes any game in progress**, because state lives only in memory
3. **A PIN cannot be replayed immediately.** After a game ends, pressing Start does nothing —
   everyone has to close their tabs and wait 15 seconds for the room to reset, or you make a
   new PIN. ← the thing you will hit most often when teaching back-to-back classes
4. **No HTTPS/wss**, which modern browsers will block on a real domain
5. **Anyone can create unlimited question sets** — `POST /api/quizzes` is wide open

### Smaller things worth knowing

- A `correctIndex` beyond the number of options (only reachable by calling the API directly —
  the Make page cannot produce it) is accepted silently, and then nobody can ever answer that
  question correctly
- The `uploads/` folder must always travel with `mangosgo.sqlite3`. Move machines without it
  and the images are gone
- The database currently holds 118 question sets, most of them created during testing. Safe
  to delete

---

## Database

`mangosgo.sqlite3` has eight tables.

| Table | Holds |
| --- | --- |
| `users` | Accounts (email, name, scrypt password hash, role) |
| `sessions` | Live session tokens with their expiry |
| `game_sessions` | One row per game run (PIN, title, mode, who started it, start/end time) |
| `session_results` | Each player's rank and score in that run — `user_id` is NULL for guests |
| `session_answers` | Per-question answers for that run, behind the "correct per question" bars |
| `quizzes` | Question sets (PIN, title, all slides as JSON, status, the author's `owner_id`) |
| `players` | Who joined which PIN |
| `answers` | Each player's answer per question, with the score earned |

`users`, `sessions` and the `owner_id` column are created automatically on startup, so an existing
database keeps working. Question sets made before accounts existed have `owner_id` set to `NULL`,
meaning nobody owns them.

Every write during a game is wrapped in try/catch — if the write fails, the running game must
not go down with it.

## REST endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/register` | Create an account — the first one on the system becomes admin |
| `POST /api/auth/login` | Sign in and receive the session cookie |
| `POST /api/auth/logout` | Sign out and delete the session |
| `GET /api/auth/me` | Who is signed in (`hasUsers` says whether any account exists yet) |
| `GET /api/dashboard` | Dashboard data, shaped by the caller's role |
| `GET /api/session?id=` | One game's report (owner / host / admin only) |
| `POST /api/quizzes/delete` | Delete a question set (owner or admin) |
| `POST /api/users/role` | Change someone's role (admin only) |
| `POST /api/quizzes` | The Make page saves a question set and gets a PIN back (teacher/admin only) |
| `POST /api/join` | The PIN page checks the game exists before sending the player to the lobby |
| `GET /api/avatars` | Avatar colour list for the picker |
