// Error messages
export const ERR_TARGET_COLUMN_NOT_SET =
  '❌ Error: target column not set. Start over with /update';
export const ERR_SESSION_DATA_LOST =
  '❌ Error: session data lost. Start over with /update';
export const ERR_INVALID_YES_NO = '❌ Please answer "yes" or "no"';

// Recovery instructions
export const MSG_USE_UPDATE_AGAIN = 'Use /update to begin again.';

// Google Sheets constants
export const SHEET_NAME = 'Sheet1';
export const SHEET_DATA_FIRST_ROW = 7; // Data starts from row 7
export const SHEET_DATA_FIRST_COLUMN = 'F'; // Date columns start from column F
export const SHEET_NICKNAME_COLUMN = 'B'; // Column B contains Telegram nicknames
export const SHEET_DATE_ROW = 1; // Row 1 contains date
export const SHEET_COST_ROW = 2; // Row 2 contains cost
export const SHEET_PLAYER_COUNT_ROW = 3; // Row 3 contains player count
export const SHEET_EXCLUDE_COLUMN_PATTERN = /^баланс\s+/i; // Exclude columns starting with "Баланс "

// Player registry (columns A and B) and per-column "remaining" row
export const SHEET_NAME_COLUMN = 'A';
export const SHEET_MONEY_REMAINING_ROW = 4; // How much is left to collect (formula)

/** Max amount allowed for / money replacement in one go */
export const MONEY_MAX_AMOUNT = 20_000;

// Messages
export const ERR_MONEY_VALUE =
  '❌ Value is incorrect. Send a number greater than 0 and at most 20,000.';
export const ERR_NO_TG_USERNAME =
  '❌ You need a Telegram username in your Telegram account to use this.';
export const ERR_MONEY_AND_REGISTER_PRIVATE_ONLY =
  '❌ /money and /register work only in a private chat with the bot. Open a DM to continue.';
