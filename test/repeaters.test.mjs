import test from 'node:test';
import assert from 'node:assert/strict';
import { importRepeaters, fromHere } from '../console/public/js/repeaters.js';
import { parseCsv } from '../console/public/js/csv.js';

const tones = [670, 744, 885, 1000, 1230, 1413];
const bands = [
  { start: 144e6, end: 148e6 },
  { start: 420e6, end: 450e6 },
];
const find = (list, name) => list.find((r) => r.name === name);

const CHIRP = `Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,DtcsPolarity,RxDtcsCode,CrossMode,Mode,TStep,Skip,Power,Comment,URCALL,RPT1CALL,RPT2CALL,DVCODE
0,HILLTOP,146.940000,-,0.600000,Tone,100.0,100.0,023,NN,023,Tone->Tone,FM,5.00,,50W,"Testville, hilltop",,,,
1,DOWNTOWN,147.120000,+,0.600000,TSQL,88.5,123.0,023,NN,023,Tone->Tone,FM,5.00,,50W,Demo City,,,,
2,SIMPLEX,146.520000,,0.600000,,88.5,88.5,023,NN,023,Tone->Tone,FM,5.00,,50W,Calling,,,,
3,DMR1,442.100000,+,5.000000,,88.5,88.5,023,NN,023,Tone->Tone,DMR,5.00,,50W,Digital only,,,,
4,RIDGE,145.230000,-,0.600000,DTCS,88.5,88.5,023,NN,023,Tone->Tone,FM,5.00,,50W,Uses DCS,,,,
5,DSTAR,145.610000,-,0.600000,,88.5,88.5,023,NN,023,Tone->Tone,DV,5.00,,50W,D-STAR,,,,
6,HF,28.400000,,0.000000,,88.5,88.5,023,NN,023,Tone->Tone,USB,5.00,,50W,Ten meters,,,,
7,HILLTOP,146.940000,-,0.600000,Tone,100.0,100.0,023,NN,023,Tone->Tone,FM,5.00,,50W,again,,,,
`;

test('a CHIRP file', () => {
  const { repeaters, skipped, total } = importRepeaters(CHIRP, { tones, bands });
  assert.equal(total, 8);
  assert.deepEqual(repeaters.map((r) => r.name), ['HILLTOP', 'DOWNTOWN', 'SIMPLEX', 'RIDGE', 'DSTAR']);
  assert.deepEqual(find(repeaters, 'HILLTOP'), { name: 'HILLTOP', freq: 146940000, mode: 'FM', duplex: 'DUP-', offset: 600000, toneMode: 'TONE', tone: 1000, place: 'Testville, hilltop' });
  // Tone squelch takes its tone from the other column.
  assert.equal(find(repeaters, 'DOWNTOWN').toneMode, 'TSQL');
  assert.equal(find(repeaters, 'DOWNTOWN').tone, 1230);
  // A blank Duplex means simplex, whatever the Offset column holds, and a
  // blank Tone means none, whatever the tone columns hold.
  assert.equal(find(repeaters, 'SIMPLEX').duplex, 'OFF');
  assert.equal(find(repeaters, 'SIMPLEX').toneMode, 'OFF');
  assert.ok(find(repeaters, 'RIDGE').note.includes('DCS'));
  assert.equal(find(repeaters, 'DSTAR').mode, 'DV');
  assert.equal(skipped.length, 3);
});

const REPEATERBOOK = `Callsign,"Frequency (MHz)","Input Frequency (MHz)","Offset (MHz)",Tone,City,County,State,Country,Landmark,Latitude,Longitude,"FM (analog)",DMR,"D-STAR Node","PL Tone","TSQ Tone"
NORTH,147.045000,147.645000,0.6,CSQ,Northtown,Example,ZZ,US,,41.6000,-71.6000,Yes,No,,,
HARBOR,146.760000,146.160000,-0.6,67.0,"Smith's Hill, North",Example,ZZ,US,,41.9,-71.5,Yes,No,,67.0,67.0
DIGI,449.325000,444.325000,-5.0,CSQ,Midtown,Example,ZZ,US,,41.78,-71.44,No,Yes,,,
AIRPORT,145.150000,144.550000,-0.6,CSQ,Airfield,Example,ZZ,US,,41.92,-71.43,No,No,AIRPORT C,,
`;

test('a RepeaterBook file', () => {
  const { repeaters, skipped } = importRepeaters(REPEATERBOOK, { tones, bands });
  assert.deepEqual(repeaters.map((r) => r.name), ['NORTH', 'HARBOR', 'AIRPORT']);
  const hdn = find(repeaters, 'NORTH');
  assert.equal(hdn.duplex, 'DUP+');
  assert.equal(hdn.offset, 600000);
  assert.equal(hdn.toneMode, 'OFF'); // CSQ: carrier squelch, no tone
  assert.equal(hdn.place, 'Northtown, ZZ');
  assert.equal(hdn.lat, 41.6);
  const abc = find(repeaters, 'HARBOR');
  assert.equal(abc.duplex, 'DUP-');
  assert.equal(abc.toneMode, 'TONE');
  assert.equal(abc.tone, 670);
  assert.equal(abc.place, "Smith's Hill, North, ZZ"); // a quoted comma
  assert.equal(find(repeaters, 'AIRPORT').mode, 'DV');
  assert.equal(skipped[0][1], 1); // the DMR-only one
});

test('a file that is not a repeater list says so', () => {
  assert.match(importRepeaters('a,b\n1,2\n', { tones, bands }).error, /Frequency/);
});

test('CSV: quotes, doubled quotes, comments, a byte-order mark, CRLF', () => {
  const { headers, records } = parseCsv('﻿a,b\r\n# a comment\r\n"x, y","he said ""hi"""\r\n1,\r\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(records, [
    { a: 'x, y', b: 'he said "hi"' },
    { a: '1', b: '' },
  ]);
});

test('distance and direction', () => {
  const { km, bearing } = fromHere({ lat: 41.82, lon: -71.41 }, { lat: 42.36, lon: -71.06 });
  assert.ok(Math.abs(km - 66.6) < 0.5);
  assert.ok(Math.abs(bearing - 25.6) < 0.5);
});
