const test = require('node:test');
const assert = require('node:assert/strict');

const { applyEnvOverrides } = require('../spdlrender.airtable.js');

test('apiToken falls back to AIRTABLE_API_TOKEN', () => {
  const config = applyEnvOverrides(
    { baseId: 'app1', renderTable: 'view' },
    { AIRTABLE_API_TOKEN: 'pat-env' },
  );
  assert.equal(config.apiToken, 'pat-env');
});

test('apiToken falls back to AIRTABLE_API_KEY when AIRTABLE_API_TOKEN is unset', () => {
  const config = applyEnvOverrides(
    { baseId: 'app1', renderTable: 'view' },
    { AIRTABLE_API_KEY: 'pat-key' },
  );
  assert.equal(config.apiToken, 'pat-key');
});

test('config file apiToken wins over the environment', () => {
  const config = applyEnvOverrides(
    { apiToken: 'pat-file', baseId: 'app1', renderTable: 'view' },
    { AIRTABLE_API_TOKEN: 'pat-env' },
  );
  assert.equal(config.apiToken, 'pat-file');
});

test('apiToken stays unset without config value or environment', () => {
  const config = applyEnvOverrides({ baseId: 'app1', renderTable: 'view' }, {});
  assert.equal(config.apiToken, undefined);
});
