export interface AccountEmailLink { kind: 'verify' | 'reset'; token: string }

/** Account secrets travel in fragments, which browsers do not send in HTTP requests. */
export function readAccountEmailLink(hash: string): AccountEmailLink | null {
	const match = /^#account-(verify|reset)=([A-Za-z0-9_-]{43})$/.exec(hash);
	return match ? { kind: match[1] as AccountEmailLink['kind'], token: match[2]! } : null;
}

export function isAccountEmailFragment(hash: string): boolean {
	return /^#account-(verify|reset)(?:=|$)/.test(hash);
}
