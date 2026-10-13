# Разные дикие и отдельное снаряжение

Каталог содержит 32 взрослых вымышленных персонажа. Для каждого есть 16 кадров: четыре направления (`se`, `sw`, `ne`, `nw`) × ожидание, два противоположных шага и работа. Всего 512 кадров тела. Внешность сохраняется в личном деле дикого и остаётся одинаковой в убежище, портрете и рейде.

Базовые персонажи изображены в обычной одежде, без оружия, бронежилета и рюкзака. Снаряжение отображается отдельно по фактическому комплекту бойца. Атлас `scav-equipment.png` содержит 16 кадров: лёгкий жилет, броня, малый и большой рюкзаки × те же четыре направления. Пустой слот не добавляет соответствующий предмет к модели.

PNG созданы встроенным ImageGen 13 октября 2026 года и сохранены с исходной прозрачностью без обработки. Камера ортографическая изометрическая, приподнята примерно на 30°; передние направления показывают лицо и грудь, задние — спину и затылок. Материалы матовые, с потёртостями, ткани и кожа читаются в небольшом игровом масштабе.

## Файлы и выравнивание

- `scav-isometric-0.png` … `scav-isometric-31.png` — исходные атласы персонажей.
- Соответствующие JSON выделяют кадры по реальным прозрачным промежуткам; соседние силуэты не попадают в кадр.
- Виртуальная площадка тела — 512×512, опора ног — (256, 480). `meta.characterHeight` задаёт масштаб. Горизонтальная ось берётся из головы первого кадра каждого направления и сохраняется между позами, поэтому взмах руки не двигает весь силуэт.
- Вокруг читаемого силуэта в кадре сохраняется до 2 px полупрозрачного края. Далёкие почти невидимые пиксели не подключаются метаданными к кадру и не сдвигают персонажа; исходные PNG остаются без изменений. `meta.characterHeight` — медианная высота четырёх готовых кадров ожидания, нижняя граница каждого кадра на виртуальной площадке находится точно на 480.
- `frame.custom.torso` задаёт центр груди или спины относительно опоры ног при высоте персонажа 48 px. Отдельное снаряжение следует за наклоном рабочей позы и шагами.
- `scav-equipment.json` использует площадку 512×512 с центром (256, 256). Ключи кадров: `light_vest-se`, `plate_armor-se`, `scout_pack-se`, `cargo_pack-se` и соответствующие остальные направления. `meta.equipmentHeightByModel` хранит собственную высоту каждого предмета для нормализации масштаба.
- `src/scav-portrait-data.ts` хранит нативные квадратные области головы и плеч переднего кадра. Портрет берётся из того же PNG, что и игровая модель.

## Постоянные идентификаторы

| ID | Типаж | Характер |
| --- | --- | --- |
| 0 | [Борода](scav-isometric-0.png) | ветеран |
| 1 | [Рыжий](scav-isometric-1.png) | собиратель |
| 2 | [Шустрый](scav-isometric-2.png) | бегун |
| 3 | Осторожный | осторожный |
| 4 | [Шрам](scav-isometric-4.png) | ветеран |
| 5 | [Сталь](scav-isometric-5.png) | ветеран |
| 6 | [Уголь](scav-isometric-6.png) | ветеран |
| 7 | [Усатый](scav-isometric-7.png) | ветеран |
| 8 | [Мороз](scav-isometric-8.png) | ветеран |
| 9 | [Искра](scav-isometric-9.png) | ветеран |
| 10 | [Бронза](scav-isometric-10.png) | ветеран |
| 11 | [Дождь](scav-isometric-11.png) | собиратель |
| 12 | [Сажа](scav-isometric-12.png) | собиратель |
| 13 | [Мастер](scav-isometric-13.png) | собиратель |
| 14 | [Янтарь](scav-isometric-14.png) | собиратель |
| 15 | [Песок](scav-isometric-15.png) | собиратель |
| 16 | [Вишня](scav-isometric-16.png) | собиратель |
| 17 | [Ржавый](scav-isometric-17.png) | собиратель |
| 18 | [Сумрак](scav-isometric-18.png) | бегун |
| 19 | [Ласточка](scav-isometric-19.png) | бегун |
| 20 | [Срез](scav-isometric-20.png) | бегун |
| 21 | [Мох](scav-isometric-21.png) | бегун |
| 22 | [Призрак](scav-isometric-22.png) | бегун |
| 23 | [Синица](scav-isometric-23.png) | бегун |
| 24 | [Белый](scav-isometric-24.png) | бегун |
| 25 | [Тихая](scav-isometric-25.png) | осторожный |
| 26 | [Линза](scav-isometric-26.png) | осторожный |
| 27 | [Дед](scav-isometric-27.png) | осторожный |
| 28 | [Медь](scav-isometric-28.png) | осторожный |
| 29 | [Сторож](scav-isometric-29.png) | осторожный |
| 30 | [Снегирь](scav-isometric-30.png) | осторожный |
| 31 | [Лётчик](scav-isometric-31.png) | осторожный |

