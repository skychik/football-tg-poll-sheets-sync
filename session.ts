import type { Context, SessionFlavor } from 'grammy';
import type { AppServices } from './app-services';

export interface SessionData {
  state:
    | 'idle'
    | 'awaiting_column_confirmation'
    | 'awaiting_new_column_choice'
    | 'awaiting_column_selection'
    | 'awaiting_date_name'
    | 'awaiting_cost'
    | 'awaiting_player_count'
    | 'awaiting_player_count_confirmation'
    | 'awaiting_usernames'
    | 'awaiting_override_confirmation'
    | 'awaiting_poll_intent'
    | 'awaiting_poll_option_selection'
    | 'awaiting_money_amount'
    | 'awaiting_register_name'
    | 'awaiting_money_column_choice'
    | 'awaiting_money_replace_confirm'
    | 'awaiting_money_not_in_poll_confirm'
    | 'awaiting_money_row4_confirm';
  usernames: string[];
  detectedColumn?: string;
  targetColumn?: string;
  isNewColumn?: boolean;
  dateName?: string;
  cost?: number;
  playerCount?: number;
  column?: string; // Keep for backward compatibility with override flow
  nicknameRowsEntries?: Array<[string, number]>; // Serialized Map entries
  existingValuesEntries?: Array<{ nickname: string; value: string | number }>; // Store existing values for skipped tracking
  pollId?: string; // For poll-based workflow
  pollQuestion?: string; // For display
  columnMatches?: Array<{ column: string; date: string }>; // For column selection when multiple matches found
  /** /money: amount the user asked to write (replaces target cell) */
  moneyAmount?: number;
  /** When true, finishing registration runs /money column-pick for moneyAmount */
  moneyResumeAfterRegister?: boolean;
  /** Column letter chosen for the money write (last date or next blank) */
  moneyWriteColumn?: string;
  moneyUserSheetRow?: number;
  moneyLastDateColumn?: string;
  moneyLastDateText?: string;
  moneyNextColumn?: string;
  /** @username key used in findNicknameRows (e.g. @alice) */
  moneyTgKey?: string;
  /** Stashed cell preview for messages */
  moneyOldCellValue?: string;
  /** @username to write in B on register, e.g. @alice */
  registerAtUsername?: string;
}

/**
 * Reset session helper
 */
export function resetSession(session: SessionData): void {
  session.state = 'idle';
  session.usernames = [];
  session.detectedColumn = undefined;
  session.targetColumn = undefined;
  session.isNewColumn = undefined;
  session.dateName = undefined;
  session.cost = undefined;
  session.playerCount = undefined;
  session.column = undefined;
  session.nicknameRowsEntries = undefined;
  session.existingValuesEntries = undefined;
  session.pollId = undefined;
  session.pollQuestion = undefined;
  session.columnMatches = undefined;
  session.moneyAmount = undefined;
  session.moneyResumeAfterRegister = undefined;
  session.moneyWriteColumn = undefined;
  session.moneyUserSheetRow = undefined;
  session.moneyLastDateColumn = undefined;
  session.moneyLastDateText = undefined;
  session.moneyNextColumn = undefined;
  session.moneyTgKey = undefined;
  session.moneyOldCellValue = undefined;
  session.registerAtUsername = undefined;
}

export type MyContext = Context &
  SessionFlavor<SessionData> & { services: AppServices };
