export interface CloudBaseline { serverRevision: number; localRevision: number }
export interface LocalCloudSave { save: string; revision: number }
export type CloudSyncStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict' | 'expired';

/** Serial compare-and-swap uploads. An uncertain write can never overwrite another device. */
export function createCloudSaveSync(options: {
	readLocal(): LocalCloudSave | null;
	upload(revision: number, save: string): Promise<{ revision: number; savedAt: number | string }>;
	writeBaseline(baseline: CloudBaseline): void;
	onStatus(status: CloudSyncStatus, savedAt?: number | string): void;
}) {
	let generation = 0, revision: number | null = null;
	let inFlight: Promise<boolean> | null = null;
	let lastLocalRevision = -1;
	let blocked = false;
	const flush = (): Promise<boolean> => {
		if (inFlight) return inFlight;
		if (revision === null || blocked) return Promise.resolve(false);
		const local = options.readLocal();
		if (!local) return Promise.resolve(false);
		if (local.revision === lastLocalRevision) return Promise.resolve(true);
		const epoch = generation, expected = revision;
		options.onStatus('saving');
		const task = (async () => {
			try {
				const result = await options.upload(expected, local.save);
				if (epoch !== generation) return false;
				revision = result.revision;
				lastLocalRevision = local.revision;
				options.writeBaseline({ serverRevision: result.revision, localRevision: local.revision });
				options.onStatus('saved', result.savedAt);
				return true;
			} catch (error) {
				if (epoch !== generation) return false;
				const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
				blocked = status === 409 || status === 401;
				options.onStatus(status === 409 ? 'conflict' : status === 401 ? 'expired' : 'offline');
				return false;
			} finally {
				if (epoch === generation) inFlight = null;
			}
		})();
		inFlight = task;
		return task;
	};
	return {
		connect(serverRevision: number, uploadedLocalRevision = -1) {
			generation++; revision = serverRevision; lastLocalRevision = uploadedLocalRevision; blocked = false; inFlight = null;
			options.onStatus('idle');
		},
		disconnect() { generation++; revision = null; blocked = false; inFlight = null; },
		flush,
		isConnected: () => revision !== null && !blocked,
	};
}