## Общие ограничения генерации

Каждый запрос создаёт один самостоятельный атлас одного персонажа. Раскладка: ровно четыре столбца и четыре ряда, полная фигура с прозрачным запасом вокруг головы, рук и ботинок. Столбцы направлены вперёд вправо, вперёд влево, назад вправо и назад влево; ряды — ожидание, шаг левой ногой, шаг правой ногой и работа руками у невидимого верстака. Ни окружения, ни поверхности под ногами, ни теневых овалов, надписей, линий сетки или логотипов нет.

Для предметов снаряжения генерируется отдельный атлас без людей. Предметы показаны в той же камере и тех же направлениях, чтобы совмещаться с телом. Оружие остаётся отдельным изображением выбранного игрового ствола.

## Запросы ImageGen

Во всех запросах исходный атлас ветерана использован только как референс стиля, камеры и расположения кадров. Для первого персонажа он также задаёт внешность.

### 0: Борода

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: The reference veteran's identity: older light-skinned bearded adult man in olive field cap, worn olive field jacket, brown knee-patched trousers and dark boots. Retain his gray beard and cap, but REMOVE every backpack, bag, armor, chest rig and shoulder strap; only normal jacket pockets.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 1: Рыжий

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Adult copper-red-haired woman with tied-back hair, patched rust-brown work jacket, olive trousers, dark boots and gloves. Same identity as original redheaded collector, but NO backpack, satchel, chest rig, armor or shoulder straps, just practical civilian work clothes.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 2: Шустрый

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Adult hooded male scout, charcoal hood, muted teal neck scarf, charcoal utility jacket and gray-green trousers, rugged boots. Same original runner identity, but NO backpack, vest, chest rig, armor or shoulder straps. Bare jacket torso ready for modular gear.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 3: Седой

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Older gray-bearded adult man wearing a dark knit cap, dusty violet practical jacket and brown trousers. Same original careful scout identity, but REMOVE satchel, backpack, chest rig and all shoulder straps. Just jacket, plain belt, gloves and boots.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 4: Шрам

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Broad-shouldered bald middle-aged light-skinned adult man, deep brow scar, thick dark stubble, open worn sage field jacket over cream shirt, dark olive reinforced trousers, scuffed brown boots. Uncovered head gives distinct strong silhouette.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 5: Сталь

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Tough older light-skinned adult woman with short silver hair visible under a battered dull steel military helmet, plain faded khaki field jacket, charcoal trousers and black boots. No tactical vest, just jacket torso.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 6: Уголь

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Stocky dark-skinned middle-aged adult man with close beard, burnt-orange rolled wool cap, faded woodland camouflage jacket with ordinary fabric pockets, tan work trousers and heavy dark boots.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 7: Усатый

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Middle-aged East Asian adult man with strong moustache, navy blue wool watch cap, plain olive field shirt over a striped undershirt, brown reinforced trousers and dark boots.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 8: Мороз

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Older light-skinned adult man with short gray beard, bulky gray fur ushanka, worn slate gray winter parka and muted brick-red neck scarf, dark wool trousers and thick boots. Distinct fur hat, civilian coat.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 9: Искра

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Athletic adult light-skinned woman with cropped copper hair and shaved temple, freckled face, faded tan buttoned field jacket, dark brown combat trousers, fingerless gloves and brown boots. No hat.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 10: Бронза

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Tall adult man with medium brown skin and black close beard under a dull gunmetal ballistic helmet, pale khaki long-sleeve military shirt, navy reinforced trousers and heavy boots. No armored torso or equipment.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 11: Дождь

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Bald adult light-skinned man, short ginger stubble, open mustard yellow weathered rain jacket with rolled cuffs, gray undershirt, dark green trousers and black rubber boots. Hood down, no hat.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 12: Сажа

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Adult woman with medium brown skin, dense black curls gathered with a faded red bandana, plain rust-red buttoned worker jacket, gray work trousers, black gloves and rugged boots.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 13: Мастер

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Adult fair-skinned man with messy short blond hair, square protective goggles on forehead, faded cobalt blue mechanic's coveralls with waist tied sleeves and off-white work shirt, worn brown boots and gloves. No apron or equipment.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 14: Янтарь

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Dark-skinned adult woman with short tight curls under a navy beanie, patched burnt orange civilian work jacket with subtle faded reflective bands, brown trousers and dark boots. No utility vest, armor, bags or straps.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 15: Песок

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Middle-aged adult man with olive skin and salt-and-pepper beard, beige canvas hooded jacket zipped halfway over dark shirt, dull green trousers and heavy brown boots. Plain clothing torso with no bags or harness.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 16: Вишня

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Adult East Asian woman with black ponytail, safety goggles perched on top of head, quilted dusty burgundy work jacket, tan trousers, work gloves and gray boots. Hoodless, no body equipment.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 17: Ржавый

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Heavyset fair-skinned adult man with large curly ginger beard, dark brown leather cap, faded brown leather work jacket with lighter seams, olive trousers and dark boots. Strong broad silhouette but consistent overall height.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 18: Сумрак

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Lean dark-skinned adult male scout, pale gray hood around face, muted turquoise scarf at neck, slate blue lightweight jacket, charcoal slim trousers and tall black boots.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 19: Ласточка

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Athletic adult woman with olive skin, low dark ponytail beneath a navy baseball cap, weathered cream windbreaker, dark olive narrow trousers and tan hiking boots.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 20: Срез

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Young adult East Asian man with short tousled black hair, small red scarf, plain dark olive cropped jacket and charcoal reinforced trousers, gray hiking boots. No cap, no armor.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 21: Мох

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Adult fair-skinned woman with short orange-red hair beneath a moss green raised hood, worn green rain jacket, beige narrow trousers and dark lace-up hiking boots. No cape or poncho.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 22: Призрак

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Lean adult light-skinned bald male scout with dark stubble and simple charcoal cloth half-mask, black-gray zip jacket, dusty tan slim trousers, gray gloves and black boots. Clearly adult realistic proportions.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 23: Синица

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Adult woman with medium brown skin and straight black bob haircut peeking beneath a charcoal hood, dark dusty blue cropped jacket, gray-green slim trousers and brown boots.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 24: Белый

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Tall adult light-skinned man with dark beard, bright worn off-white knit beanie, light gray urban camouflage jacket and dull green neck scarf, dark gray trousers and beige boots.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 25: Тихая

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Older light-skinned adult woman, gray braid, dark brown wool beret, faded sage-green heavy buttoned jacket over cream wool sweater, brown straight trousers and dark practical boots.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 26: Линза

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Middle-aged East Asian adult man wearing small round eyeglasses and navy beanie, olive quilted civilian coat, dark beige trousers and black lace-up boots. Slim cautious silhouette.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 27: Дед

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Elderly adult light-skinned man with long full gray beard, faded brown fur ushanka with lowered ear flaps, weathered brown winter jacket, olive wool trousers and heavy dark boots.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 28: Медь

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Adult dark-skinned woman with copper brown tied headscarf, dusty slate-purple parka, charcoal straight trousers, practical gloves and tan hiking boots.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 29: Сторож

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Older light-skinned adult man with deep-lined face and thin gray moustache, raised olive hood, faded tan thigh-length field coat with plain buttons, dark green trousers and brown boots.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 30: Снегирь

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Middle-aged adult olive-skinned man with dark beard, faded red knit cap, worn navy winter jacket with pale elbow patches, gray straight trousers and dark boots.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### 31: Лётчик

