/* ==========================================================
   LECTOR DE TABLAS  (LK.csv)
   Lee CSV (Goodreads, Excel guardado como CSV…) y XLSX (el Excel
   que exporta Bookmory) sin librerías: un .xlsx es un ZIP con XML
   dentro, y el navegador ya sabe descomprimirlo (DecompressionStream).
   Devuelve siempre { headers: [..], rows: [{cabecera: valor}] }.
   ========================================================== */

(function (LK) {
  'use strict';

  /* ---------------- CSV ---------------- */

  /** Detecta el separador mirando la primera línea (fuera de comillas). */
  function detectDelimiter(text) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (const ch of first) {
      if (ch === '"') q = !q;
      else if (!q && ch in counts) counts[ch]++;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  /** CSV → matriz de celdas (admite comillas, saltos de línea dentro de comillas y "" escapadas). */
  function parseMatrix(text, delim) {
    text = text.replace(/^﻿/, '');
    const rows = [];
    let row = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else q = false;
        } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  /** Matriz → { headers, rows[objeto] }. Cabeceras repetidas o vacías se renombran. */
  function toTable(matrix) {
    if (!matrix.length) return { headers: [], rows: [] };
    const seen = new Map();
    const headers = matrix[0].map((h, i) => {
      let name = String(h ?? '').trim() || `Columna ${i + 1}`;
      const n = (seen.get(name) || 0) + 1;
      seen.set(name, n);
      return n > 1 ? `${name} (${n})` : name;
    });
    const rows = matrix.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
    return { headers, rows };
  }

  function parseCSV(text) {
    return toTable(parseMatrix(text, detectDelimiter(text)));
  }

  /* ---------------- XLSX ---------------- */

  const td = new TextDecoder('utf-8');

  /** Lista las entradas de un ZIP leyendo su directorio central. */
  function zipEntries(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('No parece un archivo Excel (.xlsx) válido.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const offset = dv.getUint32(p + 42, true);
      const name = td.decode(new Uint8Array(buf, p + 46, nameLen));
      entries.set(name, { method, csize, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function zipRead(buf, entry) {
    const dv = new DataView(buf);
    const nameLen = dv.getUint16(entry.offset + 26, true);
    const extraLen = dv.getUint16(entry.offset + 28, true);
    const start = entry.offset + 30 + nameLen + extraLen;
    const data = new Uint8Array(buf, start, entry.csize);
    if (entry.method === 0) return td.decode(data);
    if (entry.method !== 8) throw new Error('Este Excel usa una compresión no compatible.');
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede abrir .xlsx. Guarda el Excel como CSV e impórtalo.');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return td.decode(await new Response(stream).arrayBuffer());
  }

  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');

  /** "C12" → 2 (índice de columna) */
  function colIndex(ref) {
    let n = 0;
    for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  async function parseXLSX(buf) {
    const entries = zipEntries(buf);
    const read = async (name) => (entries.has(name) ? zipRead(buf, entries.get(name)) : null);

    // Textos compartidos
    const shared = [];
    const ssXml = await read('xl/sharedStrings.xml');
    if (ssXml) {
      for (const si of xml(ssXml).getElementsByTagName('si')) {
        shared.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
      }
    }

    // Primera hoja según workbook.xml
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = await read('xl/workbook.xml');
    const rels = await read('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const first = xml(wb).getElementsByTagName('sheet')[0];
      const rid = first?.getAttribute('r:id') || first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const rel = [...xml(rels).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
      if (rel) sheetPath = 'xl/' + rel.getAttribute('Target').replace(/^\/?(xl\/)?/, '');
    }
    const sheet = await read(sheetPath);
    if (!sheet) throw new Error('No se encontró ninguna hoja en el Excel.');

    const matrix = [];
    for (const r of xml(sheet).getElementsByTagName('row')) {
      const line = [];
      for (const c of r.getElementsByTagName('c')) {
        const idx = colIndex(c.getAttribute('r') || 'A1');
        const t = c.getAttribute('t');
        let val = '';
        if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
        else {
          const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
          val = t === 's' ? shared[Number(v)] ?? '' : v;
        }
        line[idx] = val;
      }
      for (let i = 0; i < line.length; i++) if (line[i] === undefined) line[i] = '';
      matrix.push(line);
    }
    return toTable(matrix.filter((r) => r.some((c) => String(c).trim() !== '')));
  }

  /* ---------------- Entrada común ---------------- */

  /** Lee un File (.csv, .tsv, .txt o .xlsx) y devuelve { headers, rows, kind }. */
  async function parseFile(file) {
    const name = file.name.toLowerCase();
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf, 0, 4);
    const isZip = head[0] === 0x50 && head[1] === 0x4b;
    if (isZip || name.endsWith('.xlsx')) return { ...(await parseXLSX(buf)), kind: 'xlsx' };
    if (name.endsWith('.xls')) throw new Error('Los .xls antiguos no se pueden leer. Ábrelo en Excel y guárdalo como .xlsx o CSV.');
    return { ...parseCSV(td.decode(buf)), kind: 'csv' };
  }

  LK.csv = { parseCSV, parseXLSX, parseFile };
})(window.LK);
