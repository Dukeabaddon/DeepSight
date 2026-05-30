import assert from 'assert';
import { countFunctionsRegex } from '../dist/analyzer/functionCountStub.js';

const sample = `
export function foo() {}
async function bar() {}
const baz = function() {}
class C {
  method() {}
}
`;

const n = countFunctionsRegex(sample);
assert.ok(n >= 2, `expected >= 2 function entities, got ${n}`);
console.log('functionCountStub regex: ok', n);
