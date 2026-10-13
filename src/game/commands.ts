import type { ActionResult, GameState, ShelterCost } from './engine';

/** Commands contain intent only. The server supplies the state, clock and RNG. */
export interface GameCommandArguments {
  excavateShelter: [number, number]; buildRoom: [string, number, number]; upgradeRoom: [string];
  assignWorker: [string, string | null]; queueModuleProduction: [string, string];
  setRoomRecipe: [string, string | null, boolean]; cancelProduction: [string, string];
  setProductionReserve: [ShelterCost]; setRoomStockTarget: [string, number | null];
  setFieldKit: [string, 'none' | 'maintenance' | 'trauma']; queueFieldKitProduction: [string, 'maintenance' | 'trauma'];
  installModule: [string, string]; removeModule: [string, string]; assembleWeapon: [string];
  disassembleWeapon: [string]; sellModule: [string]; recycleModule: [string]; repairModule: [string];
  buySupplies: [string]; craftGear: [string]; equipGear: [string, string, string | null];
  repairGear: [string]; recycleGear: [string]; setLoadoutOption: [string, 'ammoType' | 'medkit', string | boolean];
  upgradeScavGear: [string, string]; setRaidTactic: [string, string]; setRaidPlan: [string, string, string]; setAutoRaidDepth: [string, number];
  setAutoRaid: [string, string | null, number]; stopAllAutoRaids: [];
  dispatchRaid: [string, string]; dispatchSquadRaid: [string[], string]; equipWeapon: [string, string | null];
  refreshRecruitment: []; hireRecruitCandidate: [string]; dismissScav: [string]; chooseScavTalent: [string, string];
  upgradeBase: [string]; repairWeapon: [string]; sellWeapon: [string]; recycleWeapon: [string];
  healScav: [string]; claimContract: [string]; continueExpedition: [string, string, string]; extractRaid: [string];
  resolveScavPersonalEvent: [string, string, string]; resolveSocialEvent: [string, string]; markAchievementsSeen: [string[]];
}
export type GameCommandType = keyof GameCommandArguments;
export type GameCommand = { [K in GameCommandType]: { type: K; args: GameCommandArguments[K] } }[GameCommandType];
export interface GameIdentity { id: string; kind: 'guest' | 'account'; name: string }
export interface GameSnapshot { state: GameState; revision: number; serverNow: number; identity: GameIdentity }
export interface GameActionSnapshot extends GameSnapshot { result: ActionResult }
