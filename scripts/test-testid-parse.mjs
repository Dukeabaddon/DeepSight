import assert from 'assert';
import { testIdFromSpecTitle } from '../dist/utils/testId.js';
import { parsePlaywrightJsonPayload } from '../dist/utils/artifacts.js';

assert.strictEqual(testIdFromSpecTitle('TC002: Visit /', 99), 'TC002');
assert.strictEqual(testIdFromSpecTitle('DeepSight generated plan TC007 extra', 7), 'TC007');
assert.strictEqual(testIdFromSpecTitle('no id here', 3), 'TC003');

const payload = {
  suites: [
    {
      specs: [
        {
          title: 'TC001: Home',
          tests: [{ results: [{ status: 'passed', duration: 10 }] }],
        },
        {
          title: 'TC002: Checkout',
          tests: [
            {
              results: [
                {
                  status: 'failed',
                  duration: 5,
                  error: { message: 'locator resolved to 0 elements' },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const parsed = parsePlaywrightJsonPayload(payload);
assert.strictEqual(parsed.length, 2);
assert.strictEqual(parsed[0].testId, 'TC001');
assert.strictEqual(parsed[1].testId, 'TC002');
assert.strictEqual(parsed[1].status, 'failed');

console.log('test-testid-parse: ok');
