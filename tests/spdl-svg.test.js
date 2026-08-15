const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSpdlDocument } = require('../spdl-parser.js');
const { renderSvg, renderHtml, streamToSvg, escapeXml } = require('../spdl-svg.js');

const svgOf = (stream, options) => renderSvg(parseSpdlDocument(stream), options);

test('the canvas is sized from the pages and the content', () => {
  const svg = svgOf('16 20 MediaBox\n(hi) Tj');
  // 16x20 cells at 25px, plus a 10px margin on each side.
  assert.match(svg, /width="420" height="520"/);
  assert.match(svg, /viewBox="0 0 420 520"/);
});

test('a custom cell size scales the drawing', () => {
  assert.match(svgOf('4 4 MediaBox', { cellSize: 10 }), /width="60" height="60"/);
});

test('pages are drawn before content so cells sit on top', () => {
  const svg = svgOf('4 4 MediaBox\n0 0 1 rg\n0 0 2 2 re\nf');
  assert.ok(
    svg.indexOf('fill="#ffffff"') < svg.indexOf('fill="#0000ff"'),
    'the page background must come before the filled cells',
  );
});

test('text carries color, size, weight, style and underline', () => {
  const svg = svgOf('1 0 0 rg\n/F2 Tf\n1 Tr\n(styled) Tj');
  assert.match(svg, /<text [^>]*fill="#ff0000"/);
  assert.match(svg, /font-weight="bold"/);
  assert.match(svg, /text-decoration="underline"/);

  const italic = svgOf('/F3 Tf\n(slanted) Tj');
  assert.match(italic, /font-style="italic"/);
});

test('alignment maps onto text-anchor', () => {
  assert.match(svgOf('1 TA\n(mid) Tj'), /text-anchor="middle"/);
  assert.match(svgOf('2 TA\n(end) Tj'), /text-anchor="end"/);
  assert.match(svgOf('(start) Tj'), /text-anchor="start"/);
});

test('rotation is applied about the text origin', () => {
  // SVG rotates clockwise where SPDL rotates counter-clockwise.
  assert.match(svgOf('/Rotate 45\n(turned) Tj'), /transform="rotate\(-45 /);
});

test('links become anchors and notes become tooltips', () => {
  const link = svgOf('(https://example.com) (Click) /Link');
  assert.match(link, /<a href="https:\/\/example\.com" target="_blank"><text/);

  const note = svgOf('(remember) /Note');
  assert.match(note, /<title>remember<\/title>/);
});

test('checkboxes and dropdowns render their visible content', () => {
  assert.match(svgOf('/CheckBox'), /☐/);

  const dropdown = svgOf('(Alpha,Beta) /Dropdown');
  assert.match(dropdown, /fill="#fff2cc"/i);
  assert.match(dropdown, />Alpha</);
});

test('borders use the stroke width and color', () => {
  const svg = svgOf('1 0 0 SC\n2 w\n0 0 2 2 re\nS');
  assert.match(svg, /stroke="#ff0000" stroke-width="2"/);
});

// Horizontal and vertical edge segments in the emitted path data.
const edges = (svg) => ({
  horizontal: (svg.match(/ H /g) || []).length,
  vertical: (svg.match(/ V /g) || []).length,
});

test('a stroked rectangle draws one outline, not a box per cell', () => {
  // A 6x4 outline is 6 cells of top edge, 6 of bottom, and 4 down each side.
  // Drawing all four edges of all 20 perimeter cells would be 40 of each.
  assert.deepEqual(edges(svgOf('1 1 6 4 re\nS')), { horizontal: 12, vertical: 8 });
});

test('the inside of a stroked ring is not outlined', () => {
  // The middle row faces enclosed cells, so its inner edges are dropped and
  // only the ring's own outline remains.
  assert.deepEqual(edges(svgOf('1 1 3 3 re\nS')), { horizontal: 6, vertical: 6 });
});

test('two separate rectangles keep the edges that face each other', () => {
  const alone = edges(svgOf('1 1 3 3 re\nS'));
  const together = edges(svgOf('1 1 3 3 re\nS\n9 1 3 3 re\nS'));

  assert.deepEqual(together, {
    horizontal: alone.horizontal * 2,
    vertical: alone.vertical * 2,
  }, 'neither outline is eaten by the other');
});

test('images are outlined rather than fetched', () => {
  const svg = svgOf('80 60 (https://example.com/logo.png) /InsertImage');
  assert.match(svg, /<title>https:\/\/example\.com\/logo\.png<\/title>/);
  assert.match(svg, /width="80" height="60"/);
  assert.doesNotMatch(svg, /<image/, 'the exporter must not fetch remote images');
});

test('text content is XML-escaped, not injected', () => {
  const svg = svgOf('(<script>alert\\(1\\)</script> & "quotes") Tj');
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /&amp;/);

  assert.equal(escapeXml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('a link URL cannot break out of the href attribute', () => {
  const svg = svgOf('(https://example.com/"onclick="evil\\(\\)) (label) /Link');
  // The quotes are entity-escaped, so the URL stays inside the attribute
  // instead of closing it and starting an event handler.
  assert.doesNotMatch(svg, /href="[^"]*"\s*onclick/);
  assert.match(svg, /href="[^"]*&quot;onclick=&quot;[^"]*"/);
});

test('an empty stream still produces a valid document', () => {
  const svg = svgOf('');
  assert.match(svg, /^<svg xmlns=/);
  assert.match(svg, /<\/svg>$/);
});

test('the canvas never grows past the sheet bounds', () => {
  // 1000 rows x 26 columns at 25px, plus margins.
  const svg = svgOf('/MoveTo 999 9999\n(far away) Tj', {});
  assert.match(svg, /width="670" height="25020"/);
});

test('renderHtml wraps the SVG in a titled page', () => {
  const html = renderHtml(parseSpdlDocument('4 4 MediaBox'), { title: 'Invoice 42' });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Invoice 42<\/title>/);
  assert.match(html, /<svg /);
});

test('streamToSvg is the one-step form', () => {
  assert.equal(streamToSvg('4 4 MediaBox'), svgOf('4 4 MediaBox'));
});
