import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pages = ['index.html', 'checkout.html', 'obrigado.html', 'leads.html'];

test('inline scripts compile', () => {
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    scripts.forEach((match, index) => {
      assert.doesNotThrow(() => new Function(match[1]), `${page} script ${index + 1}`);
    });
  }
});

test('checkout renders external payment data without innerHTML', () => {
  const checkout = fs.readFileSync('checkout.html', 'utf8');
  assert.doesNotMatch(checkout, /\binnerHTML\b/);
  assert.doesNotMatch(checkout, /\bonclick\s*=/i);
  assert.match(checkout, /renderPixFeedback/);
});

test('optimized hero and regulatory identifiers are published', () => {
  const index = fs.readFileSync('index.html', 'utf8');
  assert.match(index, /bottle-480\.webp/);
  assert.match(index, /fetchpriority="high"/);
  assert.match(index, /25351117215202576/);
  assert.match(index, /20099142/);
  assert.doesNotMatch(index, /cdn\.utmify\.com\.br\/scripts\/pixel\/pixel\.js/);
});

test('legal pages and automated Pix workflow exist', () => {
  for (const file of [
    'politica-de-privacidade.html',
    'termos-de-compra.html',
    'trocas-devolucoes.html',
    '.github/workflows/pix-recovery.yml',
  ]) {
    assert.equal(fs.existsSync(file), true, file);
  }
});

