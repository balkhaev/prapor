import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mountFieldInterface } from '../src/field-ui';

class Classes {
  values = new Set<string>();
  add(...values: string[]) { values.forEach(value => this.values.add(value)); }
  remove(...values: string[]) { values.forEach(value => this.values.delete(value)); }
  contains(value: string) { return this.values.has(value); }
}
class FieldElement {
  hidden = false; disabled = false; title = ''; textContent = ''; focused = false;
  dataset: Record<string, string> = {};
  classList = new Classes();
  attributes = new Map<string, string>();
  queries = new Map<string, FieldElement>();
  handlers = new Map<string, (event: unknown) => void>();
  constructor(readonly tag = 'div') {}
  append() {} insertAdjacentHTML() {}
  querySelector(selector: string) { return this.queries.get(selector) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  matches(selectors: string) { return selectors.split(',').some(selector => this.classList.contains(selector.trim().slice(1))); }
  closest(selector: string) { return selector === 'button' && this.tag === 'button' ? this : null; }
  addEventListener(name: string, callback: (event: unknown) => void) { this.handlers.set(name, callback); }
  removeEventListener(name: string) { this.handlers.delete(name); }
  focus() { this.focused = true; }
}

let replacements: Map<string, PropertyDescriptor | undefined>;
let field: ReturnType<typeof mountFieldInterface> | undefined;
function replace(name: string, value: unknown) {
  replacements.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
beforeEach(() => { replacements = new Map(); });
afterEach(() => {
  field?.destroy(); field = undefined;
  for (const [name, descriptor] of replacements) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
});

function setup() {
  const body = new FieldElement(), root = new FieldElement(), dock = new FieldElement(), main = new FieldElement(), shade = new FieldElement(), location = new FieldElement(), fullscreen = new FieldElement('button');
  root.queries.set('#command-dock', dock); root.queries.set('.command-main', main); root.queries.set('#context-shade', shade); root.queries.set('.field-location', location); root.queries.set('[data-action="toggle-fullscreen"]', fullscreen);
  for (const selector of ['.eyebrow', 'strong', 'small']) location.queries.set(selector, new FieldElement());
  dock.queries.set('.field-panel-head, .command-context-head, .live-dock-head', new FieldElement());
  const buttons = { dock: [new FieldElement('button'), new FieldElement('button')], crew: [new FieldElement('button')], routes: [new FieldElement('button')] };
  for (const panel of ['dock', 'crew', 'routes'] as const) {
    const selector = `[data-field-panel="${panel}"]`;
    root.queries.set(selector, buttons[panel][0]!);
    root.queries.set(`#command-${panel} button`, new FieldElement('button'));
    for (const button of buttons[panel]) button.dataset.fieldPanel = panel;
  }
  const queryAll = (selector: string) => buttons[selector.match(/data-field-panel="(\w+)"/)?.[1] as keyof typeof buttons] ?? [];
  Object.assign(root, { querySelectorAll: queryAll });
  replace('Element', FieldElement);
  replace('document', { body, fullscreenElement: null, addEventListener() {}, removeEventListener() {} });
  replace('window', { innerWidth: 390 });
  replace('MutationObserver', class { observe() {} disconnect() {} });
  const worldState = { view: 'base' as const, context: 'room:workbench:4:7', status: 'На связи' };
  let closeContextCalls = 0, visibilityChanges = 0;
  field = mountFieldInterface({ root: root as unknown as HTMLElement, icon: () => '', getState: () => worldState, closeContext: () => { closeContextCalls++; }, onVisibilityChange: () => { visibilityChanges++; }, onError() {} });
  const click = (target: FieldElement) => root.handlers.get('click')!({ target, stopPropagation() {} });
  return { body, dock, shade, buttons, click, worldState, get closeContextCalls() { return closeContextCalls; }, get visibilityChanges() { return visibilityChanges; } };
}

describe('field panel visibility', () => {
  test('collapsing a selected room retains the context and restores the same panel', () => {
    const h = setup(); h.dock.classList.add('context-open'); field!.sync();
    const state = { ...h.worldState };
    expect(field!.isPanelOpen('dock')).toBe(true);
    field!.closePanel('dock');
    expect(field!.isPanelOpen('dock')).toBe(false);
    expect(h.shade.hidden).toBe(true);
    expect(h.closeContextCalls).toBe(0);
    expect(h.worldState).toEqual(state);
    expect(h.dock.classList.contains('context-open')).toBe(true);
    h.click(h.buttons.dock[0]!);
    expect(field!.isPanelOpen('dock')).toBe(true);
    expect(h.worldState).toEqual(state);
    expect(h.closeContextCalls).toBe(0);
    expect(h.visibilityChanges).toBe(2);
    field!.sync();
    expect(h.visibilityChanges).toBe(2);
  });

  test('the persistent raid shortcut and toolbar reflect and toggle the same dock', () => {
    const h = setup(); h.dock.classList.add('live-dock'); field!.sync();
    expect(h.buttons.dock.every(button => button.getAttribute('aria-expanded') === 'true')).toBe(true);
    // A refreshed raid HUD can temporarily carry stale aria state before the observer synchronises it.
    h.buttons.dock[1]!.setAttribute('aria-expanded', 'false');
    h.click(h.buttons.dock[1]!);
    expect(field!.isPanelOpen('dock')).toBe(false);
    expect(h.buttons.dock.every(button => button.getAttribute('aria-expanded') === 'false')).toBe(true);
    h.click(h.buttons.dock[0]!);
    expect(field!.isPanelOpen('dock')).toBe(true);
    expect(h.buttons.dock.every(button => button.getAttribute('aria-expanded') === 'true')).toBe(true);
    expect(h.closeContextCalls).toBe(0);
  });

  test('Escape dismisses visible field panels without dismissing the hidden preparation dock', () => {
    const h = setup(); h.dock.classList.add('live-dock', 'live-entry-dock'); field!.sync();
    expect(field!.dismiss()).toBe(false);
    h.click(h.buttons.crew[0]!);
    expect(field!.isPanelOpen('crew')).toBe(true);
    expect(field!.dismiss()).toBe(true);
    expect(field!.isPanelOpen('crew')).toBe(false);
    expect(field!.dismiss()).toBe(false);
    expect(h.closeContextCalls).toBe(0);
  });
});
