import { InlineKeyboard } from 'grammy';

/**
 * Inline keyboard utilities for the bot
 */

// Callback data prefixes for routing
export const CallbackPrefix = {
  YES_NO: 'yn:',
  COLUMN: 'col:',
  POLL_INTENT: 'pi:',
  POLL_OPTION: 'po:',
} as const;

/**
 * Creates a Yes/No inline keyboard
 * @param yesData Callback data for Yes button (will be prefixed with yn:)
 * @param noData Callback data for No button (will be prefixed with yn:)
 */
export function yesNoKeyboard(yesData: string, noData: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Yes', `${CallbackPrefix.YES_NO}${yesData}`)
    .text('❌ No', `${CallbackPrefix.YES_NO}${noData}`);
}

/**
 * Creates a column confirmation keyboard with Yes, No (create new), and manual input hint
 * @param currentColumn The current detected column
 * @param nextColumn The next column letter if user chooses to create new
 */
export function columnConfirmationKeyboard(
  currentColumn: string,
  nextColumn: string,
): InlineKeyboard {
  return new InlineKeyboard()
    .text(
      `✅ Use ${currentColumn}`,
      `${CallbackPrefix.COLUMN}use:${currentColumn}`,
    )
    .text(
      `➕ Create ${nextColumn}`,
      `${CallbackPrefix.COLUMN}new:${nextColumn}`,
    );
}

/**
 * Creates a new column choice keyboard (create first column or cancel)
 * @param column The column to create
 */
export function newColumnChoiceKeyboard(column: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(`✅ Create ${column}`, `${CallbackPrefix.COLUMN}create:${column}`)
    .text('❌ Cancel', `${CallbackPrefix.COLUMN}cancel`);
}

/**
 * Creates a column selection keyboard from multiple matches
 */
export function columnSelectionKeyboard(
  matches: Array<{ column: string; date: string }>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  matches.forEach((match, index) => {
    keyboard.text(
      `${index + 1}. ${match.column}: ${match.date}`,
      `${CallbackPrefix.COLUMN}select:${match.column}`,
    );
    if (index < matches.length - 1) {
      keyboard.row();
    }
  });
  return keyboard;
}

/**
 * Creates player count confirmation keyboard
 * @param recognizedCount The number of recognized players
 */
export function playerCountConfirmationKeyboard(
  recognizedCount: number,
): InlineKeyboard {
  return new InlineKeyboard()
    .text(
      `✅ Yes, ${recognizedCount} players`,
      `${CallbackPrefix.YES_NO}playercount:yes`,
    )
    .text('✏️ No, specify count', `${CallbackPrefix.YES_NO}playercount:no`);
}

/**
 * Creates override confirmation keyboard
 */
export function overrideConfirmationKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Overwrite', `${CallbackPrefix.YES_NO}override:yes`)
    .text('⏭️ Skip existing', `${CallbackPrefix.YES_NO}override:no`);
}

/**
 * Creates poll intent keyboard (Update sheet or View voters)
 */
export function pollIntentKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📝 Update sheet', `${CallbackPrefix.POLL_INTENT}update`)
    .text('👀 View voters', `${CallbackPrefix.POLL_INTENT}view`);
}

/**
 * Creates poll option selection keyboard
 */
export function pollOptionKeyboard(
  options: string[],
  votes: Map<number, Set<string>>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  options.forEach((option, index) => {
    const voterCount = votes.get(index)?.size || 0;
    keyboard.text(
      `${index + 1}. ${option} (${voterCount})`,
      `${CallbackPrefix.POLL_OPTION}${index}`,
    );
    if (index < options.length - 1) {
      keyboard.row();
    }
  });
  return keyboard;
}
