---
name: private-dm-after-write
overview: Send private notifications only after a poll-driven sheet update succeeds, but only to selected poll users whose target cell was empty or `0` before the write. Persist Telegram user ids from poll answers so the bot can DM them, tell users at bot start that the bot may later message them to confirm payment, and report back to the operator when someone must start the bot first.
todos:
  - id: persist-recipient-ids
    content: Extend poll storage/domain to persist username -> Telegram user id from poll_answer events.
    status: pending
  - id: classify-target-cells
    content: Add sheet helper that classifies each selected user's target cell as empty, zero, or other.
    status: pending
  - id: send-dms-after-write
    content: Trigger DMs only after successful sheet write and report unreachable users back to the operator.
    status: pending
  - id: add-onboarding-copy
    content: Update the start/help copy so users know the bot may later message them privately to confirm whether they paid.
    status: pending
  - id: cover-new-flow
    content: Add focused tests for DM eligibility, exclusion, and unreachable recipients.
    status: pending
isProject: false
---

# Private DM After Write

## Current hook points
- The selected poll option currently becomes `ctx.session.usernames`, then the flow moves into day/column selection in [`/Users/skychik/football-tg-poll-sheets-sync/telegram/poll/selection-flow.ts`](/Users/skychik/football-tg-poll-sheets-sync/telegram/poll/selection-flow.ts):

```82:113:/Users/skychik/football-tg-poll-sheets-sync/telegram/poll/selection-flow.ts
export async function applyPollOptionSelectionAndStartUpdate(
  ctx: MyContext,
  pollData: PollData,
  optionIndex: number,
  notify: (text: string) => Promise<unknown>,
): Promise<boolean> {
  // ...
  const voters = pollData.votes.get(optionIndex) || new Set();
  const usernames = Array.from(voters);
  // ...
  ctx.session.usernames = usernames;
  // ...
  await startColumnDetectionFlow(ctx);
  return true;
}
```

- The best success trigger for DMs is after the sheet write succeeds in [`/Users/skychik/football-tg-poll-sheets-sync/workflow/write-flow.ts`](/Users/skychik/football-tg-poll-sheets-sync/workflow/write-flow.ts), before the session is reset:

```70:113:/Users/skychik/football-tg-poll-sheets-sync/workflow/write-flow.ts
export async function writeZerosAndRespond(
  ctx: MyContext,
  nicknameRows: Map<string, number>,
  column: string,
  overrideExisting: boolean,
  skippedNicknames: string[],
): Promise<void> {
  // ...
  const result = await sheetsClient.writeZeros(
    nicknameRows,
    column,
    overrideExisting,
  );
  // ...
  await ctx.reply(response);
  resetSession(ctx.session);
}
```

- The current sheet read path only distinguishes `empty` vs `non-empty`, and treats `0` as an existing filled value in [`/Users/skychik/football-tg-poll-sheets-sync/sheets/google-sheets-client.ts`](/Users/skychik/football-tg-poll-sheets-sync/sheets/google-sheets-client.ts):

```166:177:/Users/skychik/football-tg-poll-sheets-sync/sheets/google-sheets-client.ts
if (values.length > 0 && values[0] && values[0].length > 0) {
  const cellValue = values[0][0];
  if (
    cellValue !== null &&
    cellValue !== undefined &&
    String(cellValue).trim() !== ''
  ) {
    existingValues.push({ nickname, value: cellValue });
  }
}
```

- The bot already has a natural onboarding entrypoint in [`/Users/skychik/football-tg-poll-sheets-sync/telegram/commands.ts`](/Users/skychik/football-tg-poll-sheets-sync/telegram/commands.ts), so the expectation-setting copy can live in `/start` and likely `/help`:

