/* Throwaway sanity test for normalizeSchema — run via esbuild + node.
   Not part of the tsc build (tsconfig only includes ./src). */
import { normalizeSchema, makeDefaultSchema, validateTheme } from '../src/normalize';
import { BUILTIN_THEMES } from '../src/themes';
import REGISTRY from '../src/registry';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('  ✗ ' + msg); failures++; }
  else console.log('  ✓ ' + msg);
}

// 1. Sparse schema → header settings backfilled from the registry.
const sparse = {
  version: '2.0',
  pages: { index: { sections: [{ id: 'h', type: 'header', settings: { storeName: 'Acme' } }] } },
};
const n1 = normalizeSchema(sparse);
const hdr = n1.pages.index.sections[0];
assert(hdr.settings.storeName === 'Acme', 'authored setting wins (storeName=Acme)');
assert('showCartIcon' in hdr.settings, 'registry default backfilled (showCartIcon present)');
assert(!!hdr.layout && typeof hdr.layout.width === 'string', 'layout filled to full SectionLayout');
assert(n1.globalTheme && !!n1.globalTheme.colors.primary, 'globalTheme backfilled from default');

// 2. Unknown section type is dropped; unknown block type is dropped.
const junk = {
  pages: { index: { sections: [
    { id: 'x', type: 'not-a-real-section' },
    { id: 'g', type: 'gallery', blocks: [
      { id: 'b1', type: 'gallery-image', settings: { url: 'a.jpg' } },
      { id: 'b2', type: 'bogus-block' },
    ] },
  ] } },
};
const n2 = normalizeSchema(junk);
assert(n2.pages.index.sections.length === 1, 'unknown section type dropped');
assert(n2.pages.index.sections[0].blocks.length === 1, 'unknown block type dropped');
assert(n2.pages.index.sections[0].blocks[0].settings.url === 'a.jpg', 'kept block settings backfilled');

// 3. Empty / garbage input → at least one page, valid theme.
const n3 = normalizeSchema(null);
assert(Object.keys(n3.pages).length >= 1, 'null input yields a page');
assert(!!n3.globalTheme.typography.headingFont, 'null input yields a theme');

// 4. Idempotency.
const once = normalizeSchema(sparse);
const twice = normalizeSchema(once);
assert(JSON.stringify(once) === JSON.stringify(twice), 'normalize is idempotent');

// 5. makeDefaultSchema is registry-conformant and normalize is idempotent on it.
const def = makeDefaultSchema();
assert(def.pages.index.sections.length === 9, 'default schema has 9 seed sections');
const dn1 = normalizeSchema(def);
const dn2 = normalizeSchema(dn1);
assert(JSON.stringify(dn1) === JSON.stringify(dn2), 'normalize is idempotent on the default schema');

// 6. Every built-in theme validates and only uses known section types.
for (const t of BUILTIN_THEMES) {
  const v = validateTheme(t);
  assert(v.ok, `theme "${t.id}" validates (${v.errors.join(', ')})`);
  const types = t.schema.pages.index.sections.map(s => s.type);
  assert(types.every(ty => ty in REGISTRY), `theme "${t.id}" uses only registry section types`);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
