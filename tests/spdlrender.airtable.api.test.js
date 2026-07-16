const test = require('node:test');
const assert = require('node:assert/strict');

const { clearTable, syncRecords } = require('../spdlrender.airtable.js');

const config = {
  apiToken: 'pat-test',
  baseId: 'app-test',
  renderTable: '02_Rendered_View',
};

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test('clearTable re-fetches the first page after deleting instead of paginating', async (t) => {
  let ids = Array.from({ length: 25 }, (_, i) => `rec${i}`);
  const requests = [];

  global.fetch = t.mock.fn(async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' });
    if ((options.method || 'GET') === 'GET') {
      assert.ok(!url.includes('offset='), 'must not paginate with a stale offset cursor');
      return jsonResponse({ records: ids.slice(0, 100).map((id) => ({ id })) });
    }
    assert.equal(options.method, 'DELETE');
    const deleted = [...url.matchAll(/records%5B%5D=(rec\d+)|records\[\]=(rec\d+)/g)]
      .map((m) => m[1] || m[2]);
    assert.ok(deleted.length >= 1 && deleted.length <= 10, 'deletes at most 10 records per request');
    ids = ids.filter((id) => !deleted.includes(id));
    return jsonResponse({ records: deleted.map((id) => ({ id, deleted: true })) });
  });
  t.after(() => { delete global.fetch; });

  await clearTable(config, config.renderTable);

  assert.equal(ids.length, 0, 'all records deleted');
  const deletes = requests.filter((r) => r.method === 'DELETE');
  assert.equal(deletes.length, 3); // 25 records in chunks of 10
});

test('syncRecords clamps the batch size to Airtable\'s 10-record limit', async (t) => {
  const batchSizes = [];
  global.fetch = t.mock.fn(async (url, options) => {
    batchSizes.push(JSON.parse(options.body).records.length);
    return jsonResponse({ records: [] });
  });
  t.after(() => { delete global.fetch; });

  const records = Array.from({ length: 25 }, (_, i) => ({ fields: { Row: 1, Col: i + 1 } }));
  await syncRecords({ ...config, batchSize: 50 }, records);

  assert.deepEqual(batchSizes, [10, 10, 5]);
});

test('requests retry on 429, honoring Retry-After', async (t) => {
  let calls = 0;
  global.fetch = t.mock.fn(async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({ error: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '0.01' } });
    }
    return jsonResponse({ records: [] });
  });
  t.after(() => { delete global.fetch; });

  await syncRecords(config, [{ fields: { Row: 1, Col: 1 } }]);

  assert.equal(calls, 2, 'first attempt rate limited, second succeeds');
});
