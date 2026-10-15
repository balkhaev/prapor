import { paintPixelActor } from './pixel-actors';
import { PIXEL_ACTOR_NATIVE_SIZE } from './pixel-actor-config';
import { pixelSvg } from './pixel-svg';

const portraits = new Map<number, string>();

/** Roster cards show the exact face, cap and clothing used in every world scene. */
export function pixelPortraitUrl(appearance: number): string {
  const identity = Number.isInteger(appearance) && appearance >= 0 && appearance < 32 ? appearance : 0;
  const old = portraits.get(identity); if (old) return old;
  const { width, height } = PIXEL_ACTOR_NATIVE_SIZE;
  const svg = pixelSvg(width, height, (_, context) => {
    paintPixelActor(context, { appearance: identity, faction: 'scavs' }, { mode: 'idle', facing: 's', frame: 0 }, 'unknown', { profile: 'light', armor: false, backpack: false });
  }, { x: 88, y: 23, width: 80, height: 80 });
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  portraits.set(identity, url);
  return url;
}
