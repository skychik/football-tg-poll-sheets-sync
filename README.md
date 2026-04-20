# Football Telegram Poll to Google Sheets Sync Bot

Telegram bot that tracks poll voters and syncs attendee data to Google Sheets.
It supports both manual updates and poll-driven updates. With **`REDIS_URL`** set, poll state is stored in Redis so data survives restarts; in development you can omit **`REDIS_URL`** and the bot uses in-memory storage instead (see **Setup**).

## Features

- Create non-anonymous, multi-answer polls with `/poll`
- Track live voter changes via Telegram `poll_answer` updates
- Persist poll state in Redis when **`REDIS_URL`** is set (`poll:{pollId}`), or in-memory when it is not (development fallback) / when **`POLL_STORAGE=memory`** is set
- Forward poll messages back to the bot to extract voters
- Continue to column/date/cost/player-count workflow for Google Sheets updates
- Protect existing values with confirmation before overwrite

## Usage

### Commands

- `/start` - Show welcome/help text
- `/poll` - Create trackable poll
- `/update` - Start manual update workflow
- `/help` - Show command help
- `/cancel` or `/abort` - Cancel current operation

### Typical flow

1. Create poll with `/poll` and collect votes
2. Forward that poll to the bot
3. Choose:
  - `1` to update sheet
  - `2` to view voters
4. If updating, select the option containing attendees
5. Complete column/metadata prompts and write to sheet

## Spreadsheet structure

- Column `B`: Telegram usernames (for example `@almoga`)
- Date columns start from `E+`
- Player rows start from `7`

Adjust constants in `constants.ts` if your sheet layout differs.

## Bot Conversation Flow

The bot supports two entry points: `/update` (manual) and forwarded poll (poll-based).

```mermaid
stateDiagram-v2
    [*] --> DetectColumn: /update or poll forwarded

    state PollFlow {
        ForwardPoll --> AskPollIntent: Poll recognized
        AskPollIntent --> ViewVoters: User chooses "2"
        AskPollIntent --> SelectOption: User chooses "1"
        SelectOption --> DetectColumn: Usernames extracted
        ViewVoters --> [*]: Show voters and reset
    }

    state MainFlow {
        DetectColumn --> ConfirmColumn: Last column found
        DetectColumn --> AskNewColumn: No columns found
        ConfirmColumn --> CheckMetadata: User confirms detected column
        ConfirmColumn --> AskDateName: User creates new column
        ConfirmColumn --> CheckMetadata: User types column letter
        ConfirmColumn --> ColumnSelection: Date text has multiple matches
        ConfirmColumn --> CheckMetadata: Date text has one match
        ColumnSelection --> CheckMetadata: User selects a match
        AskNewColumn --> AskDateName: New column confirmed
        AskNewColumn --> [*]: User cancels

        CheckMetadata --> AskDateName: Date missing
        CheckMetadata --> AskCost: Cost missing
        CheckMetadata --> AskUsernames: Metadata complete
        AskDateName --> CheckMetadata: Date saved
        AskCost --> CheckMetadata: Cost saved

        AskUsernames --> CheckPlayerCount: Usernames matched
        CheckPlayerCount --> ConfirmPlayerCount: Count missing
        CheckPlayerCount --> CheckOverride: Count exists
        ConfirmPlayerCount --> AskPlayerCount: User says no
        ConfirmPlayerCount --> CheckOverride: User confirms
        AskPlayerCount --> CheckOverride: Count saved

        CheckOverride --> ConfirmOverride: Conflicts found
        CheckOverride --> WriteData: No conflicts
        ConfirmOverride --> WriteData: User decides
        WriteData --> [*]: Done and reset
    }
```



### Redis Data Flow

When **`REDIS_URL`** is configured, this is the runtime architecture for poll creation, vote tracking, and forwarded poll processing (with in-memory storage, handlers keep the same flow but data stays in process memory only).

```mermaid
flowchart TD
    telegramUser[Telegram_User]
    botHandlers[Bot_Handlers]
    redisStore[Redis_poll_pollId]
    sheets[Google_Sheets]

    telegramUser -->|"/poll command"| botHandlers
    botHandlers -->|"create poll metadata"| redisStore
    telegramUser -->|"vote or change vote"| botHandlers
    botHandlers -->|"update votes for pollId"| redisStore
    telegramUser -->|"forward poll message"| botHandlers
    botHandlers -->|"read pollId data"| redisStore
    botHandlers -->|"selected attendees"| sheets
```



