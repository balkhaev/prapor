# Графика Прапора

Снаряжение расширено до 16 моделей: 6 бронежилетов, 4 шлема и 6 рюкзаков, всего 64 отдельных направленных кадра. Происхождение изображений, привязка шлема и текущая сборка оружия описаны в [EXPANDED-GEAR.md](EXPANDED-GEAR.md).

Текущие персонажи убежища и рейдов — 32 изометрических атласа `scav-isometric-0.png` … `scav-isometric-31.png`. В каждом четыре направления и четыре позы, всего 512 кадров тела. Атлас `scav-equipment.png` добавляет 16 кадров отдельных жилетов, брони и рюкзаков, которые выбираются по фактическому комплекту бойца. Формат опоры ног, происхождение, все модели и запросы генерации описаны в [DIVERSE-SCAVS.md](DIVERSE-SCAVS.md).

Текущие портреты вырезаются при отображении из первого переднего кадра соответствующей модели; координаты головы и плеч хранятся в `src/scav-portrait-data.ts`. Внешность бойца сохранена между убежищем, рейдом и личным делом. `scav-portraits.png` — ранее созданный атлас четырёх портретов, сетка 2×2: ветеран, собиратель, бегун, осторожный.

Текущие тела и снаряжение созданы встроенным ImageGen 13 октября 2026 года; исходная прозрачность PNG сохранена без обработки. Ранее созданные портреты и боковые рабочие — 12 октября 2026 года. Все персонажи — вымышленные взрослые. Иллюстрации оружия и сцена убежища создаются кодом игры.

## Интерьеры и рабочие · 0.9

`shelter-rooms.png` — сгенерированный атлас 1536×1024, два столбца и четыре ряда. Порядок: мастерская, медблок, радиорубка, склад, патронный цех, разборочная, жилой блок, грунт. Каждая текстура имеет размер 768×256. Статические интерьеры сочетаются с отдельными слоями работающего оборудования и персонажей.

`scav-workers.png` — сгенерированный атлас 1254×1254 с настоящей прозрачностью: четыре взрослых персонажа, четыре позы. `scav-workers.json` описывает 16 кадров с общим размером и опорой ног, сохраняя полный силуэт каждого персонажа. Кадры выделяются при загрузке текстуры; исходный PNG не изменён. Имена поз: `idle`, `walk-a`, `walk-b`, `work`; суффикс 0–3 задаёт персонажа.

Оба атласа созданы встроенным ImageGen (не CLI), 12 октября 2026 года. Формы одежды, лица и помещения вымышлены; на изображениях нет элементов игрового интерфейса. Оригинальные PNG сохранены в проекте.

Финальные запросы:

```text
Use case: stylized-concept
Asset type: production bitmap texture atlas for the 2D survival shelter browser game Prapor. Final canvas landscape 1536 by 1024, exactly TWO COLUMNS by FOUR ROWS of equal-size rectangular cells (each 768 by 256). No gutters or borders between cells. This is usable in-game art, not a UI mockup.
Primary request: eight richly detailed underground industrial room interiors viewed strictly SIDE-ON, front wall removed, orthographic cross-section; modest depth visible on the ceiling and side wall returns, continuous straight horizontal floor at the same vertical position in every cell. Textured pixel-paint 2D sprite aesthetic with sharp outlines, realistic survival-game materials and Zomboid-like density of small readable objects, warm task lights, dark olive/charcoal structural walls. Consistent camera and scale.
Cell order row-major: (1) firearms workshop: battered wooden workbench, tools on pegboard, steel lathe, spare gun parts and small trays; (2) medical room: tiled wall, bed with folded linen, old monitor, turquoise medicine cabinet; (3) radio room: green radar display, communications console, server rack, neatly bundled cables, papers; (4) storage: bolted metal racks with worn supply crates, canvas cases and ammunition tins; (5) ammunition factory: small mechanical press, feed conveyor, brass cartridge trays, ventilation pipes; (6) recycling station: compact crushing machine, scrap sorting belt, metal bins and rough repair tools; (7) dormitory: two double bunks, blankets, lockers, duffel bags, small warm lamp; (8) untouched excavation cavity: layered earth and rocks with subtle mineral seams, no equipment.
Lighting/mood: readable cinematic room lights, muted olive, warm brass, turquoise and dusty lilac room accents, detailed weathered surfaces but clear shapes at low scale.
Constraints: each scene entirely inside its own equal grid cell; all eight cells completely filled edge-to-edge; no characters, no legs, no people, no animation frames, no labels, no text, no numbers, no UI, no logos, no watermark. Maintain identical alignment of walls and floor, create distinct useful environmental textures. Avoid perspective tilt, birds-eye or isometric camera, empty margins, glossy 3D rendering.
```

