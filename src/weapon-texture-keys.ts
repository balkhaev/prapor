/** Full assembly signatures own texture keys; a shortened hash cannot identify a build. */
export class WeaponTextureKeys {
	private readonly signatures = new Map<string, string>();
	private next = 0;

	constructor(private readonly prefix = "scav-weapon-build") {}

	keyFor(signature: string, textureExists: (key: string) => boolean): string {
		const previous = this.signatures.get(signature);
		if (previous) return previous;
		let key: string;
		do key = `${this.prefix}-${++this.next}`;
		while (textureExists(key));
		this.signatures.set(signature, key);
		return key;
	}
}
