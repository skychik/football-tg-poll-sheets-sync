import { InlineKeyboard } from 'grammy';
import { handleApiError, replyErrorAndReset } from '../bot-helpers';
import { ERR_SESSION_DATA_LOST } from '../constants';
import { CallbackPrefix } from '../keyboards';
import type { MyContext } from '../session';
import { resetSession } from '../session';
import type { PlayerRosterEntry } from '../sheets/sheets-types';
import { escapeMarkdownV2, replyMarkdownV2 } from '../telegram/markdown-v2';
import { checkOverridesAndWrite } from '../workflow/write-flow';

const PAGE_SIZE = 5;

function attendeeLabel(player: PlayerRosterEntry): string {
  if (player.name && player.nickname)
    return `${player.name} / ${player.nickname}`;
  return player.name || player.nickname || `row ${player.row}`;
}

function entryKey(player: PlayerRosterEntry): string {
  return player.nickname || player.name || `row ${player.row}`;
}

function normalizeUsername(raw: string): string | null {
  const username = raw.trim().replace(/^@+/, '');
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    return null;
  }
  return `@${username}`;
}

export function parseNewAttendeeInput(text: string): {
  name: string;
  nickname?: string;
  error?: string;
} {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return { name: '', error: 'Name cannot be empty' };
  }

  const usernameMatch = trimmed.match(/(?:^|\s)@([A-Za-z0-9_]{1,64})(?=\s|$)/);
  if (!usernameMatch) {
    return { name: trimmed };
  }

  const nickname = normalizeUsername(usernameMatch[1]);
  if (!nickname) {
    return {
      name: '',
      error:
        'Telegram username must be 5-32 characters and contain only letters, numbers, or underscores',
    };
  }

  const name = trimmed
    .replace(usernameMatch[0], usernameMatch[0].startsWith(' ') ? ' ' : '')
    .trim();
  if (!name) {
    return { name: '', error: 'Name cannot be empty' };
  }

  return { name, nickname };
}

const ruToLatPairs: Array<[string, string]> = [
  ['щ', 'shch'],
  ['ё', 'yo'],
  ['ж', 'zh'],
  ['х', 'kh'],
  ['ц', 'ts'],
  ['ч', 'ch'],
  ['ш', 'sh'],
  ['ю', 'yu'],
  ['я', 'ya'],
  ['а', 'a'],
  ['б', 'b'],
  ['в', 'v'],
  ['г', 'g'],
  ['д', 'd'],
  ['е', 'e'],
  ['з', 'z'],
  ['и', 'i'],
  ['й', 'y'],
  ['к', 'k'],
  ['л', 'l'],
  ['м', 'm'],
  ['н', 'n'],
  ['о', 'o'],
  ['п', 'p'],
  ['р', 'r'],
  ['с', 's'],
  ['т', 't'],
  ['у', 'u'],
  ['ф', 'f'],
  ['ы', 'y'],
  ['э', 'e'],
  ['ъ', ''],
  ['ь', ''],
];

function transliterateRuToLat(text: string): string {
  let out = text.toLowerCase();
  for (const [ru, lat] of ruToLatPairs) {
    out = out.replaceAll(ru, lat);
  }
  return out;
}

function transliterateLatToRu(text: string): string {
  let out = text.toLowerCase();
  const pairs = [...ruToLatPairs].sort((a, b) => b[1].length - a[1].length);
  for (const [ru, lat] of pairs) {
    if (lat) out = out.replaceAll(lat, ru);
  }
  return out;
}

function searchableVariants(text: string): string[] {
  const normalized = text.toLowerCase().replace(/^@+/, '').trim();
  return Array.from(
    new Set([
      normalized,
      transliterateRuToLat(normalized),
      transliterateLatToRu(normalized),
    ]),
  ).filter(Boolean);
}

export function searchRoster(
  roster: PlayerRosterEntry[],
  query: string,
): PlayerRosterEntry[] {
  const needles = searchableVariants(query);
  if (needles.length === 0) return [];

  return roster.filter((player) => {
    const haystacks = [
      player.name,
      player.nickname ?? '',
      player.nickname?.replace(/^@+/, '') ?? '',
    ].flatMap(searchableVariants);
    return needles.some((needle) =>
      haystacks.some((haystack) => haystack.includes(needle)),
    );
  });
}

