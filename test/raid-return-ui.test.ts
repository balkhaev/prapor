import { describe, expect, test } from 'bun:test';
import { advance, createGame, dispatchRaid, dispatchSquadRaid, setGameOutcomeSeedSource } from '../src/game/engine';
import { raidReturnCard } from '../src/raid-return-ui';
import { multiplayerEntryBrief, multiplayerSelection } from '../src/multiplayer-entry';

const NOW = 1_792_000_000_000;

describe('one shared raid and saved paid returns', () => {
  test('the entry offers one shared world and old sector recommendations select its real districts', () => {
    const entry = multiplayerEntryBrief(0, 0);
    expect(entry).toContain('data-open-live');
    expect(entry).toContain('Общий PvPvE-мир');
    expect(entry).not.toMatch(/data-action="(?:dispatch|dispatch-squad|auto-enable)"/);
    expect(multiplayerSelection('courtyard')).toEqual({districtId: 'village', purpose: 'loot'});
    expect(multiplayerSelection('bunker', 'boss')).toEqual({districtId: 'sawmill', purpose: 'boss'});
  });

  test('a still travelling saved sortie shows its real remaining time without another entry or premature extraction', () => {
    const state = createGame(NOW);
    expect(dispatchRaid(state, state.scavs[0]!.id, 'courtyard', NOW).ok).toBe(true);
    const raid = state.raids[0]!, before = JSON.stringify(state);
    const html = raidReturnCard(state, raid, raid.endsAt - 61_000);
    expect(html).toContain('1:01');
    expect(html).toContain('Уже начатый выход завершится');
    expect(html).not.toContain('data-action="extract"');
    expect(html).not.toMatch(/data-watch-raid|continue-expedition|dispatch|auto-enable/);
    expect(JSON.stringify(state)).toBe(before);
  });

  test('the saved checkpoint offers only return of the confirmed personal cargo', () => {
    const state = createGame(NOW);
    setGameOutcomeSeedSource(state, () => 698906565);
    expect(dispatchRaid(state, state.scavs[0]!.id, 'courtyard', NOW).ok).toBe(true);
    const raid = state.raids[0]!;
    advance(state, raid.endsAt);
    expect(raid.expedition!.status).toBe('choice');
    raid.scavName = '<img src=x onerror=bad>';
    const before = JSON.stringify(state), html = raidReturnCard(state, raid, state.lastUpdated);
    expect(html).toContain(`data-action="extract" data-id="${raid.id}"`);
    expect(html).toContain('&lt;img src=x onerror=bad&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('Подтверждённый груз');
    expect(html).not.toMatch(/continue-expedition|run-perk|dispatch|data-watch-raid/);
    expect(JSON.stringify(state)).toBe(before);
  });

  test('the saved squad returns as a group and each member keeps a personal receipt', () => {
    const state = createGame(NOW);
    setGameOutcomeSeedSource(state, () => 698906565);
    const ids = state.scavs.slice(0, 2).map(scav => scav.id);
    expect(dispatchSquadRaid(state, ids, 'courtyard', NOW).ok).toBe(true);
    const raid = state.raids[0]!;
    advance(state, raid.endsAt);
    expect(state.raids).toHaveLength(2);
    const html = raidReturnCard(state, raid, state.lastUpdated);
    for (const member of state.raids) expect(html).toContain(`<h4>${member.scavName}</h4>`);
    expect(html).toContain('Вернуть отряд с добычей');
    expect(html.match(/data-action="extract"/g)).toHaveLength(1);
    expect(html).not.toMatch(/continue-expedition|dispatch-squad|data-watch-raid/);
  });
});
