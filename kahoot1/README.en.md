# MangosGo

A real-time quiz game built from scratch — write your questions, put them on the big
screen, and players join with a PIN. Handles 50 players per room, has 5 game modes, and
runs in both Thai and English.

The server is a **single Node file** (`server.js`) serving both the web pages and the
WebSocket on the same port. No framework, no build step — edit a file, refresh the browser.

🇹🇭 [อ่านฉบับภาษาไทย](README.md)

---

## Contents

- [Up and running in 3 minutes](#up-and-running-in-3-minutes)
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

Change the port with `PORT=8100 npm start`

### Letting others on the same Wi-Fi join

Find your machine's IP first (on Windows run `ipconfig` and look at the IPv4 address, e.g.
`192.168.1.50`), then have players open `http://192.168.1.50:8000` on their phones. Everyone
has to be on the same Wi-Fi network.

---

## How to use it

Three roles, three different pages.

| Who | Opens | Does what |
| --- | --- | --- |
| **Quiz author** | `/Make/` | Write questions, add images, mark the correct answer, hit Save to get a PIN |
| **Big screen (host)** | `/host/?pin=XXXXXX` | Shows the PIN, picks a mode, hits Start, then displays the questions |
| **Player** | `/page/` | Enter PIN → pick a nickname and avatar → answer on their phone |

### Order of play

1. Build a question set at `/Make/` and hit **Save** — you get a 6-digit PIN
2. Open `/host/?pin=PIN` on the big screen or projector
3. Players open `/page/`, enter the PIN, pick a nickname and an astronaut colour
4. The host picks a game mode and hits **Start**
5. **That's the last button anyone presses** — from here the game runs itself:
   time runs out → answer revealed → standings → next question → podium at the end

### Corner buttons (on every page)

🌐 switch Thai/English · 🔊 sound on/off · ⛶ fullscreen

---

## Project layout

```
server.js            The whole server — static files + REST + WebSocket + game rules
mangosgo.sqlite3     Database holding question sets and past results
uploads/             Question images (filename is a hash of the file contents)

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
├── preload.js       Pre-fetches question images while players wait in the lobby
├── nickname.js      Random nickname generator
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

`server.js` keeps active rooms in a `Map` called `rooms`, keyed by PIN. Each room has its
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
| ⚡ **Rush** | Every question is squeezed to 5 seconds regardless of what the slide says |

### How Black Hole Run works

The chase scene lives on the **host screen only** — players' phones just show answer
buttons. In this mode the big screen never shows the question
text at all; the scene stays up the whole time, with every pilot in one shared arena. The
black hole sits on the left, so whoever is furthest right is winning. Every pilot is labelled
with their name.

Everyone starts at distance 5, the cap is 10, and hitting 0 means you are sucked in. Once
everybody is gone, the game ends immediately.

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
| Add a new game mode | `MODES` in `server.js` — add one object and the card appears on the host screen by itself |
| Change the scoring formula | The `ANSWER` handler in `server.js` |
| Change how long results stay up | `LEADERBOARD_HOLD_MS` (currently 6s) |
| Change the player cap | `MAX_PLAYERS_PER_ROOM` |
| Add or fix a translation | `shared/i18n.js` |
| Add avatar colours | `AVATARS` in `server.js` (the picker reads `GET /api/avatars`) |
| Change the sounds | `shared/sound.js` — synthesised with Web Audio, there are no files to swap |
| Restyle the host screen | `host/host.css` — the layout switches on `<body>` classes (below) |

### Host screen `<body>` classes

| Class | Phase | Look |
| --- | --- | --- |
| (none) | Lobby | Big PIN + mode cards + Start button |
| `is-playing is-question` | Question | Lobby chrome hidden; question and options fill the screen |
| `is-playing is-reveal` | Reveal | Same, plus standings and per-option counts |
| `is-run` | Black hole mode | Question hidden, only the chase scene |
| `is-final` | Game over | Full-screen podium |

### Mode options (used inside `MODES`)

`flatScore` / `noSpeed` (ignore the clock) · `noStreak` (no streak bonus) · `duration`
(force a time limit) · `eliminate` (wrong answer knocks you out) · `blackhole` (distance
mechanic) · `endWhenAlive` (how many survivors ends the game)

---

## Limits you should know before real use

**Fine for a classroom or a shared Wi-Fi network today.** It has been tested with 50
simultaneous players, reconnects work, multiple rooms do not interfere with each other, and
throwing malformed data at the server does not bring it down.

**But do not put it on the public internet yet:**

1. **There is no authentication at all.** Anyone who knows the PIN can open
   `/host/?pin=xxx` and press Start. Harmless in a classroom, not on the internet
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

`mangosgo.sqlite3` has three tables.

| Table | Holds |
| --- | --- |
| `quizzes` | Question sets (PIN, title, all slides as JSON, status) |
| `players` | Who joined which PIN |
| `answers` | Each player's answer per question, with the score earned |

Every write during a game is wrapped in try/catch — if the write fails, the running game must
not go down with it.

## REST endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /api/quizzes` | The Make page saves a question set and gets a PIN back |
| `POST /api/join` | The PIN page checks the game exists before sending the player to the lobby |
| `GET /api/avatars` | Avatar colour list for the picker |
