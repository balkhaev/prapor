# Изометрические персонажи

Четыре взрослых вымышленных типажа совпадают с портретами: ветеран (0), собиратель (1), бегун (2), осторожный (3). В каждом `scav-isometric-N.png` — 16 кадров: четыре направления (`se`, `sw`, `ne`, `nw`) × ожидание, два шага, работа. Всего 64 кадра с настоящей прозрачностью.

Камера ортографическая, с приподнятой точкой обзора; передние ракурсы показывают лицо и грудь, задние — затылок и рюкзак. Направление выбирается по движению в экранной проекции, включая проходы в глубину. Повороты меняют кадр и сохраняют ширину силуэта. Внешность определяется характером дикого и сохраняется между базой и рейдом.

PNG сохранены без обработки. JSON описывает отдельные прямоугольники и выравнивает кадры на общей виртуальной площадке 512×512 с опорой ног (256, 480). `meta.characterHeight` задаёт исходную высоту для одинакового масштаба персонажей. Ряды и столбцы выделены по реальным прозрачным промежуткам, а не по приблизительной сетке генерации. Движение остаётся привязанным к расстоянию, работа — к прогрессу производства; режим уменьшенного движения сохраняет статичную позу. Инструменты и оружие поворачиваются отдельно и получают глубину по ракурсу.

Создано встроенным ImageGen, без CLI, 13 октября 2026 года. Исходный боковой атлас использован как референс внешности и материалов.

## Запросы генерации

### veteran

```text
Use case: stylized-concept
Asset type: production transparent animation sprite atlas for the isometric survival game Prapor.
Primary request: remake the OLIVE-CAP BEARDED VETERAN, the FIRST COLUMN character from the reference image, as a consistent adult isometric game character in exactly SIXTEEN full-body sprites in an exact FOUR COLUMN by FOUR ROW grid on a square canvas. Only this one character, repeated in four directions and four poses. Original fictional older bearded man, olive field cap, weathered olive jacket with chest pockets, canvas backpack, brown trousers with knee pads, dark boots, fingerless gloves.
Input image: the supplied image is an IDENTITY and material STYLE REFERENCE only. Replace its side-view camera with true orthographic isometric elevated camera, 30-degree downward viewing angle, tops of cap, shoulders and boots clearly visible. Retain detailed textured painted game sprite aesthetic, clear realistic adult proportions, not chibi, not toy, crisp contour and muted olive, rust, charcoal and dusty violet survival palette.
Composition: equal cells, centered character, entirely inside cell with ample transparent padding. Consistent head height and ground-contact baseline in EVERY cell, full boots and cap never cut off. No shadows outside character. Exactly 4 columns and 4 rows.
DIRECTIONS by COLUMN (do not change these between rows): column 1 FRONT-RIGHT, face/chest visible, nose pointing diagonally toward the lower right of the image; column 2 FRONT-LEFT, face/chest visible, nose pointing diagonally toward lower left; column 3 BACK-RIGHT, back and canvas backpack dominate, walking AWAY toward upper right, back of head, no front face; column 4 BACK-LEFT, back and backpack dominate, walking AWAY toward upper left, back of head, no front face. These four diagonal facings are critical.
POSES by ROW: row 1 IDLE upright natural standing arms relaxed; row 2 WALK-A left foot extended forward and right arm forward; row 3 WALK-B right foot extended forward and left arm forward (clearly opposite step from row2); row 4 WORK leaning slightly forward, both gloved hands close together in front at waist height using an invisible workbench, empty hands.
Lighting: consistent soft overhead upper-left light in WORLD space, readable clothes and shadowed opposite facets, no glossy plastic. Strong silhouettes designed to be readable at 50-70 pixels high.
Constraints: true alpha transparent background; sixteen sprites ONLY; no other character types; no environment, ground, shadow ellipse, text, labels, grid lines, UI, logos or watermark. All four columns must have genuinely different camera-facing orientations; never turn back-view columns into front faces. Do not reproduce the original atlas layout.
```