```text
Use case: stylized-concept
Asset type: production ALPHA TRANSPARENT modular base-character sprite atlas for the isometric survival game Prapor, square 4 COLUMNS by 4 ROWS, exactly16 full-body sprites.
Input image: supplied veteran atlas is STYLE, CAMERA and GRID reference only. For this request draw the new character described below. Never copy the reference man's identity or backpack unless subject explicitly says same identity.
Subject: Middle-aged light-skinned adult man with black moustache, dark brown leather aviator cap, worn brown leather flight jacket and muted teal wool neck scarf, khaki trousers and scuffed boots.
Style: grounded crisp textured pixel-painted adult survival game sprites, the same orthographic elevated isometric camera as reference, looking down30degrees with visible tops of head/shoulders/boots. Realistic adult anatomy, NO chibi or glossy toys, weathered cloth and leather, restrained but distinguishable clothing colors. Soft upper-left overhead illumination, clear contour readable at50px high.
LAYOUT: exactly4cols×4rows, sixteen isolated full-body sprites of ONLY this same person, same clothing and identity everycell. Full head, boots and fingers visible. Center all sprites in equal cells, consistent native height and floor baseline within each row, ample TRUE TRANSPARENT margin at least16pixels around each sprite; clear transparent gaps between rows and columns.
COLUMN DIRECTIONS: col1 FRONT-RIGHT toward lower right, face/chest visible; col2 FRONT-LEFT toward lower left, face/chest visible; col3 BACK-RIGHT moving AWAY toward upper right, back/neck/back of head visible, NO front face; col4 BACK-LEFT moving AWAY toward upper left, back of head/neck visible, NO front face. Camera orientation must be truly different, not a mirrored sideview.
ROW POSES: row1 IDLE upright arms relaxed; row2 WALK-A left leg and opposite right arm forward; row3 WALK-B right leg and opposite left arm forward, noticeably opposite contact from row2; row4 WORK/READY leaning slightly forward, both empty gloved hands held together at waist in front as if holding an invisible long tool/weapon. Preserve four directional facings in every row.
CRITICAL MODULAR RULE: This is a clothing-only body layer. NO backpacks, bags, satchels, shoulder straps, armor, chest rigs, ammunition pouches, tactical vests, weapons, tools or helmets not named in subject. Ordinary coat pockets and plain trouser belt allowed. Back-view MUST show plain back of jacket, with nothing attached. Separate gear will be composited by game. Hands empty in all16cells.
Constraints: true alpha transparency; no background, scene, ground/floor, contact shadows outside body, labels, text, numbers, gridlines, borders, UI or watermark. Sixteen sprites ONLY, one consistent fictionaladult person. Preserve crisp detail atzoom and distinct silhouette. Do NOT include extra gear or characters.
```

