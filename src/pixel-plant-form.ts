/** Shared native-pixel silhouettes keep mature vegetation continuous across
 * the distant polygon pass and the cached pixel models. */
export const TREE_ART_HEIGHT = 420;
export const TREE_ART_MARGIN = 108;
export function treeCrownProfile(variant: number): { center: number; radiusY: number; spread: number; trunk: number } {
  return variant === 1 ? { center: 260, radiusY: 144, spread: .86, trunk: 238 }
    : variant === 2 ? { center: 274, radiusY: 118, spread: 1.5, trunk: 218 }
      : variant === 3 ? { center: 94, radiusY: 104, spread: 1.3, trunk: 242 }
        : { center: 258, radiusY: 110, spread: 1.7, trunk: 204 };
}