### collector

```text
Use case: stylized-concept
Asset type: production transparent animation sprite atlas for the isometric survival game Prapor.
Primary request: remake the REDHEADED SALVAGE WORKER, the SECOND COLUMN character from the reference image, as a consistent adult isometric game character in exactly SIXTEEN full-body sprites in an exact FOUR COLUMN by FOUR ROW grid on a square canvas. Only this one character, repeated in four directions and four poses. Original fictional adult redheaded woman, tied-back copper hair, rust-brown patched utility jacket with pockets, olive trousers with knee pads, rugged dark boots, work gloves, compact tan backpack and work belt.
Input image: the supplied image is an IDENTITY and material STYLE REFERENCE only. Replace its side-view camera with true orthographic isometric elevated camera, 30-degree downward viewing angle, tops of cap, shoulders and boots clearly visible. Retain detailed textured painted game sprite aesthetic, clear realistic adult proportions, not chibi, not toy, crisp contour and muted olive, rust, charcoal and dusty violet survival palette.
Composition: equal cells, centered character, entirely inside cell with ample transparent padding. Consistent head height and ground-contact baseline in EVERY cell, full boots and cap never cut off. No shadows outside character. Exactly 4 columns and 4 rows.
DIRECTIONS by COLUMN (do not change these between rows): column 1 FRONT-RIGHT, face/chest visible, nose pointing diagonally toward the lower right of the image; column 2 FRONT-LEFT, face/chest visible, nose pointing diagonally toward lower left; column 3 BACK-RIGHT, back and canvas backpack dominate, walking AWAY toward upper right, back of head, no front face; column 4 BACK-LEFT, back and backpack dominate, walking AWAY toward upper left, back of head, no front face. These four diagonal facings are critical.
POSES by ROW: row 1 IDLE upright natural standing arms relaxed; row 2 WALK-A left foot extended forward and right arm forward; row 3 WALK-B right foot extended forward and left arm forward (clearly opposite step from row2); row 4 WORK leaning slightly forward, both gloved hands close together in front at waist height using an invisible workbench, empty hands.
Lighting: consistent soft overhead upper-left light in WORLD space, readable clothes and shadowed opposite facets, no glossy plastic. Strong silhouettes designed to be readable at 50-70 pixels high.
Constraints: true alpha transparent background; sixteen sprites ONLY; no other character types; no environment, ground, shadow ellipse, text, labels, grid lines, UI, logos or watermark. All four columns must have genuinely different camera-facing orientations; never turn back-view columns into front faces. Do not reproduce the original atlas layout.
```

### runner