function removeDuplicateRows(
  entries: Array<[string, number]>,
): Array<[string, number]> {
  const seenRows = new Set<number>();
  const result: Array<[string, number]> = [];
  for (const entry of entries) {
    if (seenRows.has(entry[1])) continue;
    seenRows.add(entry[1]);
    result.push(entry);
  }
  return result;
}

function addResolvedAttendee(ctx: MyContext, player: PlayerRosterEntry): void {
  const current = ctx.session.pollResolvedAttendeesEntries ?? [];
  ctx.session.pollResolvedAttendeesEntries = removeDuplicateRows([
    ...current,
    [entryKey(player), player.row],
  ]);
}

function remainingMissing(ctx: MyContext): number {
  return Math.max(0, ctx.session.pollUnknownQueries?.length ?? 0);
}

async function proceedAfterResolved(ctx: MyContext): Promise<void> {
  const unknownQueries = ctx.session.pollUnknownQueries ?? [];
  if (unknownQueries.length > 0) {
    await askMissingQuery(ctx);
    return;
  }

  const entries = ctx.session.pollResolvedAttendeesEntries ?? [];
  if (!ctx.session.targetColumn || entries.length === 0) {
    await replyErrorAndReset(ctx, ERR_SESSION_DATA_LOST);
    return;
  }

  const nicknameRows = new Map<string, number>(entries);
  ctx.session.nicknameRowsEntries = entries;
  ctx.session.usernames = entries.map(([label]) => label);
  const sheets = await ctx.services.createSheetsClient();
  await sheets.writeColumnMetadata(
    ctx.session.targetColumn,
    undefined,
    undefined,
    ctx.session.playerCount,
  );
  await checkOverridesAndWrite(ctx, nicknameRows);
}

export async function startPollAttendanceCount(ctx: MyContext): Promise<void> {
  if (!ctx.session.pollReconciliationActive || !ctx.session.usernames?.length) {
    await replyErrorAndReset(ctx, ERR_SESSION_DATA_LOST);
    return;
  }

  ctx.session.state = 'awaiting_poll_attendance_count';
  const players = ctx.session.usernames.map(escapeMarkdownV2).join(', ');
  await replyMarkdownV2(
    ctx,
    `👥 Poll option voters:\n${players}\n\n*How many players* attended the match?`,
  );
}

export async function handlePollAttendanceCount(
  ctx: MyContext,
  text: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_poll_attendance_count') {
    return false;
  }

  const count = parseInt(text, 10);
  if (Number.isNaN(count) || count < 0) {
    await replyMarkdownV2(
      ctx,
      '❌ Please provide a *valid positive integer* for the attendance count\\.',
    );
    return true;
  }

  ctx.session.playerCount = count;
  ctx.session.pollSelectedUsernames = [...ctx.session.usernames];
  ctx.session.pollRemainingUsernames = [...ctx.session.usernames];
  ctx.session.pollRemovedUsernames = [];
  ctx.session.pollSearchPage = 0;

  await showNoShowReview(ctx, 0);
  return true;
}

export async function handlePollNoShowReviewText(
  ctx: MyContext,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_poll_no_show_review') {
    return false;
  }

  await replyMarkdownV2(
    ctx,
    'Use the buttons to remove no\\-shows, then press *Done*\\.',
  );
  return true;
}

function noShowKeyboard(usernames: string[], page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const totalPages = Math.max(1, Math.ceil(usernames.length / PAGE_SIZE));
  const start = page * PAGE_SIZE;
  const pageItems = usernames.slice(start, start + PAGE_SIZE);

  pageItems.forEach((username) => {
    keyboard.text(
      `Remove ${username}`,
      `${CallbackPrefix.PLAYER}rm:${username}`,
    );
    keyboard.row();
  });

  if (totalPages > 1) {
    if (page > 0)
      keyboard.text('◀️ Prev', `${CallbackPrefix.PLAYER}rmp:${page - 1}`);
    if (page < totalPages - 1)
      keyboard.text('Next ▶️', `${CallbackPrefix.PLAYER}rmp:${page + 1}`);
    keyboard.row();
  }
  keyboard.text('✅ Done', `${CallbackPrefix.PLAYER}rmdone`);
  return keyboard;
}

