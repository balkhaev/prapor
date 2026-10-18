import { expect, test } from 'bun:test';
import ts from 'typescript';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const parse = (name: string, text: string) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Explicit type imports disappear before bundling. Value imports, side-effect
 * imports, re-exports and lazy imports all need their file in the build image. */
function runtimeImports(text: string): string[] {
  const imports: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const clause = node.importClause, bindings = clause?.namedBindings;
      const onlyTypes = clause?.isTypeOnly || !clause?.name && bindings && ts.isNamedImports(bindings)
        && bindings.elements.length > 0 && bindings.elements.every(binding => binding.isTypeOnly);
      if (!onlyTypes) imports.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const onlyTypes = node.isTypeOnly || node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length > 0 && node.exportClause.elements.every(binding => binding.isTypeOnly);
      if (!onlyTypes) imports.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(parse('frontend.ts', text));
  return imports;
}

function frontendBuildInputs(dockerfile: string): string[] {
  const stage = dockerfile.match(/FROM[^\n]+\bAS\s+build\b([\s\S]*?)(?=\nFROM\b|$)/i)?.[1];
  if (!stage) throw new Error('Docker frontend build stage is missing');
  return [...stage.matchAll(/^COPY\s+(.+)$/gim)].flatMap(match => {
    const operands = match[1]!.trim().split(/\s+/);
    if (operands.some(operand => operand.startsWith('--'))) throw new Error('Review frontend COPY flags in build-boundary test');
    return operands.slice(0, -1).map(source => resolve(root, source));
  });
}

function includedInBuild(file: string, inputs: readonly string[]): boolean {
  return inputs.some(input => {
    if (file === input) return true;
    if (!statSync(input).isDirectory()) return false;
    const path = relative(input, file);
    return !isAbsolute(path) && path !== '..' && !path.startsWith(`..\\`) && !path.startsWith('../');
  });
}

test('all frontend entrypoints can resolve runtime relative imports using only Docker frontend COPY inputs', () => {
  const inputs = frontendBuildInputs(readFileSync(resolve(root, 'Dockerfile'), 'utf8'));
  const htmlEntries: string[] = [];
  const collectEntries = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && node.name.getText() === 'input' && ts.isObjectLiteralExpression(node.initializer)) {
      for (const entry of node.initializer.properties) if (ts.isPropertyAssignment(entry) && ts.isStringLiteralLike(entry.initializer)) htmlEntries.push(entry.initializer.text);
    }
    ts.forEachChild(node, collectEntries);
  };
  collectEntries(parse('vite.config.ts', readFileSync(resolve(root, 'vite.config.ts'), 'utf8')));
  expect(htmlEntries.length).toBeGreaterThan(0);
  const pending: string[] = [], violations: string[] = [], visited = new Set<string>();
  for (const entry of htmlEntries) {
    const html = resolve(root, entry);
    if (!includedInBuild(html, inputs)) violations.push(`${entry}: HTML entrypoint is absent from Docker build inputs`);
    for (const script of readFileSync(html, 'utf8').matchAll(/<script\b[^>]*>/gi)) {
      if (!/\btype\s*=\s*["']module["']/i.test(script[0])) continue;
      const src = script[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
      if (src) pending.push(resolve(src.startsWith('/') ? root : dirname(html), src.replace(/^\//, '')));
    }
  }
  expect(pending.length).toBeGreaterThan(0);
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    if (!includedInBuild(file, inputs)) { violations.push(`${relative(root, file)}: runtime dependency is absent from Docker build inputs`); continue; }
    const text = readFileSync(file, 'utf8');
    const dependencies = extname(file) === '.css'
      ? [...text.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)].map(match => match[1]!)
      : /\.[cm]?[jt]sx?$/.test(file) ? runtimeImports(text) : [];
    for (const specifier of dependencies) {
      if (!specifier.startsWith('.')) continue;
      const base = resolve(dirname(file), specifier.split(/[?#]/)[0]!);
      const target = [base, ...['.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.tsx', '/index.js'].map(suffix => base + suffix)]
        .find(candidate => existsSync(candidate) && statSync(candidate).isFile());
      if (target) pending.push(target);
      else violations.push(`${relative(root, file)} -> ${specifier}: unresolved runtime dependency`);
    }
  }
  expect(violations).toEqual([]);
});

test('the build boundary catches server runtime dependencies but permits erased server type references', () => {
  const imports = runtimeImports(`
    import type { Shape } from '../server/types';
    import { type AnotherShape } from '../server/types';
    export type { Shape } from '../server/types';
    export { type AnotherShape } from '../server/types';
    import { navigate, type Route } from '../server/navigation';
    export { findCover } from '../server/cover';
    import '../server/side-effect';
    const load = () => import('../server/lazy');
  `);
  expect(imports).toEqual(['../server/navigation', '../server/cover', '../server/side-effect', '../server/lazy']);
  const inputs = frontendBuildInputs(readFileSync(resolve(root, 'Dockerfile'), 'utf8'));
  for (const specifier of imports) expect(includedInBuild(resolve(root, 'src', specifier), inputs)).toBe(false);
  expect(includedInBuild(resolve(root, 'src/game/live.ts'), inputs)).toBe(true);
});