### Отдельное снаряжение

[Атлас предметов](scav-equipment.png)

```text
Use case: stylized-concept
Asset type: transparent MODULAR EQUIPMENT OVERLAY sprite atlas for the isometric survival game Prapor. Exactly FOUR COLUMNS by FOUR ROWS, sixteen isolated wearable objects, no people, square canvas.
Reference image role: character sprite atlas specifies style and elevated orthographic isometric camera only. Equipment must be same crisp textured pixel-painted grounded survival aesthetic, worn canvas, cloth, metal, muted olive/tan/charcoal. NO character pixels in output.
COLUMN orientations: 1 FRONT-RIGHT chest-facing toward lower right; 2 FRONT-LEFT chest-facing toward lower left; 3 BACK-RIGHT back-facing toward upper right; 4 BACK-LEFT back-facing toward upper left. Every row holds the same wearable object in these4angles. Elevated camera30degree downward, subtle tops visible.
ROW1 light_vest: worn tan/olive kevlar chest rig/light vest, narrow shoulder straps, waist straps, five visible small magazine pouches across FRONT, smooth soft back panel, no neck guard. Transparent hollow neck and open armholes. Designed to overlay torso below neck above belt, no arms/skin.
ROW2 plate_armor: heavier charcoal/olive plate carrier, broad rectangular chest plate, two large front ammunition pouches, padded shoulder strips, thicker cummerbund, plain heavy backplate. Clearly bulkier/darker than row1, transparent neck and armholes, no arms/skin.
ROW3 scout_pack: compact olive canvas scout backpack with top flap, side pocket and TWO slim shoulder straps. In FRONT columns only shoulder straps and slight sides of backpack visible, main backpack mass lies behind invisible torso; BACK columns full backpack is seen with straps, flap and pockets. No imaginary mannequin, empty space between straps transparent.
ROW4 cargo_pack: tall brown-green expedition backpack on weathered external steel cargo frame, attached rolled beige blanket on top and sleeping mat on bottom, tied side sacks. Large load silhouette. In FRONT columns only shoulder straps/frame sides and top roll visible around invisible torso; BACK columns large cargo bag and frame clearly visible. No skin or mannequin.
All equipment worn on an invisible adult torso, form/volume matching camera. Keep scale consistency within each row, do not make front views flat icons. Align object centers in cells and leave generous transparent margin16px+, no cutoff strap or frame. Empty inner openings genuinely transparent, no painted background inside arm/neck holes.
Constraints: true alpha background, exactly16 equipment overlays only, one item per cell; no people, face, neck, head, limbs, shirt, body, mannequin, floor/shadows, weapons, text, labels, frame, grid, scene, logo or watermark.
```

