import type Phaser from 'phaser';
import type { LiveEntity, LivePoint } from './game/live';
import { PixelActorArt, type PixelActorGear, type PixelActorSprite } from './pixel-actors';
import { pixelActorPresentationKey } from './pixel-actor-config';
import type { PixelActorFrame } from './pixel-animation';
import { pixelWeaponSignature, type PixelWeaponInput } from './pixel-weapons';
import { pixelActorDetail, type PixelActorDetail } from './pixel-actor-clarity';

type Identity = Pick<LiveEntity, 'appearance' | 'faction' | 'bossId' | 'role' | 'limping'>;
type Entry = { key: string; sprite: Omit<PixelActorSprite, 'image'>; width: number; height: number; bytes: number; users: number };
/** GPU/canvas copies share one bounded cache across every actor in a Phaser game. */
export const PIXEL_PHASER_ACTOR_CACHE_BYTES = 12 * 1024 * 1024;
const pools = new WeakMap<Phaser.Textures.TextureManager, Pool>();
let nextTexture = 0;
const emptyWeapon: PixelWeaponInput = { weaponId: 'pm', durability: 100, modules: {} };

class Pool {
  private art = new PixelActorArt();
  private entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(private textures: Phaser.Textures.TextureManager) {}
  acquire(identity: Identity, animation: PixelActorFrame, weapon: PixelWeaponInput, gear?: PixelActorGear, detail: PixelActorDetail = 160): Entry {
    const signature = JSON.stringify([identity.appearance, identity.faction, identity.bossId, identity.role, identity.limping,
      animation.facing, pixelActorPresentationKey(animation), pixelWeaponSignature(weapon), gear?.profile, gear?.helmet, gear?.armor, gear?.backpack, detail]);
    let entry = this.entries.get(signature);
    if (!entry) {
      const sprite = this.art.get(identity, animation, weapon, gear, detail), copy = document.createElement('canvas');
      copy.width = sprite.image.width; copy.height = sprite.image.height;
      const context = copy.getContext('2d');
      if (context) { context.imageSmoothingEnabled = false; context.drawImage(sprite.image, 0, 0); }
      const key = `pixel-fighter-${++nextTexture}`, texture = this.textures.addCanvas(key, copy);
      texture?.setFilter(1); // Phaser.Textures.FilterMode.NEAREST
      entry = { key, sprite: { anchor: { ...sprite.anchor }, ...(sprite.muzzle ? { muzzle: { ...sprite.muzzle } } : {}), ...(sprite.ejection ? { ejection: { ...sprite.ejection } } : {}) },
        width: copy.width, height: copy.height, bytes: copy.width * copy.height * 4, users: 0 };
      this.entries.set(signature, entry); this.bytes += entry.bytes;
      // Phaser owns the independent copy. The raster cache must not retain a
      // second full atlas or resize a canvas that Phaser is currently displaying.
      this.art.clear();
    } else { this.entries.delete(signature); this.entries.set(signature, entry); }
    entry.users++;
    this.trim();
    return entry;
  }
  release(entry: Entry): void { entry.users = Math.max(0, entry.users - 1); this.trim(); }
  private trim(): void {
    for (const [signature, entry] of this.entries) {
      if (this.bytes <= PIXEL_PHASER_ACTOR_CACHE_BYTES) break;
      if (entry.users) continue;
      this.textures.remove(entry.key); this.entries.delete(signature); this.bytes -= entry.bytes;
    }
  }
}

/** Shared shelter/raid body. The parent container and all its hit zones keep
 * their existing feet position; no renderer owns movement or combat events. */
export class PixelPhaserActor {
  readonly image: Phaser.GameObjects.Image;
  private pool: Pool;
  private entry: Entry | null = null;
  private signature = '';
  private scale = .3;
  private destroyed = false;
  constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container) {
    this.pool = pools.get(scene.textures) ?? new Pool(scene.textures); pools.set(scene.textures, this.pool);
    this.image = scene.add.image(0, 0, '__MISSING'); parent.add(this.image);
    parent.once('destroy', () => this.destroy());
  }
  update(identity: Identity, animation: PixelActorFrame, weapon: PixelWeaponInput | null, gear?: PixelActorGear, displayHeight = 48, sampling?: { screenScale: number; deviceRatio?: number }): void {
    if (this.destroyed) return;
    const input = weapon ?? emptyWeapon;
    const detail = sampling ? pixelActorDetail(displayHeight * sampling.screenScale, sampling.deviceRatio) : 160;
    const signature = JSON.stringify([identity, animation.facing, pixelActorPresentationKey(animation), pixelWeaponSignature(input), gear, detail]);
    if (signature !== this.signature) {
      const previous = this.entry;
      this.entry = this.pool.acquire(identity, animation, input, gear, detail); this.signature = signature;
      const entry = this.entry;
      this.image.setTexture(entry.key).setOrigin(entry.sprite.anchor.x / entry.width, entry.sprite.anchor.y / entry.height);
      if (previous) this.pool.release(previous);
    }
    this.scale = Math.max(1, Number.isFinite(displayHeight) ? displayHeight : 48) / 160;
    this.image.setScale(this.scale);
  }
  muzzlePoint(): LivePoint | undefined { return this.socket(this.entry?.sprite.muzzle); }
  ejectionPoint(): LivePoint | undefined { return this.socket(this.entry?.sprite.ejection); }
  private socket(point: LivePoint | undefined): LivePoint | undefined {
    return point && this.entry ? { x: (point.x - this.entry.sprite.anchor.x) * this.scale, y: (point.y - this.entry.sprite.anchor.y) * this.scale } : undefined;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.entry) this.pool.release(this.entry);
    this.entry = null; this.image.destroy();
  }
}
