# Football Attendance Sync

This context covers a Telegram bot that turns football poll participation into match attendance and payment records in a Google Sheet.

## Language

**Player**:
A person known to the football group and represented by a row in the roster.

_Avoid_:
Guy, person, user, table entry

**Roster**:
The list of Players stored in the Google Sheet name and Telegram username columns.

_Avoid_:
Table, player list, people list

**Telegram Username**:
The optional `@username` used to match a Telegram account to a Player.

_Avoid_:
Nickname, handle, login

**Name-only Player**:
A Player whose Roster row has a display name but no Telegram Username.

_Avoid_:
Anonymous player, unlinked player, manual player

**Poll**:
A non-anonymous Telegram poll created by the bot to collect availability votes.

_Avoid_:
Survey

**Poll Option**:
One selectable answer in a Poll, usually representing a proposed match time.

_Avoid_:
Choice, answer

**Poll Voter**:
A Telegram user who selected a Poll Option.

_Avoid_:
Attendee, Player

**Attendee**:
A Player who actually came to play a specific Match.

_Avoid_:
Voter, participant

**Match**:
One football game whose attendance and payments are recorded in one Match Column.

_Avoid_:
Game, session, event

**No-show**:
A Poll Voter who did not become an Attendee for the Match.

_Avoid_:
Removed player, absent voter

**Missing Attendee**:
An Attendee who was not present in the selected Poll Option or could not be matched to a Player row.

_Avoid_:
Unknown guy, extra player, unlisted person

**Attendance Count**:
The total number of Attendees for a Match.

_Avoid_:
Player count, people count

**Poll Reconciliation**:
The workflow that turns Poll Voters into confirmed Attendees by removing No-shows and resolving Missing Attendees.

_Avoid_:
Poll cleanup, attendee fixing

**Match Column**:
The Google Sheet date column that stores one Match's metadata, attendance marks, and payments.

_Avoid_:
Date column, target column

**Match Metadata**:
The date, cost, and Attendance Count stored at the top of a Match Column.

_Avoid_:
Column metadata

**Payment**:
The amount a Player paid for a Match, stored in that Player's row in the Match Column.

_Avoid_:
Money, fee

## Relationships

- A **Player** has exactly one **Roster** row.
- A **Player** may have zero or one **Telegram Username**.
- A **Name-only Player** can be an **Attendee** and make **Payments**, but cannot be automatically matched from **Poll Voters**.
- A **Poll** has one or more **Poll Options**.
- A **Poll Option** has zero or more **Poll Voters**.
- A **Poll Voter** is not necessarily an **Attendee**.
- A **Match** has one **Match Column**.
- An **Attendee** is always resolved to a **Player** before attendance is written.
- A **No-show** starts as a **Poll Voter** and is removed during **Poll Reconciliation**.
- A **Missing Attendee** is resolved by selecting an existing **Player** or creating a new **Player**.
- A **Match Column** stores **Match Metadata**, attendance marks, and **Payments** for one match.

## Example Dialogue

> **Dev:** "When we choose a Poll Option for a Match, can we write all Poll Voters as Attendees immediately?"
> **Domain expert:** "No. First run Poll Reconciliation: remove No-shows, resolve Missing Attendees to Players, then write the final Attendees to the Match Column."
