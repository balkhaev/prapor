import type { LivePoint } from './game/live';
/** Bounded native path flattening. Curves retain subpixel precision until the
 * final integer profile is sampled; holes remain separate closed contours. */
export function weaponPathContours(source: string): LivePoint[][] {
    const tokens = source.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/g) ?? [];
    if (tokens.length > 24000)
        return [];
    const contours: LivePoint[][] = [];
    let index = 0, command = '', x = 0, y = 0, sx = 0, sy = 0, qx = 0, qy = 0, quadratic = false;
    const number = () => Number(tokens[index++]);
    const append = (nx: number, ny: number) => { x = nx; y = ny; contours.at(-1)?.push({ x, y }); };
    while (index < tokens.length) {
        if (/^[a-z]$/i.test(tokens[index]!))
            command = tokens[index++]!;
        if (!command)
            return [];
        const op = command.toUpperCase(), relative = command !== op, ox = x, oy = y;
        const needed = ({ M: 2, L: 2, H: 1, V: 1, Q: 4, T: 2, Z: 0 } as Record<string, number>)[op];
        if (needed === undefined || index + needed > tokens.length)
            return [];
        if (op === 'Z') {
            append(sx, sy);
            command = '';
            quadratic = false;
            continue;
        }
        if (tokens.slice(index, index + needed).some(token => !Number.isFinite(Number(token))))
            return [];
        if (op === 'M' || op === 'L') {
            const nx = number() + (relative ? ox : 0), ny = number() + (relative ? oy : 0);
            if (op === 'M') {
                contours.push([]);
                sx = nx;
                sy = ny;
                command = relative ? 'l' : 'L';
            }
            append(nx, ny);
            quadratic = false;
        }
        else if (op === 'H') {
            append(number() + (relative ? ox : 0), oy);
            quadratic = false;
        }
        else if (op === 'V') {
            append(ox, number() + (relative ? oy : 0));
            quadratic = false;
        }
        else {
            const cx = op === 'Q' ? number() + (relative ? ox : 0) : quadratic ? 2 * ox - qx : ox;
            const cy = op === 'Q' ? number() + (relative ? oy : 0) : quadratic ? 2 * oy - qy : oy;
            const nx = number() + (relative ? ox : 0), ny = number() + (relative ? oy : 0);
            const steps = Math.max(2, Math.min(24, Math.ceil((Math.hypot(cx - ox, cy - oy) + Math.hypot(nx - cx, ny - cy)) / 9)));
            for (let step = 1; step <= steps; step++) {
                const t = step / steps, s = 1 - t;
                append(s * s * ox + 2 * s * t * cx + t * t * nx, s * s * oy + 2 * s * t * cy + t * t * ny);
            }
            qx = cx;
            qy = cy;
            quadratic = true;
        }
    }
    return contours.filter(contour => contour.length >= 3);
}
/** Two samples per cell preserve thin native hardware. Even/odd and nonzero
 * scanlines preserve the actual windows of stocks, trigger guards and adapters. */
export function sampleWeaponContours(contours: readonly (readonly LivePoint[])[], fillRule: 'evenodd' | 'nonzero', paint: (x: number, y: number) => void): void {
    const points = contours.flat();
    if (!points.length)
        return;
    const low = Math.max(-96, Math.floor(Math.min(...points.map(p => p.y)))), high = Math.min(96, Math.ceil(Math.max(...points.map(p => p.y))));
    for (let row = low; row < high; row++)
        for (const offset of [.25, .75]) {
            const y = row + offset, crossings: Array<{
                x: number;
                winding: number;
            }> = [];
            for (const contour of contours)
                for (let i = 0; i < contour.length; i++) {
                    const a = contour[i]!, b = contour[(i + 1) % contour.length]!;
                    if (a.y <= y && b.y > y || b.y <= y && a.y > y)
                        crossings.push({ x: a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x), winding: b.y > a.y ? 1 : -1 });
                }
            crossings.sort((a, b) => a.x - b.x);
            let winding = 0, start = 0;
            for (const crossing of crossings) {
                const before = fillRule === 'evenodd' ? Math.abs(winding) % 2 !== 0 : winding !== 0;
                winding += crossing.winding;
                const after = fillRule === 'evenodd' ? Math.abs(winding) % 2 !== 0 : winding !== 0;
                if (!before && after)
                    start = crossing.x;
                else if (before && !after)
                    for (let x = Math.max(-128, Math.floor(start)); x < Math.min(128, Math.ceil(crossing.x)); x++) {
                        if (x + .25 >= start && x + .25 < crossing.x || x + .75 >= start && x + .75 < crossing.x)
                            paint(x, row);
                    }
            }
        }
}
