import { test } from 'node:test';
import assert from 'node:assert';

// Test unitaire de la fonction walkAndDiff (logique pure, pas Playwright)
function walkAndDiff(
  desktopNode: any,
  otherNode: any,
  target: { rules: string[] },
  applyVarMap: (v: string) => string = (v) => v
) {
  if (!desktopNode || !otherNode) return;
  const dStyles = desktopNode.styles || {};
  const oStyles = otherNode.styles || {};
  const changed: Record<string, string> = {};
  const allKeys = new Set([...Object.keys(dStyles), ...Object.keys(oStyles)]);
  for (const k of allKeys) {
    if (dStyles[k] !== oStyles[k] && oStyles[k] !== undefined) {
      changed[k] = applyVarMap(oStyles[k]);
    }
  }
  const className = desktopNode.classes?.[0];
  if (className && Object.keys(changed).length > 0) {
    const props = Object.entries(changed).map(([p, v]) => `    ${p}: ${v};`).join('\n');
    target.rules.push(`  .${className} {\n${props}\n  }`);
  }
  const dChildren = desktopNode.children || [];
  const oChildren = otherNode.children || [];
  for (let i = 0; i < Math.min(dChildren.length, oChildren.length); i++) {
    walkAndDiff(dChildren[i], oChildren[i], target, applyVarMap);
  }
}

test('walkAndDiff retourne vide pour styles identiques', () => {
  const desktop = { classes: ['hero'], styles: { 'font-size': '48px' }, children: [] as any[] };
  const mobile = { classes: ['hero'], styles: { 'font-size': '48px' }, children: [] as any[] };
  const target: { rules: string[] } = { rules: [] };
  walkAndDiff(desktop, mobile, target);
  assert.strictEqual(target.rules.length, 0);
});

test('walkAndDiff émet les props qui changent', () => {
  const desktop = { classes: ['hero'], styles: { 'font-size': '48px', 'color': 'red' }, children: [] as any[] };
  const mobile = { classes: ['hero'], styles: { 'font-size': '24px', 'color': 'red' }, children: [] as any[] };
  const target: { rules: string[] } = { rules: [] };
  walkAndDiff(desktop, mobile, target);
  assert.strictEqual(target.rules.length, 1);
  assert.ok(target.rules[0].includes('font-size: 24px'));
  assert.ok(!target.rules[0].includes('color:'), 'color is unchanged — should not emit');
});

test('walkAndDiff descend récursivement dans les enfants', () => {
  const desktop = {
    classes: ['parent'],
    styles: {},
    children: [{ classes: ['child'], styles: { 'padding': '32px' }, children: [] as any[] }],
  };
  const mobile = {
    classes: ['parent'],
    styles: {},
    children: [{ classes: ['child'], styles: { 'padding': '16px' }, children: [] as any[] }],
  };
  const target: { rules: string[] } = { rules: [] };
  walkAndDiff(desktop, mobile, target);
  assert.strictEqual(target.rules.length, 1);
  assert.ok(target.rules[0].includes('.child'));
  assert.ok(target.rules[0].includes('padding: 16px'));
});