## Финальная расстановка кадров

Атласы 5, 6, 12 и 30 после первоначальной генерации отредактированы встроенным ImageGen по одинаковому запросу ниже. Референс — собственный первоначальный атлас этого же персонажа; внешность и одежда сохраняются. Итоговые PNG перенесены в проект без обработки кодом.

```text
Preserve this SAME character identity, clothing, elevated orthographic isometric camera, four directional columns and four pose rows, transparent background and crisp painted style. Change ONLY sprite scale and grid placement: shrink every full-body sprite by about 18% inside its existing cell, align it centered horizontally, and leave AT LEAST 40 pixels of completely transparent gutter above AND below each figure. Exactly FOUR equal columns and FOUR equal rows,16 sprites, one sprite entirely within each cell, no hands/boots/hat can approach another row. The transparent gutters must span the full canvas width between rows. Keep whole heads, boots and fingers. This is modular clothing-only character with NO bags, backpack, tactical rig, armor, weapon or shoulder straps. Don't crop any sprite. TRUE alpha transparency, no scene, text, shadow, border or painted checkerboard. Clean roomy production sprite atlas is essential.
```


## Дополнительный запрос для кадров 5, 6, 12 и 30

Для этих четырёх атласов отдельно увеличены прозрачные промежутки между фигурами. Итоговые PNG заменили тесные первоначальные варианты; точки опоры и масштаб пересчитаны по итоговым изображениям.

```text
Preserve this SAME character identity, clothing, elevated orthographic isometric camera, four directional columns and four pose rows, transparent background and crisp painted style. Change ONLY sprite scale and grid placement: shrink every full-body sprite by about 18% inside its existing cell, align it centered horizontally, and leave AT LEAST 40 pixels of completely transparent gutter above AND below each figure. Exactly FOUR equal columns and FOUR equal rows,16 sprites, one sprite entirely within each cell, no hands/boots/hat can approach another row. The transparent gutters must span the full canvas width between rows. Keep whole heads, boots and fingers. This is modular clothing-only character with NO bags, backpack, tactical rig, armor, weapon or shoulder straps. Don't crop any sprite. TRUE alpha transparency, no scene, text, shadow, border or painted checkerboard. Clean roomy production sprite atlas is essential.
```