async function showNoShowReview(ctx: MyContext, page: number): Promise<void> {
  const usernames = ctx.session.pollRemainingUsernames ?? [];
  ctx.session.state = 'awaiting_poll_no_show_review';
  ctx.session.pollSearchPage = page;
  const total = ctx.session.playerCount ?? 0;
  const removed = ctx.session.pollRemovedUsernames ?? [];
  const list = usernames.length
    ? usernames.map((u) => `• ${escapeMarkdownV2(u)}`).join('\n')
    : '_Nobody left from the poll option_';
  const removedText = removed.length
    ? `\n\nRemoved:\n${removed.map((u) => `• ${escapeMarkdownV2(u)}`).join('\n')}`
    : '';

  await replyMarkdownV2(
    ctx,
    `Real attendance count: *${total}*\n\nRemove voters who did *not* play:\n${list}${removedText}`,
    { reply_markup: noShowKeyboard(usernames, page) },
  );
}

export async function handlePlayerCallback(
  ctx: MyContext,
  data: string,
): Promise<boolean> {
  if (data.startsWith('rm:')) {
    const username = data.slice(3);
    const remaining = ctx.session.pollRemainingUsernames ?? [];
    ctx.session.pollRemainingUsernames = remaining.filter(
      (u) => u !== username,
    );
    ctx.session.pollRemovedUsernames = [
      ...(ctx.session.pollRemovedUsernames ?? []),
      username,
    ];
    await showNoShowReview(ctx, ctx.session.pollSearchPage ?? 0);
    return true;
  }

  if (data.startsWith('rmp:')) {
    await showNoShowReview(ctx, parseInt(data.slice(4), 10) || 0);
    return true;
  }

  if (data === 'rmdone') {
    await finishNoShowReview(ctx);
    return true;
  }

  if (data.startsWith('sp:')) {
    await showSearchResults(ctx, parseInt(data.slice(3), 10) || 0);
    return true;
  }

  if (data.startsWith('pick:')) {
    const idx = parseInt(data.slice(5), 10);
    const player = ctx.session.pollSearchResults?.[idx];
    if (!player) {
      await replyMarkdownV2(ctx, '❌ This selection is no longer available\\.');
      return true;
    }
    ctx.session.pollPendingPlayer = player;
    await showExistingPlayerConfirmation(ctx, player);
    return true;
  }

  if (data === 'retry') {
    await askMissingQuery(ctx, true);
    return true;
  }

  if (data === 'addnew') {
    await askNewAttendeeInput(ctx);
    return true;
  }

  if (data === 'confirm-existing:yes') {
    const player = ctx.session.pollPendingPlayer;
    if (!player) {
      await replyErrorAndReset(ctx, ERR_SESSION_DATA_LOST);
      return true;
    }
    addResolvedAttendee(ctx, player);
    ctx.session.pollUnknownQueries = (
      ctx.session.pollUnknownQueries ?? []
    ).slice(1);
    ctx.session.pollPendingPlayer = undefined;
    await proceedAfterResolved(ctx);
    return true;
  }

  if (data === 'confirm-existing:no') {
    ctx.session.pollPendingPlayer = undefined;
    await askMissingQuery(ctx, true);
    return true;
  }

  if (data === 'confirm-new:yes') {
    await savePendingNewAttendee(ctx);
    return true;
  }

  if (data === 'confirm-new:no') {
    await askNewAttendeeInput(ctx);
    return true;
  }

  return false;
}

async function finishNoShowReview(ctx: MyContext): Promise<void> {
  if (!ctx.session.targetColumn || ctx.session.playerCount === undefined) {
    await replyErrorAndReset(ctx, ERR_SESSION_DATA_LOST);
    return;
  }

  const remaining = ctx.session.pollRemainingUsernames ?? [];
  if (remaining.length > ctx.session.playerCount) {
    await replyMarkdownV2(
      ctx,
      `You still have *${remaining.length}* poll voters selected, but attendance count is *${ctx.session.playerCount}*\\. Remove more no\\-shows or start again with /update\\.`,
    );
    await showNoShowReview(ctx, ctx.session.pollSearchPage ?? 0);
    return;
  }

  try {
    const sheets = await ctx.services.createSheetsClient();
    const [nicknameRows, roster] = await Promise.all([
      sheets.findNicknameRows(remaining),
      sheets.listPlayers(),
    ]);

    ctx.session.pollRosterEntries = roster;
    ctx.session.pollResolvedAttendeesEntries = Array.from(
      nicknameRows.entries(),
    );

    const unmatchedVoters = remaining.filter((u) => !nicknameRows.has(u));
    const extraSlots = Math.max(0, ctx.session.playerCount - remaining.length);
    ctx.session.pollUnknownQueries = [
      ...unmatchedVoters,
      ...Array.from({ length: extraSlots }, () => ''),
    ];

    await proceedAfterResolved(ctx);
  } catch (error) {
    await handleApiError(ctx, error, 'checking poll attendees');
  }
}

