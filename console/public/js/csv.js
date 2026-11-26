// Reads comma-separated text: quoted fields, doubled quotes inside them, and
// either kind of line ending. Lines starting with # are comments.
// Returns a list of objects keyed by the header row.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text).replace(/^﻿/, '');

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0].trim() !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === ',') {
      endField();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      endRow();
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) endRow();

  const data = rows.filter((r) => !r[0].trim().startsWith('#'));
  if (data.length < 2) return { headers: data[0] || [], records: [] };
  const headers = data[0].map((h) => h.trim());
  const records = data.slice(1).map((r) => {
    const record = {};
    headers.forEach((h, i) => {
      record[h] = (r[i] || '').trim();
    });
    return record;
  });
  return { headers, records };
}
