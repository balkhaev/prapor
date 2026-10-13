import { describe, expect, test } from 'bun:test';
import { createCloudSaveSync, type CloudBaseline, type CloudSyncStatus } from '../src/account-sync';

describe('account save synchronization', () => {
	test('uploads serialize and record only the local version acknowledged by the server', async () => {
		let local = { save: 'first', revision: 1 };
		let release!: (result: { revision: number; savedAt: number }) => void;
		const writes: CloudBaseline[] = [], uploads: [number, string][] = [];
		const sync = createCloudSaveSync({ readLocal: () => local, writeBaseline: b => writes.push(b), onStatus: () => {},
			upload: async (revision, save) => { uploads.push([revision, save]); return await new Promise(resolve => { release = resolve; }); } });
		sync.connect(4);
		const first = sync.flush();
		local = { save: 'second', revision: 2 };
		expect(sync.flush()).toBe(first);
		release({ revision: 5, savedAt: 100 });
		expect(await first).toBe(true);
		expect(writes).toEqual([{ serverRevision: 5, localRevision: 1 }]);
		const second = sync.flush();
		expect(uploads).toEqual([[4, 'first'], [5, 'second']]);
		release({ revision: 6, savedAt: 200 });
		await second;
		expect(await sync.flush()).toBe(true);
		expect(uploads.length).toBe(2);
	});
	test('an uncertain request followed by a conflict stops automatic writes', async () => {
		const statuses: CloudSyncStatus[] = []; let calls = 0;
		const sync = createCloudSaveSync({ readLocal: () => ({ save: 'local', revision: 2 }), writeBaseline: () => { throw new Error('must not write'); },
			onStatus: s => statuses.push(s), upload: async () => { calls++; throw calls === 1 ? new Error('network') : { status: 409 }; } });
		sync.connect(1);
		expect(await sync.flush()).toBe(false);
		expect(await sync.flush()).toBe(false);
		expect(await sync.flush()).toBe(false);
		expect(calls).toBe(2);
		expect(statuses).toEqual(['idle', 'saving', 'offline', 'saving', 'conflict']);
	});
	test('a delayed response from a previous account does not change the next account', async () => {
		let release!: (result: { revision: number; savedAt: number }) => void;
		const writes: CloudBaseline[] = [];
		const sync = createCloudSaveSync({ readLocal: () => ({ save: 'old-user', revision: 3 }), writeBaseline: b => writes.push(b), onStatus: () => {},
			upload: () => new Promise(resolve => { release = resolve; }) });
		sync.connect(8); const request = sync.flush(); sync.disconnect(); sync.connect(0);
		release({ revision: 9, savedAt: 100 });
		expect(await request).toBe(false);
		expect(writes).toEqual([]);
	});
});
