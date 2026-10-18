/** Shared tactical timing. Coordinates, visibility, ammunition and damage remain
 * the caller's authority; a fire decision is exactly one attempted projectile. */
export interface LiveFirefightState {
  phase: 'seeking' | 'holding' | 'acquiring' | 'firing' | 'recovering' | 'suppressed' | 'reloading';
  seed: number; updatedAt: number; suppression: number; lastIncomingAt: number;
  until: number; nextShotAt: number; recoverUntil: number; settledSince: number; reactionUntil: number;
  roundsLeft: number; roundsSinceReload: number; compromised: number; exposures: number;
  relocate: boolean;
}
export interface LiveFirefightInput {
  now: number; visible: boolean; canFire: boolean; hasCover: boolean; inCover: boolean; atPeek: boolean;
  moving?: boolean; weaponCategory?: string; attackMs?: number; injured?: boolean;
}
export interface LiveFirefightDecision {
  action: 'cover' | 'peek' | 'fire' | 'hold' | 'relocate' | 'watch';
  behavior: 'acquiring' | 'firing' | 'suppressed' | 'relocating' | 'recovering' | 'reloading';
  suppression: number;
}
const variation = (state: LiveFirefightState): number => {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
};
const decay = (state: LiveFirefightState, now: number): void => {
  state.suppression = Math.max(0, state.suppression - Math.max(0, now - Math.max(state.updatedAt, state.lastIncomingAt + 450)) / 4200);
  state.updatedAt = Math.max(state.updatedAt, now);
};
export function createLiveFirefightState(seed: number, now: number): LiveFirefightState {
  return { phase: 'seeking', seed: seed >>> 0, updatedAt: now, suppression: 0, lastIncomingAt: -Infinity,
    until: now, nextShotAt: now, recoverUntil: now, settledSince: 0, reactionUntil: now, roundsLeft: 0, roundsSinceReload: 0,
    compromised: 0, exposures: 0, relocate: false };
}
/** An actual hit or nearby passing round, never knowledge of an unseen aim. */
export function applyLiveIncomingFire(state: LiveFirefightState, now: number, strength = .35): void {
  decay(state, now);
  state.suppression = Math.min(1, state.suppression + Math.max(0, strength));
  state.lastIncomingAt = now;
  if (strength < .2 && state.suppression < .45) return;
  if (state.phase === 'acquiring' || state.phase === 'firing') {
    state.compromised++; state.relocate ||= state.compromised >= 2;
  }
  if (state.phase !== 'suppressed') state.reactionUntil = now + 160 + variation(state) * 100;
  state.roundsLeft = 0; state.settledSince = 0; state.phase = 'suppressed';
  state.until = Math.max(state.until, now + 650 + variation(state) * 650 + state.suppression * 900);
}
export function stepLiveFirefight(state: LiveFirefightState, input: LiveFirefightInput): LiveFirefightDecision {
  const { now, hasCover, inCover } = input;
  const magazine = input.weaponCategory === 'pistol' ? 8 : input.weaponCategory === 'sniper' || input.weaponCategory === 'shotgun' ? 5 : 24;
  decay(state, now);
  const result = (action: LiveFirefightDecision['action'], behavior: LiveFirefightDecision['behavior']): LiveFirefightDecision => ({ action, behavior, suppression: state.suppression });
  const shelter = (behavior: LiveFirefightDecision['behavior']) => result(hasCover && !inCover ? 'cover' : 'hold', behavior);
  if (input.injured) { state.roundsLeft = 0; state.settledSince = 0; return shelter('recovering'); }
  if (state.phase === 'suppressed') {
    if (now < state.reactionUntil) return result('hold', 'suppressed');
    if (now < state.until || state.suppression > .55) return shelter('suppressed');
    state.phase = 'recovering'; state.until = now + 250 + variation(state) * 450;
  }
  if (state.phase === 'reloading') {
    if (now < state.until) return shelter('reloading');
    state.roundsSinceReload = 0; state.phase = 'seeking';
  }
  if (state.phase === 'recovering') {
    if (now < Math.max(state.until, state.recoverUntil)) return shelter('recovering');
    state.phase = 'seeking';
  }
  // An interrupted reload leaves an empty magazine. Re-enter the whole reload
  // before acquiring another shot; suppression cannot conjure a loaded round.
  if (state.roundsSinceReload >= magazine) {
    state.phase = 'reloading'; state.until = now + 2200 + variation(state) * 1000;
    return shelter('reloading');
  }
  if (state.phase === 'seeking') {
    if (hasCover && !inCover) return result('cover', state.relocate ? 'relocating' : 'recovering');
    if (state.relocate && hasCover) {
      state.relocate = false; state.compromised = 0; state.exposures = 0;
      return result('relocate', 'relocating');
    }
    state.phase = 'holding'; state.until = now + (hasCover ? 450 : 80) + variation(state) * (hasCover ? 1000 : 250);
  }
  if (state.phase === 'holding') {
    if (now < state.until) return shelter('recovering');
    state.phase = 'acquiring'; state.settledSince = 0;
  }
  if (state.phase === 'acquiring') {
    if (hasCover && !input.atPeek) return result('peek', 'acquiring');
    if (input.moving) { state.settledSince = 0; return result('hold', 'acquiring'); }
    if (!state.settledSince) {
      state.settledSince = Math.max(1, now);
      state.until = now + 550 + variation(state) * 650 + state.suppression * 950;
    }
    // Look briefly at the last observed lane, then disappear. Hidden targets do
    // not produce shots or an indefinitely exposed, omniscient aiming pose.
    if (!input.visible) {
      if (now < state.until + 500) return result('watch', 'acquiring');
      state.phase = 'recovering'; state.until = now + 600 + variation(state) * 700;
      return shelter('recovering');
    }
    if (now < state.until || !input.canFire) return result('hold', 'acquiring');
    const automatic = input.weaponCategory === 'rifle' || input.weaponCategory === 'smg' || input.weaponCategory === 'machinegun';
    state.roundsLeft = Math.min(magazine - state.roundsSinceReload, automatic && state.suppression < .5 ? 2 + Number(variation(state) > .8) : 1);
    state.recoverUntil = now + state.roundsLeft * Math.max(650, input.attackMs ?? 1800) + 500 + variation(state) * 800;
    state.nextShotAt = now; state.phase = 'firing'; state.exposures++;
  }
  if (state.phase === 'firing') {
    if (!input.visible || input.moving) {
      state.roundsLeft = 0; state.phase = 'recovering'; state.until = now + 450;
      return shelter('recovering');
    }
    if (now < state.nextShotAt) return result('hold', 'firing');
    if (!input.canFire) {
      state.roundsLeft = 0; state.phase = 'recovering'; state.until = now + 450;
      return shelter('recovering');
    }
    state.roundsLeft--; state.roundsSinceReload++;
    state.nextShotAt = now + 170 + variation(state) * 90;
    if (!state.roundsLeft) {
      state.phase = state.roundsSinceReload >= magazine ? 'reloading' : 'recovering';
      state.until = state.phase === 'reloading' ? Math.max(state.recoverUntil, now + 2200 + variation(state) * 1000) : now + 200;
      state.relocate ||= state.exposures >= 3;
    }
    return result('fire', 'firing');
  }
  return result('watch', 'acquiring');
}
/** Broad game-scale accuracy, independent of damage and the body-part roll. */
export function liveFirefightHitChance(input: { distance: number; range: number; suppression: number; moving?: boolean; targetMoving?: boolean; settledMs: number }): number {
  return Math.max(.15, Math.min(.86, .84 - Math.min(1, input.distance / Math.max(1, input.range)) * .29
    - input.suppression * .28 - (input.moving ? .25 : 0) - (input.targetMoving ? .14 : 0)
    - Math.max(0, 700 - input.settledMs) / 3500));
}