async function askMissingQuery(
  ctx: MyContext,
  forceBlank = false,
): Promise<void> {
  const nextQuery = forceBlank
    ? ''
    : ((ctx.session.pollUnknownQueries ?? [])[0] ?? '');
  ctx.session.state = 'awaiting_poll_missing_query';
  const missing = remainingMissing(ctx);
  const prompt = nextQuery
    ? `I could not find *${escapeMarkdownV2(nextQuery)}* in the roster\\. Type a name or Telegram username to search, or add a new player\\.`
    : `Who is missing? Type a name or Telegram username to search the roster\\.`;
  await replyMarkdownV2(
    ctx,
    `Missing attendees left: *${missing}*\n\n${prompt}`,
    { reply_markup: missingQueryKeyboard() },
  );
}

function missingQueryKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(
    '➕ Add new player',
    `${CallbackPrefix.PLAYER}addnew`,
  );
}

export async function handlePollMissingQuery(
  ctx: MyContext,
  text: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_poll_missing_query') {
    return false;
  }

  const query = text.trim();
  if (!query) {
    await replyMarkdownV2(
      ctx,
      '❌ Type a name or Telegram username to search\\.',
    );
    return true;
  }

  const roster = ctx.session.pollRosterEntries ?? [];
  const existingRows = new Set(
    (ctx.session.pollResolvedAttendeesEntries ?? []).map(([, row]) => row),
  );
  const results = searchRoster(roster, query).filter(
    (player) => !existingRows.has(player.row),
  );
  ctx.session.pollSearchResults = results;
  ctx.session.pollSearchPage = 0;

  if (results.length === 0) {
    await showNoMatch(ctx, query);
    return true;
  }

  await showSearchResults(ctx, 0);
  return true;
}

async function showNoMatch(ctx: MyContext, query: string): Promise<void> {
  await replyMarkdownV2(
    ctx,
    `No matches for *${escapeMarkdownV2(query)}*\\. Try another query or add a new player\\.`,
    { reply_markup: retryOrAddKeyboard() },
  );
}

function retryOrAddKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔎 Try another search', `${CallbackPrefix.PLAYER}retry`)
    .row()
    .text('➕ Add new player', `${CallbackPrefix.PLAYER}addnew`);
}

async function showSearchResults(ctx: MyContext, page: number): Promise<void> {
  const results = ctx.session.pollSearchResults ?? [];
  const keyboard = new InlineKeyboard();
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * PAGE_SIZE;

  results.slice(start, start + PAGE_SIZE).forEach((player, offset) => {
    const idx = start + offset;
    keyboard.text(attendeeLabel(player), `${CallbackPrefix.PLAYER}pick:${idx}`);
    keyboard.row();
  });

  if (totalPages > 1) {
    if (safePage > 0)
      keyboard.text('◀️ Prev', `${CallbackPrefix.PLAYER}sp:${safePage - 1}`);
    if (safePage < totalPages - 1)
      keyboard.text('Next ▶️', `${CallbackPrefix.PLAYER}sp:${safePage + 1}`);
    keyboard.row();
  }
  keyboard
    .text('🔎 Try another search', `${CallbackPrefix.PLAYER}retry`)
    .row()
    .text('➕ Add new player', `${CallbackPrefix.PLAYER}addnew`);

  ctx.session.pollSearchPage = safePage;
  await replyMarkdownV2(
    ctx,
    `Pick the attendee \\(page *${safePage + 1}/${totalPages}*\\):`,
    { reply_markup: keyboard },
  );
}

