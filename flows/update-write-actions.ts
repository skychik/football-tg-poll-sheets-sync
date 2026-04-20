import { handleApiError } from '../bot-helpers';
import type { MyContext } from '../session';
import {
  checkOverridesAndWrite,
  writeZerosAndRespond,
} from '../workflow/write-flow';

/**
 * Persist player count to the sheet and continue to override / write.
 * Caller must set `ctx.session.playerCount` and `ctx.session.targetColumn`.
 */
export async function persistPlayerCountToSheetAndCheckOverrides(
  ctx: MyContext,
  nicknameRows: Map<string, number>,
  apiErrorAction:
    | 'writing player count or checking overrides'
    | 'writing player count' = 'writing player count or checking overrides',
): Promise<void> {
  const targetColumn = ctx.session.targetColumn;
  if (!targetColumn) {
    return;
  }
  try {
    const sheetsClient = await ctx.services.createSheetsClient();
    await sheetsClient.writeColumnMetadata(
      targetColumn,
      undefined,
      undefined,
      ctx.session.playerCount,
    );
    await checkOverridesAndWrite(ctx, nicknameRows);
  } catch (error) {
    await handleApiError(ctx, error, apiErrorAction, false);
  }
}

/**
 * Final sheet write after override confirmation (overwrite or skip existing cells).
 */
export async function finalizeOverrideWrite(
  ctx: MyContext,
  nicknameRows: Map<string, number>,
  overrideExisting: boolean,
): Promise<void> {
  const columnToUse = ctx.session.column || ctx.session.targetColumn;
  if (!columnToUse) {
    return;
  }

  const skippedNicknames: string[] =
    !overrideExisting && ctx.session.existingValuesEntries
      ? ctx.session.existingValuesEntries.map((ev) => ev.nickname)
      : [];

  await writeZerosAndRespond(
    ctx,
    nicknameRows,
    columnToUse,
    overrideExisting,
    skippedNicknames,
  );
}
