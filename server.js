const http = require('http');
const https = require('https');
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

function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > limit) {
        tooLarge = true;
      }
    });
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('Request body is too large');
        error.statusCode = 413;
        return reject(error);
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error('Request body must be valid JSON');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function requestGemini(contents, apiKey) {
  const model = 'gemini-3.5-flash-lite';
  const endpoint = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
  endpoint.searchParams.set('key', apiKey);
  const payload = JSON.stringify({
    systemInstruction: {
      parts: [{ text: 'ענה בעברית ברורה ומדויקת. אם אינך יודע, אמור זאת במפורש.' }]
    },
    contents,
    generationConfig: {
      thinkingConfig: { thinkingLevel: 'MINIMAL' }
    }
  });

  return new Promise((resolve, reject) => {
    const request = https.request(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => {
        let result;
        try {
          result = JSON.parse(responseBody);
        } catch {
          return reject(new Error('Google returned an invalid response'));
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(result.error && result.error.message ? result.error.message : 'Google request failed'));
        }
        const reply = result.candidates && result.candidates[0] &&
          result.candidates[0].content && result.candidates[0].content.parts
          ? result.candidates[0].content.parts.map(part => part.text || '').join('').trim()
          : '';
        if (!reply) return reject(new Error('Google returned an empty response'));
        resolve(reply);
      });
    });
    request.on('error', reject);
    request.setTimeout(60000, () => request.destroy(new Error('Google request timed out')));
    request.end(payload);
  });
}

async function handleChat(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  if (!process.env.GEMINI_API_KEY) {
    return sendJson(res, 503, { error: 'יש להגדיר GEMINI_API_KEY בסביבת השרת.' });
  }

  let body;
  try {
    body = await readJsonBody(req, 65536);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message });
  }

  if (!body || !Array.isArray(body.contents) || body.contents.length < 1 || body.contents.length > 24) {
    return sendJson(res, 400, { error: 'היסטוריית השיחה אינה תקינה.' });
  }
  let totalCharacters = 0;
  for (const message of body.contents) {
    const text = message && message.parts && message.parts[0] && message.parts[0].text;
    if (!message || !['user', 'model'].includes(message.role) || typeof text !== 'string' || text.trim().length === 0 || text.length > 5000) {
      return sendJson(res, 400, { error: 'הודעת צ׳אט אינה תקינה.' });
    }
    totalCharacters += text.length;
  }
  if (totalCharacters > 24000 || body.contents[body.contents.length - 1].role !== 'user') {
    return sendJson(res, 400, { error: 'היסטוריית השיחה חורגת מהמגבלה.' });
  }

  try {
    const reply = await requestGemini(body.contents, process.env.GEMINI_API_KEY);
    return sendJson(res, 200, { reply });
  } catch (error) {
    console.error('Gemini chat request failed:', error.message);
    return sendJson(res, 502, { error: `שגיאה בקבלת תשובה מ-Gemini: ${error.message}` });
  }
}

async function handleSuspiciousPoint(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  if (!process.env.MAKE_WEBHOOK_URL) {
    return sendJson(res, 503, { error: 'יש להגדיר MAKE_WEBHOOK_URL בסביבת השרת.' });
  }

  let body;
  try {
    body = await readJsonBody(req, 4096);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message });
  }

  if (!body || Object.keys(body).length !== 1 || typeof body.city !== 'string' ||
      !body.city.trim() || body.city.trim().length > 300) {
    return sendJson(res, 400, { error: 'יש להזין מיקום אחד בלבד, עד 300 תווים.' });
  }

  let endpoint;
  try {
    endpoint = new URL(process.env.MAKE_WEBHOOK_URL);
    if (endpoint.protocol !== 'https:') throw new Error('HTTPS required');
  } catch {
    return sendJson(res, 503, { error: 'כתובת ה-Webhook של Make אינה תקינה.' });
  }

  const payload = JSON.stringify({ city: body.city.trim() });
  try {
    await new Promise((resolve, reject) => {
      const request = https.request(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, response => {
        response.resume();
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            return reject(new Error('Make webhook rejected the location'));
          }
          resolve();
        });
      });
      request.on('error', reject);
      request.setTimeout(10000, () => request.destroy(new Error('Make webhook timed out')));
      request.end(payload);
    });
    return sendJson(res, 200, { ok: true });
  } catch {
    return sendJson(res, 502, { error: 'לא ניתן לשלוח את המיקום ל-Make כרגע.' });
  }
}