```text
Use case: stylized-concept
Asset type: transparent character animation sprite atlas for the 2D survival shelter game Prapor. One square image, exactly FOUR COLUMNS by FOUR ROWS equal grid, sixteen full-body sprites, evenly spaced with generous transparent padding inside every cell.
Primary request: highly detailed readable 2D pixel-paint side-view fictional ADULT scavenger workers. All face RIGHT with three-quarter side faces; identical scale and floor baseline, head and boots fully visible in every cell. Warm rim light, clearly segmented limbs, defined boots/gloves/backpacks, believable fabric folds, painted crisp contours and textured limited survival-game palette. Original characters in the visual spirit of a grounded Zomboid-like scavenging game, consistent with muted olive industrial bunker interiors.
Each COLUMN is one consistent person across all four poses: column1 bearded older veteran, olive field cap, patched olive jacket, small canvas backpack; column2 redheaded salvage worker, rust-brown utility jacket, work belt and gloves; column3 agile hooded scout, charcoal hood, teal scarf and dark green backpack; column4 older cautious worker, dark knit cap, dusty violet coat, tan shoulder pouch. Make faces, hats and clothing distinct.
ROWS: row1 idle standing, arms resting naturally; row2 walking right with left foot leading and balanced opposing arms; row3 walking right with right foot leading, opposing arms; row4 leaning slightly toward a workbench, working with both gloved hands held forward around waist height, empty hands to allow code-drawn tools. Walking poses must preserve the same person and scale. Body dimensions in every cell must be consistent, feet at the same local baseline.
Constraints: genuine alpha-transparent background, no painted checkerboard, no floor, no cast shadow outside character, no scene, no boxes, no gutters, no borders, no text, no labels, no watermark, no weapons, no cropped limbs, no duplicated extras. Sixteen sprites only. Do not turn this into portraits or a poster. This atlas will be rendered near 50 pixels tall and zoomed, so use strong detailed silhouettes and crisp rather than blurry outlines.
```

Финальный запрос генерации:

```text
Use case: stylized-concept
Asset type: portrait sprite atlas for the existing 2D idle game «Прапор», a scavenger squad and industrial bunker with olive/amber interface.
Primary request: one square portrait atlas divided exactly into a seamless 2 by 2 grid of four equally sized square portraits. Each cell is a separately composed front-facing bust portrait of one fictional adult scavenger, centred inside that cell. Top left: battle-weathered bearded veteran in a worn olive cap and field jacket. Top right: resourceful redheaded collector in a patched utility jacket. Bottom left: agile adult runner in a charcoal hood and olive scarf. Bottom right: cautious older scout in a dark knit cap and practical weathered coat.
Style/medium: polished hand-painted 2D game character concept illustration, detailed textured brushwork, believable expressive faces, strong shapes readable at small avatar size. Each character visually distinct, same artistic style and scale.
Composition/framing: square canvas; the four cell boundaries are exactly at the vertical and horizontal midpoint. Head and upper chest fully contained in each square, moderate headroom, no overlapping cells. Matte dark olive background in each cell, subtle warm backlight and cool face fill so faces are readable in a dark UI.
Materials/textures: weathered canvas, wool, worn leather, no shiny plastic. Palette matched to desaturated olive, charcoal, warm ochre of the existing bunker.
Constraints: four characters only, no border or gutter, no panels inset, no weapons, no text, no UI, no watermark, no logos, no identifiable existing fictional or real person. Treat this as a ready-to-use portrait atlas, not a website mockup.
```