## Prerequisites

- [Bun](https://bun.sh)
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- Google Cloud project with Google Sheets API enabled
- Service account credentials with access to your spreadsheet
- **Redis** — optional for local development if you omit **`REDIS_URL`** (in-memory poll storage; polls are lost on restart and startup logs a warning). For production, set **`REDIS_URL`** unless you explicitly set **`POLL_STORAGE=memory`** (same restart data loss as in-memory)

## Setup

### 1) Install dependencies

```bash
bun install
```

Run scenario-style integration tests (in-memory poll storage, stub Sheets client, recorded Telegram API):

```bash
bun test
```

### 2) Create Telegram bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Run `/newbot`
3. Save the bot token

### 3) Configure Google Sheets API

1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **Google Sheets API**
3. Create a service account and JSON key
4. Share your spreadsheet with the service account email as **Editor**

### 4) Configure environment variables

Create `.env` in the project root (see [`.env.example`](.env.example) for the full template). Poll storage behavior matches that file:

- **`REDIS_URL`** — In **development**, optional. If you omit it, the bot uses **in-memory** poll storage (polls reset on restart; startup logs a warning). In **production**, you must set **`REDIS_URL`** unless you intentionally use in-memory (see **`POLL_STORAGE`**).
- **`POLL_STORAGE=memory`** — Forces in-memory poll storage in any environment (same data loss on restart). Use when you explicitly want Redis disabled.

```bash
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Google Sheets service account (use one approach)
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=./path/to/service-account-key.json
# GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
# GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Spreadsheet
SPREADSHEET_ID=1eX1xQF31-...

# Poll storage (optional in development — omit REDIS_URL for in-memory + warning)
# REDIS_URL=redis://localhost:6379
# POLL_STORAGE=memory
```

### 5) Configure Redis on Railway

1. Add a Redis service in Railway
2. Ensure your bot service receives **`REDIS_URL`** so polls persist across deploys

If **`REDIS_URL`** is set but Redis is unreachable, startup fails when the bot pings Redis. If **`REDIS_URL`** is omitted in production without **`POLL_STORAGE=memory`**, startup fails with an error requiring Redis or an explicit in-memory choice.

## Run

Start with auto-reload:

```bash
bun dev
```

With no **`REDIS_URL`** in development, the process starts using in-memory poll storage (see logs). With **`REDIS_URL`** set, the bot connects to Redis on startup.

## Verification

### Local Redis startup

Skip this subsection if you are running without **`REDIS_URL`** (in-memory mode). Use it when **`REDIS_URL`** points at a local Redis.

Option A (Homebrew):

```bash
brew install redis
brew services start redis
```

Option B (Docker):

```bash
docker run --name local-redis -p 6379:6379 redis:7
```

Check connectivity:

```bash
redis-cli -u redis://localhost:6379 ping
```

Expected result: `PONG`

### Persistence check

Requires **`REDIS_URL`** (or any setup where poll data is not only in the in-memory fallback).

1. Start bot (`bun run dev`)
2. Create a poll with `/poll go | Sat | Sun`
3. Cast votes in Telegram
4. Restart the bot
5. Forward the same poll again and confirm voters are still available (with in-memory storage, votes are expected to be gone after restart)

Inspect Redis data:

```bash
redis-cli -u redis://localhost:6379 keys "poll:*"
redis-cli -u redis://localhost:6379 get "poll:<pollId>"
```

### Optional Redis UI

`Redis Commander` is a browser UI for browsing keys and values.

Run with Docker:

```bash
docker run --rm -p 8082:8081 \
  -e REDIS_HOSTS=local:host.docker.internal:6379:0 \
  rediscommander/redis-commander:latest
```

Open `http://localhost:8082`.

If you see `Status: reconnecting` on macOS while `redis-cli ... ping` returns `PONG`, use `host.docker.internal` instead of `localhost` for the Redis host.

Alternative: `RedisInsight` desktop app can connect directly to `127.0.0.1:6379`.

## License

MIT