import type { WeaponCategory } from "./game/data";
import type { ArmoryMaterial, ArmoryPaint } from "./armory-surface";
import type { ModuleSlot } from "./game/modules";

export type ReferenceBounds = readonly [number, number, number, number];
export type ReferenceGeometry = { outline: string; detail: string; material: ArmoryMaterial; bounds: ReferenceBounds; fillRule?: "evenodd" | "nonzero"; muzzle?: { x: number; y: number }; offset?: { x: number; y: number }; railFootY?: number };
export type ReferenceProfile = { id: string; category: WeaponCategory; wood: boolean; bolt: boolean; integral: boolean; pump: boolean; compact: boolean; barrelEnd: number };
export type ReferencePaint = ArmoryPaint;
export type ReferenceTools = {
	fastener: (x: number, y: number, radius?: number) => string;
	vents: (x: number, y: number, count: number, width?: number, height?: number, spacing?: number) => string;
	ribs: (x: number, y: number, count: number, height: number, spacing?: number) => string;
	grain: (x: number, y: number, width: number, height?: number) => string;
	rail: (x: number, y: number, width: number) => string;
	topBridge: (right: number) => string;
	seam: (path: string, bright?: boolean) => string;
	checkering: (x: number, y: number, width: number, height: number) => string;
	triggerGuard: (x: number, y: number, width?: number, height?: number) => string;
	port: (x: number, y: number, width: number, height?: number) => string;
	selector: (x: number, y: number, length: number, stamped?: boolean) => string;
};
export type ReferenceLayout = {
	foreEnd: number;
	sideRailEnd?: number;
	laserCenter?: number;
	genericMountShift?: number;
	/** Top adapters may sit on a separate carry-handle or receiver deck. */
	topMountShift?: number;
	factoryTopMountShift?: number;
	receiverTopMountShift?: number;
	topMountLift?: number;
	dovetailShift?: number;
	opticShift?: readonly [number, number];
	foregripShift?: readonly [number, number];
};
export type ReferenceGrip = { factory: readonly [number, number]; upgrade?: readonly [number, number]; padded?: readonly [number, number] };
export type ReferenceRenderer = (slot: ModuleSlot, appearance: string, gun: ReferenceProfile, paint: ReferencePaint, tools: ReferenceTools) => ReferenceGeometry | undefined;