async function showExistingPlayerConfirmation(
  ctx: MyContext,
  player: PlayerRosterEntry,
): Promise<void> {
  await replyMarkdownV2(
    ctx,
    `Add *${escapeMarkdownV2(attendeeLabel(player))}*?`,
    {
      reply_markup: new InlineKeyboard()
        .text('✅ Yes', `${CallbackPrefix.PLAYER}confirm-existing:yes`)
        .text('❌ No', `${CallbackPrefix.PLAYER}confirm-existing:no`),
    },
  );
}

async function askNewAttendeeInput(ctx: MyContext): Promise<void> {
  ctx.session.state = 'awaiting_new_attendee_input';
  const currentUnknown = (ctx.session.pollUnknownQueries ?? [])[0] ?? '';
  const defaultNickname = currentUnknown.startsWith('@')
    ? normalizeUsername(currentUnknown)
    : null;
  ctx.session.pollPendingNewNickname = defaultNickname ?? undefined;
  const defaultHint = defaultNickname
    ? `\n\nCurrent unknown voter: ${escapeMarkdownV2(defaultNickname)}\\. Send just the name to use this username, or include a different @username\\.`
    : '';
  await replyMarkdownV2(
    ctx,
    `Send the new player as *Name*, *Name @username*, or *@username Name*\\.${defaultHint}`,
  );
}

export async function handleNewAttendeeInput(
  ctx: MyContext,
  text: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_new_attendee_input') {
    return false;
  }

  const parsed = parseNewAttendeeInput(text);
  if (parsed.error) {
    await replyMarkdownV2(ctx, `❌ ${escapeMarkdownV2(parsed.error)}\\.`);
    return true;
  }

  ctx.session.pollPendingNewName = parsed.name;
  ctx.session.pollPendingNewNickname =
    parsed.nickname ?? ctx.session.pollPendingNewNickname;

  const nickname = ctx.session.pollPendingNewNickname;
  const nickLine = nickname
    ? `\nTelegram: ${escapeMarkdownV2(nickname)}\n\nOpen/check ${escapeMarkdownV2(nickname)} and confirm this is the right profile\\.`
    : '\nTelegram: _none_';
  await replyMarkdownV2(
    ctx,
    `Create new player?\n\nName: *${escapeMarkdownV2(parsed.name)}*${nickLine}`,
    {
      reply_markup: new InlineKeyboard()
        .text('✅ Create', `${CallbackPrefix.PLAYER}confirm-new:yes`)
        .text('❌ Edit', `${CallbackPrefix.PLAYER}confirm-new:no`),
    },
  );
  return true;
}

async function savePendingNewAttendee(ctx: MyContext): Promise<void> {
  const name = ctx.session.pollPendingNewName;
  const nickname = ctx.session.pollPendingNewNickname;
  if (!name) {
    await replyErrorAndReset(ctx, ERR_SESSION_DATA_LOST);
    return;
  }

  try {
    const sheets = await ctx.services.createSheetsClient();
    if (nickname) {
      const existingRow = await sheets.findUserRowByTg(nickname);
      if (existingRow !== null) {
        const player = { row: existingRow, name, nickname };
        addResolvedAttendee(ctx, player);
        ctx.session.pollUnknownQueries = (
          ctx.session.pollUnknownQueries ?? []
        ).slice(1);
        await replyMarkdownV2(
          ctx,
          `That Telegram username is already in the roster at row *${existingRow}*\\. Added it to this update\\.`,
        );
        await proceedAfterResolved(ctx);
        return;
      }
    }

    const row = await sheets.findFirstRowWithEmptyNameAndTg();
    if (row === null) {
      await replyMarkdownV2(
        ctx,
        '❌ *No free row:* could not find a row with empty *A* and *B* \\(from row *7*\\)\\.',
      );
      resetSession(ctx.session);
      return;
    }

    await sheets.writeRegisterRow(row, name, nickname ?? '');
    addResolvedAttendee(ctx, { row, name, nickname });
    ctx.session.pollUnknownQueries = (
      ctx.session.pollUnknownQueries ?? []
    ).slice(1);
    ctx.session.pollPendingNewName = undefined;
    ctx.session.pollPendingNewNickname = undefined;

    await replyMarkdownV2(
      ctx,
      `✅ Added *${escapeMarkdownV2(name)}*${nickname ? ` / *${escapeMarkdownV2(nickname)}*` : ''} at row *${row}*\\.`,
    );
    await proceedAfterResolved(ctx);
  } catch (error) {
    await handleApiError(ctx, error, 'adding new attendee');
  }
}
