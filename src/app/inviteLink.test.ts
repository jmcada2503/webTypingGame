import { describe, expect, test } from 'vitest';
import { inviteCodeFromHash } from './inviteLink';

describe('the Invite code in the page address', () => {
  test('a link is #/m/ and the match id', () => {
    expect(inviteCodeFromHash('#/m/k7q29xpd')).toBe('k7q29xpd');
    expect(inviteCodeFromHash('#/m/abc')).toBe('abc');
  });

  test('anything else is not an Invite link', () => {
    for (const hash of ['', '#', '#/', '#/m/', '#/m/ab', '#/x/abcd1234', '#/m/abcd1234/extra', 'm/abcd1234', '#/m/ABCD1234', '#/m/abcd 1234']) {
      expect(inviteCodeFromHash(hash)).toBeNull();
    }
  });

  test('an id longer than the server issues is not accepted', () => {
    expect(inviteCodeFromHash(`#/m/${'a'.repeat(33)}`)).toBeNull();
    expect(inviteCodeFromHash(`#/m/${'a'.repeat(32)}`)).toBe('a'.repeat(32));
  });
});
