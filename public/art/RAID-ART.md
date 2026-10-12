# Уличная графика · 0.10

`raid-props.png` — оригинальный сгенерированный атлас 1024×1536 с настоящей прозрачностью. `raid-props.json` выделяет восемь кадров без изменения исходного изображения: cottage, shop, garage, factory, car, barrels, crates, barricade. Из-за разной высоты зданий и объектов кадры описаны отдельными прямоугольниками с опорой внизу по центру. Файлы находятся в `F:/code/prapor/public/art/` после интеграции.

Создано встроенным ImageGen, без CLI, 13 октября 2026 года. Изображения вымышленные. Улицы, освещение, навигация, тени, частицы и глубина сцены создаются движком игры.

Финальный запрос:

```text
Use case: stylized-concept
Asset type: production transparent bitmap prop atlas for the original 2.5D isometric survival browser game Prapor. One PORTRAIT canvas, exactly TWO COLUMNS and FOUR ROWS, eight equal cells with generous transparent padding. This is game sprite art, not a poster or UI.
Primary request: eight isolated detailed objects viewed with the SAME orthographic isometric camera: verticals upright, two ground axes at approximately +30 and -30 degrees, front-right and front-left faces visible, no perspective vanishing. Grounded textured pixel-painted survival aesthetic, sharp readable contours, weathered brick, plaster, rust, faded muted olive/charcoal/turquoise, warm muted afternoon task light consistent across all eight. Rich small detail in the spirit of a dense scavenging town, original fictional designs.
Row-major cell order:
1. small two-storey brick apartment corner building with roof, patched windows, drainpipe and faded plaster, closed rectangular footprint;
2. low abandoned corner shop with battered awning, glass door and boarded windows, no readable sign, closed rectangular footprint;
3. old concrete garage with corrugated roof and rusty roller door, closed rectangular footprint;
4. compact industrial workshop brick building with sawtooth roof and vents, broken window panes, closed rectangular footprint;
5. damaged dull blue compact delivery van, tires and hood, no markings;
6. a group of three dented oil barrels beside two garbage sacks, all one small footprint;
7. two military surplus wood crates with a canvas toolbag, closed containers, no markings;
8. low improvised concrete and sandbag barricade, readable cover geometry.
Composition: every object entirely in its own cell, centered, feet/ground contact near the bottom, all roofs and protrusions visible. The first four buildings similar scale. Last four props intentionally smaller and separated. No floor tile or ground slab; only a subtle contact shadow directly beneath each object. Clean real alpha transparency surrounding each sprite, no checkerboard baked in.
Constraints: exactly eight objects/groups, no people, no weapons in hands, no labels, no text, no grid lines, no frames, no borders, no logos, no watermark. Never merge cells, never crop roofs or wheels. Avoid glossy 3D toys, blurry painterly gradients, exaggerated perspective or cartoon outlines. Crisp usable at 150–250 pixels per building, retaining detail when zoomed.
```

