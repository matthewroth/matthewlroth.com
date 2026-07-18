// Your Voice — zero-dependency Node server (Node 18+)
// Serves the frontend and exposes /api/research which:
//   1. Parses a bill number and researches it (GovTrack, keyless; Congress.gov summary if CONGRESS_API_KEY is set)
//   2. Resolves a zip code to the user's representatives
//      (Zippopotam -> Census geocoder -> unitedstates/congress-legislators dataset)
//   3. For state legislatures, uses OpenStates v3 (requires free OPENSTATES_API_KEY)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY || '';
const OPENSTATES_API_KEY = process.env.OPENSTATES_API_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia', PR: 'Puerto Rico',
};

// ---------- helpers ----------

async function fetchJSON(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Congress number for a given date (new congress begins Jan 3 of odd years)
function currentCongress(date = new Date()) {
  let year = date.getFullYear();
  if (year % 2 === 1 && date.getMonth() === 0 && date.getDate() < 3) year -= 1;
  return Math.floor((year - 1789) / 2) + 1;
}

// Parse things like "S. 4985", "H.R. 1234", "hres 24", "S.J.Res. 5", "SB 12", "HB 123"
function parseBillNumber(raw) {
  const s = String(raw || '').toUpperCase().replace(/[.\s]+/g, '');
  const m = s.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  const prefix = m[1];
  const number = parseInt(m[2], 10);
  const federalTypes = {
    S: 'senate_bill', SB: 'senate_bill',
    HR: 'house_bill',
    HRES: 'house_resolution', SRES: 'senate_resolution',
    HJRES: 'house_joint_resolution', SJRES: 'senate_joint_resolution',
    HCONRES: 'house_concurrent_resolution', SCONRES: 'senate_concurrent_resolution',
  };
  const chamber = prefix.startsWith('S') ? 'senate' : 'house';
  return {
    prefix,
    number,
    chamber,
    govtrackType: federalTypes[prefix] || null,
    display: `${prefix} ${number}`,
  };
}

// ---------- bill research (national) ----------

const GOVTRACK_LABELS = {
  senate_bill: 'S.', house_bill: 'H.R.',
  house_resolution: 'H.Res.', senate_resolution: 'S.Res.',
  house_joint_resolution: 'H.J.Res.', senate_joint_resolution: 'S.J.Res.',
  house_concurrent_resolution: 'H.Con.Res.', senate_concurrent_resolution: 'S.Con.Res.',
};

const CONGRESSGOV_TYPES = {
  senate_bill: 's', house_bill: 'hr',
  house_resolution: 'hres', senate_resolution: 'sres',
  house_joint_resolution: 'hjres', senate_joint_resolution: 'sjres',
  house_concurrent_resolution: 'hconres', senate_concurrent_resolution: 'sconres',
};

async function fetchNationalBill(parsed, warnings) {
  if (!parsed.govtrackType) {
    throw new Error(`"${parsed.display}" does not look like a federal bill number (expected S., H.R., H.Res., S.J.Res., etc.)`);
  }
  const congressNow = currentCongress();
  let found = null;
  for (const congress of [congressNow, congressNow - 1]) {
    const url = `https://www.govtrack.us/api/v2/bill?congress=${congress}&bill_type=${parsed.govtrackType}&number=${parsed.number}`;
    try {
      const data = await fetchJSON(url);
      if (data.objects && data.objects.length) {
        found = data.objects[0];
        if (congress !== congressNow) {
          warnings.push(`No ${parsed.display} found in the current (${congressNow}th) Congress; showing the ${congress}th Congress version. It would need to be reintroduced to be acted on.`);
        }
        break;
      }
    } catch (e) {
      warnings.push(`Bill lookup issue (${congress}th Congress): ${e.message}`);
    }
  }
  if (!found) throw new Error(`Could not find ${parsed.display} in the ${congressNow}th or ${congressNow - 1}th Congress. Double-check the bill number.`);

  const bill = {
    level: 'national',
    displayNumber: found.display_number || `${GOVTRACK_LABELS[parsed.govtrackType]} ${parsed.number}`,
    congress: found.congress,
    title: found.title_without_number || found.title || '',
    sponsor: found.sponsor ? found.sponsor.name : null,
    introducedDate: found.introduced_date || null,
    status: found.current_status_label || found.current_status || '',
    statusDescription: found.current_status_description || '',
    statusDate: found.current_status_date || null,
    chamber: parsed.chamber,
    link: found.link || null,
    summary: null,
  };

  // Optional richer summary from the official Congress.gov API
  if (CONGRESS_API_KEY) {
    try {
      const type = CONGRESSGOV_TYPES[parsed.govtrackType];
      const data = await fetchJSON(
        `https://api.congress.gov/v3/bill/${found.congress}/${type}/${parsed.number}/summaries?format=json&api_key=${CONGRESS_API_KEY}`
      );
      const summaries = data.summaries || [];
      if (summaries.length) {
        const latest = summaries[summaries.length - 1];
        bill.summary = String(latest.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    } catch (e) {
      warnings.push(`Could not fetch official summary from Congress.gov: ${e.message}`);
    }
  }
  return bill;
}

// ---------- representative lookup (national) ----------

let legislatorsCache = null;
async function getLegislators() {
  if (!legislatorsCache) {
    legislatorsCache = await fetchJSON(
      'https://unitedstates.github.io/congress-legislators/legislators-current.json', {}, 45000
    );
  }
  return legislatorsCache;
}

async function zipToPlace(zip) {
  const data = await fetchJSON(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`);
  const place = data.places && data.places[0];
  if (!place) throw new Error(`No location found for zip code ${zip}`);
  return {
    city: place['place name'],
    state: place['state abbreviation'],
    stateName: place.state,
    lat: parseFloat(place.latitude),
    lon: parseFloat(place.longitude),
  };
}

async function latLonToDistrict(lat, lon) {
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=54&format=json`;
  const data = await fetchJSON(url, {}, 30000);
  const geos = data.result && data.result.geographies;
  if (!geos) return null;
  const key = Object.keys(geos).find((k) => /Congressional Districts/i.test(k));
  const cd = key && geos[key] && geos[key][0];
  if (!cd) return null;
  const dist = cd.CD119 || cd.BASENAME;
  return parseInt(dist, 10); // at-large districts come back as 0 or 98
}

function currentTerm(leg) {
  return leg.terms[leg.terms.length - 1];
}

async function findNationalReps(zip, warnings) {
  const place = await zipToPlace(zip);
  let district = null;
  try {
    district = await latLonToDistrict(place.lat, place.lon);
  } catch (e) {
    warnings.push(`Could not determine your House district: ${e.message}. Showing senators only.`);
  }

  const legs = await getLegislators();
  const reps = [];
  for (const leg of legs) {
    const term = currentTerm(leg);
    if (term.state !== place.state) continue;
    if (term.type === 'sen') {
      reps.push(shapeNationalRep(leg, term, place));
    } else if (term.type === 'rep' && district != null) {
      const d = term.district === 0 ? 0 : term.district;
      if (d === district || (district >= 98 && term.district === 0)) {
        reps.push(shapeNationalRep(leg, term, place));
      }
    }
  }
  reps.sort((a, b) => (a.role === b.role ? 0 : a.role === 'Senator' ? -1 : 1));
  if (district != null && !reps.some((r) => r.role === 'Representative')) {
    warnings.push('Could not match a House member for your district; showing senators only.');
  }
  if (district != null) {
    warnings.push('District is estimated from the center of your zip code; zips that span multiple districts may match a neighboring one.');
  }
  return { place, district, reps };
}

function shapeNationalRep(leg, term, place) {
  const isSen = term.type === 'sen';
  return {
    name: leg.name.official_full || `${leg.name.first} ${leg.name.last}`,
    lastName: leg.name.last,
    role: isSen ? 'Senator' : 'Representative',
    salutation: isSen ? 'Senator' : 'Representative',
    party: term.party,
    state: term.state,
    stateName: STATE_NAMES[term.state] || term.state,
    district: isSen ? null : term.district,
    chamber: isSen ? 'senate' : 'house',
    phone: term.phone || null,
    address: term.address || null,
    website: term.url || null,
    contactForm: term.contact_form || null,
    email: null, // members of Congress accept messages via web form, not public email
  };
}

// ---------- state legislature (OpenStates) ----------

async function fetchStateBill(parsed, stateAbbr, warnings) {
  const jurisdiction = STATE_NAMES[stateAbbr];
  const identifier = `${parsed.prefix} ${parsed.number}`;
  const url = `https://v3.openstates.org/bills?jurisdiction=${encodeURIComponent(jurisdiction)}&identifier=${encodeURIComponent(identifier)}&sort=latest_action_desc&per_page=5`;
  const data = await fetchJSON(url, { headers: { 'X-API-KEY': OPENSTATES_API_KEY } });
  const found = data.results && data.results[0];
  if (!found) throw new Error(`Could not find ${identifier} in the ${jurisdiction} legislature.`);
  return {
    level: 'state',
    stateName: jurisdiction,
    displayNumber: found.identifier,
    title: found.title || '',
    sponsor: null,
    introducedDate: found.first_action_date || null,
    status: found.latest_action_description || '',
    statusDescription: '',
    statusDate: found.latest_action_date || null,
    chamber: parsed.chamber,
    link: found.openstates_url || null,
    summary: null,
    session: found.session || null,
  };
}

async function findStateReps(zip, stateAbbr, warnings) {
  const place = await zipToPlace(zip);
  if (stateAbbr && place.state !== stateAbbr) {
    warnings.push(`Note: zip ${zip} is in ${place.stateName}, but you selected ${STATE_NAMES[stateAbbr]}. Legislators shown are for your zip's location.`);
  }
  const url = `https://v3.openstates.org/people.geo?lat=${place.lat}&lng=${place.lon}`;
  const data = await fetchJSON(url, { headers: { 'X-API-KEY': OPENSTATES_API_KEY } });
  const reps = (data.results || []).map((p) => {
    const role = p.current_role || {};
    const isUpper = role.org_classification === 'upper';
    const nameParts = p.name.trim().split(/\s+/);
    return {
      name: p.name,
      lastName: p.family_name || nameParts[nameParts.length - 1],
      role: isUpper ? 'State Senator' : 'State Representative',
      salutation: isUpper ? 'Senator' : 'Representative',
      party: p.party || null,
      state: place.state,
      stateName: place.stateName,
      district: role.district || null,
      chamber: isUpper ? 'senate' : 'house',
      phone: null,
      address: null,
      website: p.openstates_url || null,
      contactForm: null,
      email: p.email || null,
    };
  });
  return { place, district: null, reps };
}

// ---------- request handling ----------

async function handleResearch(query) {
  const warnings = [];
  const billRaw = (query.get('bill') || '').trim();
  const level = (query.get('level') || 'national').trim();
  const stance = query.get('stance') === 'oppose' ? 'oppose' : 'support';
  const zip = (query.get('zip') || '').trim();

  if (!billRaw) throw new Error('Please enter a bill number.');
  const parsed = parseBillNumber(billRaw);
  if (!parsed) throw new Error(`Could not parse "${billRaw}" as a bill number. Try formats like "S. 4985", "H.R. 1234", or "SB 12".`);
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) throw new Error(`"${zip}" is not a valid US zip code.`);

  const isNational = level === 'national';
  if (!isNational && !STATE_NAMES[level]) throw new Error(`Unknown state "${level}".`);
  if (!isNational && !OPENSTATES_API_KEY) {
    throw new Error(
      'State legislature lookups need a free OpenStates API key. Get one at https://open.pluralpolicy.com/accounts/signup/ and restart the server with OPENSTATES_API_KEY=<your key>.'
    );
  }

  const zip5 = zip ? zip.slice(0, 5) : '';
  const billPromise = isNational
    ? fetchNationalBill(parsed, warnings)
    : fetchStateBill(parsed, level, warnings);
  const repsPromise = !zip5
    ? Promise.resolve(null)
    : (isNational ? findNationalReps(zip5, warnings) : findStateReps(zip5, level, warnings));

  const [bill, repResult] = await Promise.all([
    billPromise,
    repsPromise.catch((e) => {
      warnings.push(`Representative lookup failed: ${e.message}`);
      return null;
    }),
  ]);

  if (!zip5) {
    warnings.push('No zip code entered, so the letter is addressed generically. Add your zip to address your own representative.');
  }

  return {
    stance,
    zip: zip5,
    bill,
    place: repResult ? repResult.place : null,
    representatives: repResult ? repResult.reps : [],
    warnings,
  };
}

// ---------- AI letter drafting (optional — needs Anthropic credentials) ----------

let anthropicClient; // undefined = not tried, null = unavailable
function getAnthropic() {
  if (anthropicClient === undefined) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      anthropicClient = new Anthropic(); // resolves ANTHROPIC_API_KEY / auth token / profile
    } catch {
      anthropicClient = null;
    }
  }
  return anthropicClient;
}

async function handleLetter(body) {
  const client = getAnthropic();
  if (!client) return { available: false };

  const { bill, stance, reason, rep, place, zip } = body || {};
  if (!bill || !bill.displayNumber) throw new Error('Missing bill data.');
  const support = stance !== 'oppose';

  const facts = [
    `Bill: ${bill.displayNumber}${bill.title ? ` — "${bill.title}"` : ''}`,
    bill.level === 'national'
      ? `Legislature: U.S. Congress (${bill.congress}th Congress)`
      : `Legislature: ${bill.stateName} state legislature${bill.session ? `, session ${bill.session}` : ''}`,
    bill.sponsor ? `Sponsor: ${bill.sponsor}` : null,
    bill.introducedDate ? `Introduced: ${bill.introducedDate}` : null,
    bill.status ? `Current status: ${bill.status}${bill.statusDate ? ` (as of ${bill.statusDate})` : ''}` : null,
    bill.summary ? `Official summary: ${bill.summary.slice(0, 2000)}` : null,
    bill.statusDescription && !bill.summary ? `Status description: ${bill.statusDescription}` : null,
    rep
      ? `Recipient: The Honorable ${rep.name}, ${rep.role} (${rep.party || 'party unknown'}, ${rep.stateName}${rep.district ? `, District ${rep.district}` : ''}). Salutation: "Dear ${rep.salutation} ${rep.lastName},". Mailing address: ${rep.address || 'not known — use the standard chamber address'}`
      : 'Recipient: unknown — address it "Dear Representative," with a bracketed placeholder for the name/address block',
    place ? `The writer is a constituent in ${place.city}, ${place.state} ${zip || ''}`.trim() : 'The writer\'s location is unknown — use bracketed placeholders',
    `The writer's position: they ${support ? 'SUPPORT' : 'OPPOSE'} this bill.`,
    reason ? `The writer's personal reason, to weave in naturally (keep their voice and first person): ${reason}` : 'No personal reason was given — make the argument from what the bill actually does.',
    `Today's date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
  ].filter(Boolean).join('\n');

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system:
      'You write constituent advocacy letters to legislators. Write a persuasive, respectful, specific letter arguing the writer\'s position on the given bill, grounded in what the bill actually does per the facts provided. Do not invent facts, statistics, or provisions not present in the provided data. Structure: date, recipient address block, salutation, 3-5 short paragraphs (state the position and the bill up front; make the substantive argument tied to the bill\'s actual content; close by asking for a specific action and a reply), then "Sincerely," and "[Your name]" on its own line followed by the writer\'s city/state/zip if known or "[Your address]" if not. Plain text only — no markdown, no commentary, no preamble. Output only the letter.',
    messages: [{ role: 'user', content: facts }],
  });

  const letter = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!letter) throw new Error('Empty letter from model.');
  return { available: true, letter };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/research') {
    try {
      const result = await handleResearch(url.searchParams);
      send(res, 200, result);
    } catch (e) {
      send(res, 400, { error: e.message });
    }
    return;
  }

  if (url.pathname === '/api/letter' && req.method === 'POST') {
    try {
      const result = await handleLetter(await readBody(req));
      send(res, 200, result);
    } catch (e) {
      // AI drafting is best-effort; the client falls back to its local template
      send(res, 200, { available: false, error: e.message });
    }
    return;
  }

  // static files
  let filePath = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, { error: 'Not found' });
    send(res, 200, data, MIME[path.extname(filePath)] || 'application/octet-stream');
  });
});

server.listen(PORT, () => {
  console.log(`Your Voice running at http://localhost:${PORT}`);
  if (!CONGRESS_API_KEY) console.log('Tip: set CONGRESS_API_KEY for official bill summaries (free key at https://api.congress.gov/sign-up/).');
  if (!OPENSTATES_API_KEY) console.log('Tip: set OPENSTATES_API_KEY to enable state legislature lookups (free key at https://open.pluralpolicy.com/accounts/signup/).');
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) console.log('Tip: set ANTHROPIC_API_KEY to enable AI-drafted letters tailored to each bill (https://platform.claude.com/); without it, letters use the built-in template.');
});
