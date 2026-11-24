const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const CSV_FILE = path.join(ROOT, 'Badook-2012026154636-2025-hangashat-meyda-plili.csv');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some(value => value.trim() !== '')) rows.push(row);

  const headers = rows.shift() || [];
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header.trim(), (values[index] || '').trim()])));
}

const buffer = fs.readFileSync(CSV_FILE);
let csvText;
try {
  csvText = new TextDecoder('windows-1255').decode(buffer);
} catch {
  csvText = buffer.toString('utf8');
}
const records = parseCsv(csvText);

function countBy(records, field) {
  const totals = new Map();
  for (const record of records) {
    const key = record[field] || 'ללא שיוך';
    totals.set(key, (totals.get(key) || 0) + 1);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

function summary(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const quarter = url.searchParams.get('quarter');
  const group = url.searchParams.get('group');
  const type = url.searchParams.get('type');
  const search = url.searchParams.get('search');

  let filtered = records;
  if (quarter) filtered = filtered.filter(row => row.Quarter === quarter);
  if (group) filtered = filtered.filter(row => row.StatisticGroup === group);
  if (type) filtered = filtered.filter(row => row.StatisticType === type);
  if (search) {
    const needle = search.toLowerCase();
    filtered = filtered.filter(row =>
      Object.values(row).some(value => value.toLowerCase().includes(needle))
    );
  }

  const uniqueCases = new Set(filtered.map(row => row.FictiveIDNumber).filter(Boolean)).size;
  return {
    incidents: filtered.length,
    uniqueCases,
    settlements: new Set(filtered.map(row => row.Yeshuv).filter(Boolean)).size,
    areas: new Set(filtered.map(row => row.StatisticArea).filter(Boolean)).size,
    districts: countBy(filtered, 'PoliceDistrict'),
    groups: countBy(filtered, 'StatisticGroup'),
    types: countBy(filtered, 'StatisticType'),
    quarters: countBy(filtered, 'Quarter').sort((a, b) => a[0].localeCompare(b[0]))
  };
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(value));
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { status: 'ok', records: records.length });
  }
  if (url.pathname === '/api/summary') {
    return sendJson(res, 200, summary(req));
  }
  if (url.pathname === '/api/cities') {
    return sendJson(res, 200, countBy(records, 'Yeshuv').slice(0, 225).map(([name, count]) => ({ name, count })));
  }
  if (url.pathname === '/api/export') {
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=windows-1255',
      'Content-Disposition': 'attachment; filename="crime-data-2025.csv"'
    });
    const encoder = new TextEncoder();
    return res.end(Buffer.from(csvText, 'utf8'));
  }

  let pathname = url.pathname === '/' ? '/code1.html' : url.pathname;
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500);
      return res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`PolNet 3D running at http://127.0.0.1:${PORT}`);
});
