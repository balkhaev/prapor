import { describe, expect, test } from 'bun:test';
import { advance, applyHit, canDeploy, createGame, createHealth, dispatchRaid, getRaidQuote, getRecoveryWaitMs, getScavHealingQuote, healScav, healthPercent, isScavMedicallyReady, parseSave, saveGame, setAutoRaid, setLoadoutOption, type GameState } from '../src/game/engine';
import { MAP_BY_ID } from '../src/game/data';

const NOW = 1_792_000_000_000;
function funded(): GameState { const state = createGame(NOW); state.money = 50_000; state.supplies = { ammo: 100, medicine: 30, scrap: 100, intel: 40 }; return state; }
function wounded(state: GameState, percent = 40) { const scav = state.scavs[0]!; scav.body = createHealth(percent); scav.health = healthPercent(scav.body); scav.status = canDeploy(scav.body) ? 'ready' : 'wounded'; return scav; }
function copy(state: GameState) { const parsed = parseSave(saveGame(state)); expect(parsed).not.toBeNull(); return parsed!; }

describe('medical decisions in idle sorties and the shelter', () => {
	test('paying for a light wound always restores it before free recovery would finish', () => {
		const paid = funded(), scav = wounded(paid, 99), free = structuredClone(paid);
		const passive = getRecoveryWaitMs(scav.body!, 100, paid.base.medbay), quote = getScavHealingQuote(paid, scav);
		expect(quote.duration * 1000).toBeLessThan(passive);
		expect(healScav(paid, scav.id, NOW).ok).toBe(true);
		advance(paid, scav.medicalTreatment!.endsAt); advance(free, paid.lastUpdated);
		expect(scav.health).toBe(100); expect(free.scavs[0]!.health).toBeLessThan(100);
	});
	test('an already paid clinical course persists, locks departure, and finishes once without another charge', () => {
		const state = funded(), scav = wounded(state);
		applyHit(scav.body!, 'leftLeg', 5, { fracture: true }); scav.health = healthPercent(scav.body!); scav.status = 'wounded';
		const quote = getScavHealingQuote(state, scav), before = state.supplies.medicine;
		expect(healScav(state, scav.id, NOW).ok).toBe(true);
		expect(state.supplies.medicine).toBe(before - quote.medicine);
		expect(scav.health).toBeLessThan(100);
		expect(healScav(state, scav.id, NOW).ok).toBe(false);
		expect(getRaidQuote(state, scav, MAP_BY_ID.courtyard!).reason).toContain('лечения');
		const restored = copy(state), end = scav.medicalTreatment!.endsAt;
		advance(state, end - 1); expect(scav.medicalTreatment).toBeDefined();
		advance(state, end); advance(restored, end);
		expect(restored).toEqual(state);
		expect(scav.health).toBe(100); expect(scav.body!.parts.leftLeg.fracture).toBe(false);
		expect(scav.medicalTreatment).toBeUndefined(); expect(String(scav.status)).toBe('ready');
		expect(state.supplies.medicine).toBe(before - quote.medicine);
	});

	test('a living legacy zero-HP casualty can begin a valid saved course without dying in migration', () => {
		const state = funded(), scav = state.scavs[0]!;
		scav.health = 0; scav.status = 'wounded'; delete scav.body;
		expect(healScav(state, scav.id, NOW).ok).toBe(true);
		expect(scav.body!.parts.head.hp).toBeGreaterThan(0);
		expect(scav.body!.parts.chest.hp).toBeGreaterThan(0);
		expect(parseSave(saveGame(state))).toEqual(state);
		advance(state, scav.medicalTreatment!.endsAt); expect(scav.health).toBe(100);
	});

	test('high aggregate HP cannot hide a broken leg, and free recovery resumes an automatic order at the same event', () => {
		const state = funded(), scav = wounded(state, 100);
		applyHit(scav.body!, 'leftLeg', 40, { fracture: true }); scav.health = healthPercent(scav.body!); scav.status = 'wounded';
		expect(scav.health).toBeGreaterThan(80); expect(isScavMedicallyReady(scav)).toBe(false);
		expect(dispatchRaid(state, scav.id, 'courtyard', NOW).ok).toBe(false);
		setAutoRaid(state, scav.id, 'courtyard', 70, NOW);
		const fine = copy(state);
		const end = NOW + getRecoveryWaitMs(scav.body!, 70, state.base.medbay);
		advance(state, end);
		for (let time = NOW + 10_000; time < end; time += 10_000) advance(fine, time);
		advance(fine, end);
		expect(fine).toEqual(state);
		expect(scav.body!.parts.leftLeg.fracture).toBe(false);
		expect(state.raids.length + state.history.length).toBeGreaterThan(0);
	});

	test('a medical bag is paid only on departure, is frozen, and body damage survives a checkpoint reload', () => {
		const state = funded(), scav = state.scavs[0]!;
		expect(setLoadoutOption(state, scav.id, 'medkit', true).ok).toBe(true);
		const medicine = state.supplies.medicine;
		expect(dispatchRaid(state, scav.id, 'courtyard', NOW).ok).toBe(true);
		const raid = state.raids[0]!;
		expect(raid.expedition!.medical!.inventory).toMatchObject({ medkit: 120, bandage: 2, tourniquet: 1, surgery: 1 });
		expect(state.supplies.medicine).toBe(medicine - 1);
		setLoadoutOption(state, scav.id, 'medkit', false);
		const reload = copy(state); advance(state, raid.endsAt); advance(reload, raid.endsAt);
		expect(reload).toEqual(state); expect(state.supplies.medicine).toBe(medicine - 1);
		expect(scav.body).toBeDefined(); expect(scav.health).toBe(healthPercent(scav.body!));
		expect(raid.expedition!.medical!.inventory.medkit).toBeLessThan(120);
		expect(copy(state)).toEqual(state);
	});

	test('waiting at an idle checkpoint freezes blood loss together with the raid clock', () => {
		const state = funded(), scav = state.scavs[0]!;
		dispatchRaid(state, scav.id, 'courtyard', NOW);
		const raid = state.raids[0]!; raid.chance = 1; advance(state, raid.endsAt);
		expect(raid.expedition!.status).toBe('choice');
		applyHit(scav.body!, 'leftArm', 1, { bleeding: 'heavy' }); scav.health = healthPercent(scav.body!);
		const body = structuredClone(scav.body);
		advance(state, state.lastUpdated + 60_000);
		expect(scav.body).toEqual(body); expect(getRaidQuote(state, scav, MAP_BY_ID.courtyard!).reason).toBeTruthy();
		expect(copy(state)).toEqual(state);
	});

	test('a v15 paid sortie retains aggregate rules and a living zero-HP survivor through the upgrade', () => {
		const state = funded(), woundedScav = state.scavs[1]!;
		woundedScav.health = 0; woundedScav.status = 'wounded';
		dispatchRaid(state, state.scavs[0]!.id, 'courtyard', NOW);
		const historical = structuredClone(state); historical.schemaVersion = 15;
		for (const scav of historical.scavs) delete scav.body;
		for (const raid of historical.raids) delete raid.expedition!.medical;
		const restored = parseSave(JSON.stringify(historical))!; expect(restored).not.toBeNull();
		expect(restored.scavs[1]!.health).toBe(0); expect(restored.raids[0]!.expedition!.medical).toBeUndefined();
		const reference = structuredClone(historical); reference.schemaVersion = 16;
		advance(restored, restored.raids[0]!.endsAt); advance(reference, reference.raids[0]!.endsAt);
		expect(restored).toEqual(reference); expect(restored.scavs.some(scav => scav.id === woundedScav.id)).toBe(true);
		expect(copy(restored)).toEqual(restored);
	});

	test('current imports reject mismatched HP, impossible stock, missing bodies on medical sorties and malformed courses', () => {
		const state = funded(); dispatchRaid(state, state.scavs[0]!.id, 'courtyard', NOW);
		for (const mutate of [
			(value: GameState) => { value.scavs[0]!.health = 50; },
			(value: GameState) => { delete value.scavs[0]!.body; },
			(value: GameState) => { value.raids[0]!.expedition!.medical!.inventory.medkit = 999; },
			(value: GameState) => { value.scavs[0]!.body!.parts.head.hp = 100; },
		]) { const forged = structuredClone(state); mutate(forged); expect(parseSave(JSON.stringify(forged))).toBeNull(); }
		const base = funded(), scav = wounded(base); healScav(base, scav.id, NOW);
		const invalid = structuredClone(base); invalid.scavs[0]!.medicalTreatment!.endsAt = NOW;
		expect(parseSave(saveGame(invalid))).toBeNull();
	});
});
