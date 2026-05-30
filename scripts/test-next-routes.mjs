import assert from 'assert';
import { appSegmentToUrlPart, dirnameToNextRoute } from '../dist/utils/nextAppRouter.js';

assert.strictEqual(appSegmentToUrlPart('(marketing)'), null);
assert.strictEqual(appSegmentToUrlPart('@modal'), null);
assert.strictEqual(appSegmentToUrlPart('about'), 'about');

assert.strictEqual(dirnameToNextRoute(''), '/');
assert.strictEqual(dirnameToNextRoute('settings'), '/settings');
assert.strictEqual(dirnameToNextRoute('(shop)/products/[id]'), '/products/[id]');
assert.strictEqual(dirnameToNextRoute('blog/[slug]'), '/blog/[slug]');

console.log('nextAppRouter: ok');
