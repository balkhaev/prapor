import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { resolve } from "node:path";

const source = (name: string, text: string) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const engine = source("engine.ts", await Bun.file(resolve(import.meta.dir, "../src/game/engine.ts")).text());
const main = source("main.ts", await Bun.file(resolve(import.meta.dir, "../src/main.ts")).text());

/** New exported engine actions enter this boundary automatically, without a second command list. */
function engineActions(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const node of file.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
      && node.type && ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName) && node.type.typeName.text === "ActionResult") names.add(node.name.text);
  }
  return names;
}
const mutations = new Set([...engineActions(engine), "advance", "markAchievementsSeen"]);
const oldWriters = new Set(["createGameSaveStore", "createCloudSaveSync", "putSave"]);
interface Violation { line: number; reason: string }

function memberName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return null;
}
function accessPath(node: ts.Expression): string[] | null {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const path = accessPath(node.expression), name = memberName(node);
    return path && name ? [...path, name] : null;
  }
  if (ts.isParenthesizedExpression(node)) return accessPath(node.expression);
  return null;
}
function literalText(node: ts.Expression | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function boundaryViolations(file: ts.SourceFile, forbidden = mutations): Violation[] {
  const violations: Violation[] = [], aliases = new Map<string, string>(), engineNamespaces = new Set<string>();
  const report = (node: ts.Node, reason: string) => violations.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, reason });
  for (const node of file.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteralLike(node.moduleSpecifier) || node.importClause?.isTypeOnly) continue;
    const module = node.moduleSpecifier.text;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings) && /(?:^|\/)game\/(?:engine|achievements)(?:\.ts)?$/.test(module)) engineNamespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
      if (binding.isTypeOnly) continue;
      const imported = (binding.propertyName ?? binding.name).text;
      aliases.set(binding.name.text, imported);
      if (forbidden.has(imported) && /(?:^|\/)game\//.test(module)) report(binding, `Client imports mutating game action ${imported}`);
      if (oldWriters.has(imported)) report(binding, `Client imports obsolete game writer ${imported}`);
    }
  }
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && ts.isIdentifier(node.initializer) && engineNamespaces.has(node.initializer.text)) {
      for (const binding of node.name.elements) {
        if (!ts.isIdentifier(binding.name)) continue;
        const imported = binding.propertyName && (ts.isIdentifier(binding.propertyName) || ts.isStringLiteralLike(binding.propertyName)) ? binding.propertyName.text : binding.name.text;
        aliases.set(binding.name.text, imported);
        if (forbidden.has(imported)) report(binding, `Client references mutating game action ${imported}`);
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const path = accessPath(node);
      if (path?.at(-1) === "locks" && path.at(-2) === "navigator") report(node, "Client owns a local game writer lock");
      if (ts.isIdentifier(node.expression) && engineNamespaces.has(node.expression.text)) {
        const member = memberName(node);
        if (member === null) report(node, "Dynamic engine access can execute an unreviewed local game action");
        else if (forbidden.has(member)) report(node, `Client references mutating game action ${member}`);
      }
    }
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? aliases.get(node.expression.text) ?? node.expression.text : memberName(node.expression);
      if (name && forbidden.has(name)) report(node, `Client calls mutating game action ${name}`);
      if (name && oldWriters.has(name)) report(node, `Client calls obsolete game writer ${name}`);
      const callPath = accessPath(node.expression);
      if (callPath?.at(-1) === "fetch" && literalText(node.arguments[0])?.split("?")[0]?.endsWith("/api/save")) {
        const init = node.arguments[1];
        if (init && ts.isObjectLiteralExpression(init)) {
          const method = init.properties.find(property => ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) && property.name.text === "method");
          if (method && ts.isPropertyAssignment(method)) {
            const value = literalText(method.initializer)?.toUpperCase();
            if (value !== "GET" && value !== "HEAD") report(node, "Client writes a legacy /api/save snapshot");
          } else if (init.properties.some(property => ts.isSpreadAssignment(property) || ts.isShorthandPropertyAssignment(property) && property.name.text === "method")) report(node, "Legacy save fetch has an unreviewed request method");
        } else if (init) report(node, "Legacy save fetch has an unreviewed request initializer");
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return violations;
}

describe("authoritative game architecture boundary", () => {
  test("main cannot import or execute engine actions, advance gameplay locally, or own a client save writer", () => {
    expect(boundaryViolations(main)).toEqual([]);
  });

  test("the guard derives existing and future actions from engine declarations rather than a mirrored whitelist", () => {
    const derived = engineActions(engine);
    expect(derived.has("dispatchRaid")).toBe(true);
    expect(derived.has("setRaidPlan")).toBe(true);
    expect(derived.has("createGame")).toBe(false);
    const future = source("future-engine.ts", "export function futurePurchase(state: GameState): ActionResult { return { ok: true }; }");
    expect([...engineActions(future)]).toEqual(["futurePurchase"]);
    expect(boundaryViolations(source("future-main.ts", 'import { futurePurchase as purchase } from "./game/engine"; purchase(state);'), engineActions(future)).length).toBeGreaterThan(0);
  });

  test("the guard catches aliases, namespace calls, dynamic calls, local clocks, and old upload or writer paths", () => {
    for (const input of [
      'import { dispatchRaid as launch } from "./game/engine"; launch(state, scav, map);',
      'import { setRaidPlan } from "./game/engine"; setRaidPlan(state, scav, plan);',
      'import * as simulation from "./game/engine"; simulation.dispatchRaid(state, scav, map);',
      'import * as simulation from "./game/engine"; simulation["dispatchRaid"](state, scav, map);',
      'import * as simulation from "./game/engine"; simulation[chosenAction](state);',
      'import * as simulation from "./game/engine"; const { dispatchRaid: launch } = simulation; launch(state, scav, map);',
      'import { advance as tick } from "./game/engine"; tick(state, Date.now());',
      'import { markAchievementsSeen as seen } from "./game/achievements"; seen(state, ids);',
      'navigator.locks.request("prapor-save-writer", () => save());',
      'window.navigator["locks"].request("prapor-save-writer", () => save());',
      'import { createGameSaveStore as store } from "./game-save"; store(localStorage, options);',
      'accountApi.putSave(account, revision, JSON.stringify(state));',
      'fetch("/api/save", { method: "PUT", body: JSON.stringify(state) });',
      'fetch("/api/save", { method, body: JSON.stringify(state) });',
      'fetch("/api/save", { ...options });',
    ]) expect(boundaryViolations(source("unsafe-main.ts", input)).length).toBeGreaterThan(0);
  });

  test("presentation getters, type imports, UI preferences, and server commands remain allowed", () => {
    const safe = source("safe-main.ts", `
      import { createGame, getRaidQuote } from "./game/engine";
      import type { ActionResult } from "./game/engine";
      import * as presentation from "./game/engine";
      const preview = createGame();
      getRaidQuote(preview, scav, map);
      presentation.getIncomePerMinute(preview);
      gameClient.action({ type: "setRaidPlan", args: [scavId, objective, preparation] });
      localStorage.setItem("prapor.ui.guest", JSON.stringify(session));
      fetch("/api/save", { method: "GET" });
    `);
    expect(boundaryViolations(safe)).toEqual([]);
  });
});
