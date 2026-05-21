import { describe, expect, test } from 'bun:test';
import {
  parseNewAttendeeInput,
  searchRoster,
} from '../flows/poll-reconciliation';

describe('poll reconciliation helpers', () => {
  test('parseNewAttendeeInput accepts @nick Name', () => {
    expect(parseNewAttendeeInput('@alice_test Alice Test')).toEqual({
      name: 'Alice Test',
      nickname: '@alice_test',
    });
  });

  test('parseNewAttendeeInput accepts Name @nick', () => {
    expect(parseNewAttendeeInput('Alice Test @alice_test')).toEqual({
      name: 'Alice Test',
      nickname: '@alice_test',
    });
  });

  test('parseNewAttendeeInput accepts name-only', () => {
    expect(parseNewAttendeeInput('Ivan Petrov')).toEqual({
      name: 'Ivan Petrov',
    });
  });

  test('parseNewAttendeeInput rejects malformed username', () => {
    expect(parseNewAttendeeInput('Ivan @bad')).toMatchObject({
      error: expect.stringContaining('Telegram username'),
    });
  });

  test('parseNewAttendeeInput rejects whitespace-only text', () => {
    expect(parseNewAttendeeInput('   ')).toMatchObject({
      error: 'Name cannot be empty',
    });
  });

  test('searchRoster matches nickname, name substring, and transliteration', () => {
    const roster = [
      { row: 7, name: 'Alice Cooper', nickname: '@alice_test' },
      { row: 8, name: 'Иван Петров', nickname: '@ivan' },
      { row: 9, name: 'Sergey', nickname: '@serg' },
    ];

    expect(searchRoster(roster, 'alice')).toEqual([roster[0]]);
    expect(searchRoster(roster, 'coop')).toEqual([roster[0]]);
    expect(searchRoster(roster, 'ivan')).toEqual([roster[1]]);
    expect(searchRoster(roster, 'серг')).toEqual([roster[2]]);
  });

  test('searchRoster matches Latin query against Cyrillic roster names', () => {
    const roster = [{ row: 7, name: 'Сергей Иванов', nickname: '@sergey' }];

    expect(searchRoster(roster, 'sergey')).toEqual(roster);
    expect(searchRoster(roster, 'ivanov')).toEqual(roster);
  });

  test('searchRoster matches partial Telegram usernames', () => {
    const roster = [
      { row: 7, name: 'Alice Cooper', nickname: '@alice_football' },
    ];

    expect(searchRoster(roster, 'lice_foot')).toEqual(roster);
    expect(searchRoster(roster, '@alice_foot')).toEqual(roster);
  });

  test('searchRoster matches Cyrillic query against Latin roster names', () => {
    const roster = [{ row: 7, name: 'Sergey Ivanov', nickname: '@sergey' }];

    expect(searchRoster(roster, 'сергей')).toEqual(roster);
    expect(searchRoster(roster, 'иванов')).toEqual(roster);
  });

  test('searchRoster can return multiple substring matches', () => {
    const roster = [
      { row: 7, name: 'Ivan One', nickname: '@ivan_one' },
      { row: 8, name: 'Ivan Two', nickname: '@ivan_two' },
    ];

    expect(searchRoster(roster, 'ivan')).toEqual(roster);
  });
});