```20:40:/Users/skychik/football-tg-poll-sheets-sync/telegram/commands.ts
bot.command('start', async (ctx) => {
  await ctx.reply(
    `👋 Welcome to Football Poll Sheets Sync Bot!\n\n` +
      `📖 Commands:\n` +
      `• /poll - Create a trackable poll\n` +
      `• /update - Update Google Sheet with attending players\n` +
      `• /help - Show this help\n` +
      `• /cancel or /abort - Cancel current operation\n\n` +
      `💡 Tip: Forward a poll created by this bot to see voters or update the sheet!`,
  );
});
```

## Plan
- Extend poll persistence so each tracked voter can be resolved to a Telegram recipient id, not only `@username`. Update [`/Users/skychik/football-tg-poll-sheets-sync/poll-domain.ts`](/Users/skychik/football-tg-poll-sheets-sync/poll-domain.ts), [`/Users/skychik/football-tg-poll-sheets-sync/poll-storage/poll-storage-types.ts`](/Users/skychik/football-tg-poll-sheets-sync/poll-storage/poll-storage-types.ts), and the storage implementations under [`/Users/skychik/football-tg-poll-sheets-sync/poll-storage`](/Users/skychik/football-tg-poll-sheets-sync/poll-storage). Capture `pollAnswer.user.id` in [`/Users/skychik/football-tg-poll-sheets-sync/telegram/poll/answer-handler.ts`](/Users/skychik/football-tg-poll-sheets-sync/telegram/poll/answer-handler.ts) so the bot can later DM the same Telegram user.
- Add a sheet-level cell classification step that can tell, for each selected username in the chosen column, whether the target cell is `empty`, `0`, or `other`. Put this beside the existing read helpers in [`/Users/skychik/football-tg-poll-sheets-sync/sheets/google-sheets-client.ts`](/Users/skychik/football-tg-poll-sheets-sync/sheets/google-sheets-client.ts) and expose it through [`/Users/skychik/football-tg-poll-sheets-sync/sheets/sheets-types.ts`](/Users/skychik/football-tg-poll-sheets-sync/sheets/sheets-types.ts). This avoids overloading `checkExistingValues()`, which currently cannot express the new rule.
- Compute the notification candidates before the write, then send DMs only after `writeZeros()` succeeds. Thread that candidate list through [`/Users/skychik/football-tg-poll-sheets-sync/workflow/write-flow.ts`](/Users/skychik/football-tg-poll-sheets-sync/workflow/write-flow.ts) so successful writes can notify only users whose pre-write cell was `empty` or `0`, while still preserving the existing override flow for non-empty values.
- Add a small notification helper, likely in [`/Users/skychik/football-tg-poll-sheets-sync/bot-helpers.ts`](/Users/skychik/football-tg-poll-sheets-sync/bot-helpers.ts) or a new Telegram helper module, that formats the private message using the poll question and chosen day/column context, calls `ctx.api.sendMessage(userId, text)`, and collects failures. If Telegram rejects a DM because the user has not started the bot, send a follow-up summary to the operator listing those usernames and telling them those people must initiate a chat with the bot first.
- Update the onboarding/help copy in [`/Users/skychik/football-tg-poll-sheets-sync/telegram/commands.ts`](/Users/skychik/football-tg-poll-sheets-sync/telegram/commands.ts) so when a user starts the bot they are explicitly told that the bot may later write to them privately to double-check whether they gave money. That makes later reminder DMs expected rather than surprising.
- Preserve the existing operator-facing update result and append the DM delivery summary afterward, rather than moving the main success message. This keeps the sheet update confirmation independent from notification delivery.
- Add focused tests around the new behavior using the existing Telegram test kit in [`/Users/skychik/football-tg-poll-sheets-sync/test/support/create-test-bot.ts`](/Users/skychik/football-tg-poll-sheets-sync/test/support/create-test-bot.ts) and API recorder in [`/Users/skychik/football-tg-poll-sheets-sync/test/support/mock-telegram-api.ts`](/Users/skychik/football-tg-poll-sheets-sync/test/support/mock-telegram-api.ts): one onboarding-copy case, one success case (`empty`/`0` users get DMs), one exclusion case (`other` values do not), and one unreachable-user case (operator sees the "must start bot" list).