```text
Use case: stylized-concept
Asset type: production transparent animation sprite atlas for the isometric survival game Prapor.
Primary request: remake the HOODED SCOUT, the THIRD COLUMN character from the reference image, as a consistent adult isometric game character in exactly SIXTEEN full-body sprites in an exact FOUR COLUMN by FOUR ROW grid on a square canvas. Only this one character, repeated in four directions and four poses. Original fictional adult male agile scout, charcoal hood framing face, muted teal scarf, dark charcoal utility jacket with green straps, dark olive backpack, gray-green trousers with knee pads, rugged dark boots and gloves.
Input image: the supplied image is an IDENTITY and material STYLE REFERENCE only. Replace its side-view camera with true orthographic isometric elevated camera, 30-degree downward viewing angle, tops of cap, shoulders and boots clearly visible. Retain detailed textured painted game sprite aesthetic, clear realistic adult proportions, not chibi, not toy, crisp contour and muted olive, rust, charcoal and dusty violet survival palette.
Composition: equal cells, centered character, entirely inside cell with ample transparent padding. Consistent head height and ground-contact baseline in EVERY cell, full boots and cap never cut off. No shadows outside character. Exactly 4 columns and 4 rows.
DIRECTIONS by COLUMN (do not change these between rows): column 1 FRONT-RIGHT, face/chest visible, nose pointing diagonally toward the lower right of the image; column 2 FRONT-LEFT, face/chest visible, nose pointing diagonally toward lower left; column 3 BACK-RIGHT, back and canvas backpack dominate, walking AWAY toward upper right, back of head, no front face; column 4 BACK-LEFT, back and backpack dominate, walking AWAY toward upper left, back of head, no front face. These four diagonal facings are critical.
POSES by ROW: row 1 IDLE upright natural standing arms relaxed; row 2 WALK-A left foot extended forward and right arm forward; row 3 WALK-B right foot extended forward and left arm forward (clearly opposite step from row2); row 4 WORK leaning slightly forward, both gloved hands close together in front at waist height using an invisible workbench, empty hands.
Lighting: consistent soft overhead upper-left light in WORLD space, readable clothes and shadowed opposite facets, no glossy plastic. Strong silhouettes designed to be readable at 50-70 pixels high.
Constraints: true alpha transparent background; sixteen sprites ONLY; no other character types; no environment, ground, shadow ellipse, text, labels, grid lines, UI, logos or watermark. All four columns must have genuinely different camera-facing orientations; never turn back-view columns into front faces. Do not reproduce the original atlas layout.
```

### careful

```text
Use case: stylized-concept
Asset type: production transparent animation sprite atlas for the isometric survival game Prapor.
Primary request: remake the KNIT-CAP OLDER SCOUT, the FOURTH COLUMN character from the reference image, as a consistent adult isometric game character in exactly SIXTEEN full-body sprites in an exact FOUR COLUMN by FOUR ROW grid on a square canvas. Only this one character, repeated in four directions and four poses. Original fictional older adult man, gray beard, dark knit cap, weathered dusty violet jacket with pockets, tan canvas shoulder satchel and compact backpack, brown trousers with knee pads, rugged dark boots and gloves.
Input image: the supplied image is an IDENTITY and material STYLE REFERENCE only. Replace its side-view camera with true orthographic isometric elevated camera, 30-degree downward viewing angle, tops of cap, shoulders and boots clearly visible. Retain detailed textured painted game sprite aesthetic, clear realistic adult proportions, not chibi, not toy, crisp contour and muted olive, rust, charcoal and dusty violet survival palette.
Composition: equal cells, centered character, entirely inside cell with ample transparent padding. Consistent head height and ground-contact baseline in EVERY cell, full boots and cap never cut off. No shadows outside character. Exactly 4 columns and 4 rows.
DIRECTIONS by COLUMN (do not change these between rows): column 1 FRONT-RIGHT, face/chest visible, nose pointing diagonally toward the lower right of the image; column 2 FRONT-LEFT, face/chest visible, nose pointing diagonally toward lower left; column 3 BACK-RIGHT, back and canvas backpack dominate, walking AWAY toward upper right, back of head, no front face; column 4 BACK-LEFT, back and backpack dominate, walking AWAY toward upper left, back of head, no front face. These four diagonal facings are critical.
POSES by ROW: row 1 IDLE upright natural standing arms relaxed; row 2 WALK-A left foot extended forward and right arm forward; row 3 WALK-B right foot extended forward and left arm forward (clearly opposite step from row2); row 4 WORK leaning slightly forward, both gloved hands close together in front at waist height using an invisible workbench, empty hands.
Lighting: consistent soft overhead upper-left light in WORLD space, readable clothes and shadowed opposite facets, no glossy plastic. Strong silhouettes designed to be readable at 50-70 pixels high.
Constraints: true alpha transparent background; sixteen sprites ONLY; no other character types; no environment, ground, shadow ellipse, text, labels, grid lines, UI, logos or watermark. All four columns must have genuinely different camera-facing orientations; never turn back-view columns into front faces. Do not reproduce the original atlas layout.
```
