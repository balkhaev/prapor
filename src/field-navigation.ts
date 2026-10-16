/** Keep frequent destinations visible and group secondary tools in one keyboard-friendly menu. */
export function mountFieldNavigation(rail: HTMLElement) {
  const primary = ["base", "raids", "arsenal", "squad", "flea"];
  const more = document.createElement("details");
  more.className = "field-more";
  more.innerHTML = '<summary aria-label="Ещё разделы и настройки" title="Ещё разделы и настройки"><span aria-hidden="true">•••</span><span>Ещё</span></summary><div class="field-more-panel"><strong>Разделы и настройки</strong><div class="field-more-items"></div></div>';
  const items = more.querySelector<HTMLElement>(".field-more-items")!;
  const destinations = primary.map(id => rail.querySelector<HTMLButtonElement>(`[data-page="${id}"]`)).filter((button): button is HTMLButtonElement => Boolean(button));
  for (const node of [...rail.children]) if (!destinations.includes(node as HTMLButtonElement)) items.append(node);
  for (const button of destinations) rail.append(button);
  rail.append(more);
  function closeMenu() {
    if (more.contains(document.activeElement)) more.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    more.open = false;
  }
  function click(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null;
    if (!rail.contains(target)) closeMenu();
    else if (target?.closest("button") && !target.closest(".scene-climate-panel")) closeMenu();
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === "Escape" && more.open) {
      event.preventDefault(); event.stopPropagation(); more.open = false;
      more.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    }
  }
  // Field panel clicks stop bubbling; capture closes this menu before their action.
  document.addEventListener("click", click, true);
  rail.addEventListener("keydown", keydown);
  return {
    focusPage(page: string) {
      const button = rail.querySelector<HTMLButtonElement>(`[data-page="${page}"]`);
      const target = button?.getClientRects().length ? button : more.querySelector<HTMLElement>("summary");
      target?.focus({ preventScroll: true });
    },
    destroy() { document.removeEventListener("click", click, true); rail.removeEventListener("keydown", keydown); },
  };
}
