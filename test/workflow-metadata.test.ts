import { describe, expect, test } from 'bun:test';
import { ERR_TARGET_COLUMN_NOT_SET } from '../constants';
import { proceedWithMetadataCollection } from '../workflow/metadata-flow';
import { baseSheets } from './sheet-test-stub';
import { makeMinimalWorkflowContext } from './support/minimal-context';
import { normalizeTelegramText } from './support/test-assertions';

describe('proceedWithMetadataCollection', () => {
  test('without targetColumn: error and no metadata fetch', async () => {
    const sheets = baseSheets({
      getColumnMetadata: async () => {
        throw new Error('should not call sheets');
      },
    });
    const { ctx, replies } = makeMinimalWorkflowContext({}, sheets);

    await proceedWithMetadataCollection(ctx);

    expect(replies).toEqual([ERR_TARGET_COLUMN_NOT_SET]);
    expect(ctx.session.state).toBe('idle');
  });

  test('missing date: asks for date name', async () => {
    const sheets = baseSheets({
      getColumnMetadata: async () => ({}),
    });
    const { ctx, replies } = makeMinimalWorkflowContext(
      { targetColumn: 'F' },
      sheets,
    );

    await proceedWithMetadataCollection(ctx);

    expect(ctx.session.state).toBe('awaiting_date_name');
    const msg = normalizeTelegramText(replies[0]);
    expect(msg).toContain('has no date name');
    expect(msg).toContain('Column F');
  });

  test('date set but cost missing: asks for cost', async () => {
    const sheets = baseSheets({
      getColumnMetadata: async () => ({ date: '12 Apr' }),
    });
    const { ctx, replies } = makeMinimalWorkflowContext(
      { targetColumn: 'G' },
      sheets,
    );

    await proceedWithMetadataCollection(ctx);

    expect(ctx.session.state).toBe('awaiting_cost');
    const msg = normalizeTelegramText(replies[0]);
    expect(msg).toContain('no cost specified');
    expect(msg).toContain('Column G');
    expect(ctx.session.dateName).toBe('12 Apr');
  });

  test('date and cost present: asks for usernames with summary', async () => {
    const sheets = baseSheets({
      getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
    });
    const { ctx, replies } = makeMinimalWorkflowContext(
      { targetColumn: 'F' },
      sheets,
    );

    await proceedWithMetadataCollection(ctx);

    expect(ctx.session.state).toBe('awaiting_usernames');
    expect(ctx.session.dateName).toBe('12 Apr');
    expect(ctx.session.cost).toBe(700);
    const msg = normalizeTelegramText(replies[0]);
    expect(msg).toContain('Column F metadata');
    expect(msg).toContain('Date: 12 Apr');
    expect(msg).toContain('Cost: 700');
    expect(msg).toContain('Now send the list of usernames');
  });

  test('includes sheet playerCount in summary when present', async () => {
    const sheets = baseSheets({
      getColumnMetadata: async () => ({
        date: '12 Apr',
        cost: 700,
        playerCount: 11,
      }),
    });
    const { ctx, replies } = makeMinimalWorkflowContext(
      { targetColumn: 'F' },
      sheets,
    );

    await proceedWithMetadataCollection(ctx);

    expect(ctx.session.state).toBe('awaiting_usernames');
    expect(ctx.session.playerCount).toBe(11);
    expect(normalizeTelegramText(replies[0])).toContain('Players: 11');
  });

  test('playerCount 0 is shown when sheet reports 0', async () => {
    const sheets = baseSheets({
      getColumnMetadata: async () => ({
        date: '12 Apr',
        cost: 700,
        playerCount: 0,
      }),
    });
    const { ctx, replies } = makeMinimalWorkflowContext(
      { targetColumn: 'F' },
      sheets,
    );

    await proceedWithMetadataCollection(ctx);

    expect(ctx.session.playerCount).toBe(0);
    expect(normalizeTelegramText(replies[0])).toContain('Players: 0');
  });

  test('when usernames already set (e.g. poll): skips username prompt and runs player-count check', async () => {
    const sheets = baseSheets({
      getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
      findNicknameRows: async () => new Map<string, number>([['@alice', 7]]),
    });
    const { ctx, replies } = makeMinimalWorkflowContext(
      {
        targetColumn: 'F',
        usernames: ['@alice'],
      },
      sheets,
    );

    await proceedWithMetadataCollection(ctx);

    const normalized = replies.map(normalizeTelegramText);
    expect(normalized.some((r) => r.includes('Checking sheet'))).toBe(true);
    expect(normalized.some((r) => r.includes('Is 1 the total'))).toBe(true);
    expect(ctx.session.state).toBe('awaiting_player_count_confirmation');
  });
});
