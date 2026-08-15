/**
 * Cross-renderer conformance: every renderer that can be driven from Node is
 * run over the same fixtures and compared against the reference parser.
 *
 * The claim SPDL makes is that a stream is portable. This is the test that
 * makes it a guarantee rather than a convention.
 */
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { parseSpdlDocument } = require('../spdl-parser.js');
const { canonicalizeReference, assertConforms, assertRenderersAgree } = require('./helpers/canonical.js');
const { renderWithAppsScript } = require('./helpers/gs-adapter.js');
const officeAdapter = require('./helpers/office-adapter.js');
// The reference's page fills live outside the record list, so both are
// needed to reconstruct the grid the renderers produce.
const documentOf = (stream) => {
  const { records, pages } = parseSpdlDocument(stream);
  return [records, pages];
};

const { fixtures, commandsOf, streamOf } = require('./conformance/fixtures.js');

const examplesDir = path.join(__dirname, '..', 'examples');
const exampleCases = fs.readdirSync(examplesDir)
  .filter((file) => file.endsWith('.spdl'))
  .map((file) => ({
    name: `example: ${file}`,
    stream: fs.readFileSync(path.join(examplesDir, file), 'utf8'),
  }));

const cases = [
  ...fixtures.map((fixture) => ({ name: fixture.name, stream: streamOf(fixture), commands: commandsOf(fixture) })),
  ...exampleCases.map((example) => ({
    name: example.name,
    stream: example.stream,
    commands: example.stream.split(/\r?\n/).filter((line) => line.trim().length > 0),
  })),
];

const skipOffice = officeAdapter.isAvailable()
  ? false
  : 'install the optional `typescript` devDependency to run the Office Scripts harness';

for (const testCase of cases) {
  const reference = canonicalizeReference(...documentOf(testCase.stream));

  test(`Apps Script conforms: ${testCase.name}`, () => {
    assertConforms(reference, renderWithAppsScript(testCase.commands), testCase.name);
  });

  test(`Office Scripts conforms: ${testCase.name}`, { skip: skipOffice }, () => {
    assertConforms(reference, officeAdapter.renderWithOfficeScripts(testCase.commands), testCase.name);
  });

  test(`Apps Script and Office Scripts agree: ${testCase.name}`, { skip: skipOffice }, () => {
    assertRenderersAgree(
      reference,
      renderWithAppsScript(testCase.commands),
      officeAdapter.renderWithOfficeScripts(testCase.commands),
      testCase.name,
    );
  });
}
