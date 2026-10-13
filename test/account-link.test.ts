import { describe, expect, test } from 'bun:test';
import { isAccountEmailFragment, readAccountEmailLink } from '../src/account-link';

describe('private account email links', () => {
	test('accepts only a single well-formed verification or reset token', () => {
		const token = 'a'.repeat(43);
		expect(readAccountEmailLink(`#account-verify=${token}`)).toEqual({ kind: 'verify', token });
		expect(readAccountEmailLink(`#account-reset=${token}`)).toEqual({ kind: 'reset', token });
		for (const hash of ['', '#other', '#account-verify=', `#account-reset=${'a'.repeat(42)}`, `#account-verify=${token}&next=https://evil.invalid`, `#account-verify=${token}%00`, `#account-login=${token}`]) {
			expect(readAccountEmailLink(hash)).toBeNull();
		}
	});
	test('recognizes malformed account links for removal without touching normal page fragments', () => {
		expect(isAccountEmailFragment('#account-reset=bad')).toBe(true);
		expect(isAccountEmailFragment('#account-verify')).toBe(true);
		expect(isAccountEmailFragment('#account-verify-notes')).toBe(false);
		expect(isAccountEmailFragment('#help')).toBe(false);
	});
});