function decodeUtf8ByteList(text) {
  if (!/^\s*(?:\d{1,3}\s+){3,}\d{1,3}\s*$/.test(text)) return text;
  const bytes = text.trim().split(/\s+/).map(Number);
  if (bytes.some(value => value > 255)) return text;

  for (const candidate of [bytes, [...bytes].reverse()]) {
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(candidate));
      if (/[\u0590-\u05FF]/.test(decoded)) return decoded;
    } catch {
      continue;
    }
  }
  return text;
}

function getMakeReply(responseBody) {
  const rawReply = responseBody.trim();
  if (!rawReply) return '';
  let reply = rawReply;
  try {
    const result = JSON.parse(rawReply);
    if (typeof result === 'string') reply = result.trim();
    if (result && typeof result === 'object') {
      for (const key of ['reply', 'response', 'answer', 'message']) {
        if (typeof result[key] === 'string') {
          reply = result[key].trim();
          break;
        }
      }
    }
  } catch {
    reply = rawReply;
  }
  return decodeUtf8ByteList(reply);
}

async function handleRecipes(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  if (!process.env.MAKE_RECIPES_WEBHOOK_URL) {
    return sendJson(res, 503, { error: 'יש להגדיר MAKE_RECIPES_WEBHOOK_URL בסביבת השרת.' });
  }

  let body;
  try {
    body = await readJsonBody(req, 4096);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message });
  }

  if (!body || Object.keys(body).length !== 1 || typeof body.chefs !== 'string' ||
      !body.chefs.trim() || body.chefs.trim().length > 300) {
    return sendJson(res, 400, { error: 'יש להזין שמות שפים בלבד, עד 300 תווים.' });
  }

  let endpoint;
  try {
    endpoint = new URL(process.env.MAKE_RECIPES_WEBHOOK_URL);
    if (endpoint.protocol !== 'https:') throw new Error('HTTPS required');
  } catch {
    return sendJson(res, 503, { error: 'כתובת ה-Webhook של המתכונים אינה תקינה.' });
  }

  const payload = JSON.stringify({ chefs: body.chefs.trim() });
  try {
    const responseBody = await new Promise((resolve, reject) => {
      const request = https.request(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, response => {
        let responseText = '';
        response.on('data', chunk => {
          responseText += chunk;
          if (Buffer.byteLength(responseText, 'utf8') > 65536) {
            response.destroy(new Error('Make response is too large'));
          }
        });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            return reject(new Error('Make webhook rejected the recipe request'));
          }
          resolve(responseText);
        });
        response.on('error', reject);
      });
      request.on('error', reject);
      request.setTimeout(60000, () => request.destroy(new Error('Make webhook timed out')));
      request.end(payload);
    });
    const reply = getMakeReply(responseBody);
    if (!reply) return sendJson(res, 502, { error: 'Make לא החזיר תשובה.' });
    return sendJson(res, 200, { reply });
  } catch {
    return sendJson(res, 502, { error: 'לא ניתן לקבל תשובה מ-Make כרגע.' });
  }
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
  if (url.pathname === '/api/chat') {
    return handleChat(req, res);
  }
  if (url.pathname === '/api/suspicious-point') {
    return handleSuspiciousPoint(req, res);
  }
  if (url.pathname === '/api/recipes') {
    return handleRecipes(req, res);
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
    const extension = path.extname(filePath);
    const responseData = extension === '.html'
      ? data.toString('utf8').replace(/<\/body>/i, '<script src="/chat-widget.js" defer></script></body>')
      : data;
    res.writeHead(200, { 'Content-Type': mimeTypes[extension] || 'application/octet-stream' });
    res.end(responseData);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`PolNet 3D running at http://127.0.0.1:${PORT}`);
});
