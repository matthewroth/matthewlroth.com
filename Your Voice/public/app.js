// Your Voice — frontend logic

const STATES = {
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
};

const $ = (id) => document.getElementById(id);

// Populate the legislature selector with states
const levelSelect = $('level');
for (const [abbr, name] of Object.entries(STATES)) {
  const opt = document.createElement('option');
  opt.value = abbr;
  opt.textContent = `${name} legislature (state)`;
  levelSelect.appendChild(opt);
}

let currentData = null;
let selectedRep = null;
const letterCache = new Map();
let letterRequestSeq = 0;

// Prefer a server-drafted letter tailored to the bill (Claude API, if the
// server has credentials); fall back to the local template otherwise.
async function setLetter(data, rep) {
  const b = data.bill;
  const key = [b.displayNumber, data.stance, data.reason || '', data.zip || '', rep ? rep.name : ''].join('|');
  const ta = $('letter');
  if (letterCache.has(key)) {
    ta.value = letterCache.get(key);
    return;
  }
  const seq = ++letterRequestSeq;
  ta.value = 'Drafting a letter tailored to this bill…';
  let letter = null;
  try {
    const res = await fetch('/api/letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bill: b,
        stance: data.stance,
        reason: data.reason || '',
        rep,
        place: data.place,
        zip: data.zip,
      }),
    });
    const out = await res.json();
    if (out.available && out.letter) letter = out.letter;
  } catch (e) {
    // network hiccup — fall through to the template
  }
  if (!letter) letter = buildLetter(data, rep);
  letterCache.set(key, letter);
  if (seq === letterRequestSeq) ta.value = letter; // ignore stale responses after a rep switch
}

$('research-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('go');
  btn.disabled = true;
  show('status', 'Researching the bill and looking up your representatives…');
  hide('error');
  hide('results');

  const params = new URLSearchParams({
    bill: $('bill').value,
    level: levelSelect.value,
    stance: document.querySelector('input[name="stance"]:checked').value,
    zip: $('zip').value.trim(),
  });

  try {
    const res = await fetch('/api/research?' + params.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    data.reason = $('reason').value.trim();
    currentData = data;
    render(data);
  } catch (err) {
    show('error', err.message);
  } finally {
    hide('status');
    btn.disabled = false;
  }
});

function show(id, text) {
  const el = $(id);
  if (text !== undefined) el.textContent = text;
  el.classList.remove('hidden');
}
function hide(id) { $(id).classList.add('hidden'); }

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function render(data) {
  // Warnings
  const w = $('warnings');
  w.innerHTML = '';
  for (const msg of data.warnings) {
    const div = document.createElement('div');
    div.className = 'warning';
    div.textContent = '⚠️ ' + msg;
    w.appendChild(div);
  }

  // Bill card
  const b = data.bill;
  const card = $('bill-card');
  card.innerHTML = '';
  const h3 = document.createElement('h3');
  h3.textContent = `${b.displayNumber}: ${b.title}`;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = b.level === 'national' ? `${b.congress}th Congress` : `${b.stateName}${b.session ? ' · ' + b.session : ''}`;
  h3.appendChild(badge);
  card.appendChild(h3);

  const meta = document.createElement('p');
  meta.className = 'meta';
  const bits = [];
  if (b.sponsor) bits.push(`Sponsor: ${b.sponsor}`);
  if (b.introducedDate) bits.push(`Introduced ${fmtDate(b.introducedDate)}`);
  if (b.status) bits.push(`Status: ${b.status}${b.statusDate ? ' (' + fmtDate(b.statusDate) + ')' : ''}`);
  meta.textContent = bits.join(' · ');
  card.appendChild(meta);

  if (b.statusDescription || b.summary) {
    const p = document.createElement('p');
    const text = b.summary || b.statusDescription;
    p.textContent = text.length > 600 ? text.slice(0, 600) + '…' : text;
    card.appendChild(p);
  }
  if (b.link) {
    const p = document.createElement('p');
    const a = document.createElement('a');
    a.href = b.link;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Read the full bill →';
    p.appendChild(a);
    card.appendChild(p);
  }

  // Representative cards
  const reps = data.representatives;
  const grid = $('rep-cards');
  grid.innerHTML = '';
  if (reps.length) {
    show('reps-section');
    // Default to a member of the bill's chamber when possible
    selectedRep = reps.find((r) => r.chamber === b.chamber) || reps[0];
    reps.forEach((rep) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'rep-card' + (rep === selectedRep ? ' selected' : '');
      const districtBit = rep.district != null && rep.district !== 0 ? `, District ${rep.district}` : '';
      el.innerHTML =
        `<div class="rep-name"></div><div class="rep-meta"></div><div class="rep-meta"></div>`;
      el.children[0].textContent = `${rep.role} ${rep.name}`;
      el.children[1].textContent = `${rep.party || ''} · ${rep.stateName}${districtBit}`;
      el.children[2].textContent = rep.email ? rep.email : (rep.phone || '');
      el.addEventListener('click', () => {
        selectedRep = rep;
        grid.querySelectorAll('.rep-card').forEach((c) => c.classList.remove('selected'));
        el.classList.add('selected');
        setLetter(currentData, selectedRep);
        updateEmailUI();
      });
      grid.appendChild(el);
    });
  } else {
    hide('reps-section');
    selectedRep = null;
  }

  setLetter(data, selectedRep);
  updateEmailUI();
  show('results');
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Pull the operative purpose out of a federal/state bill title, e.g.
// "A bill to improve access to Federal services..." -> "improve access to Federal services..."
function billPurpose(title) {
  const t = String(title || '').trim().replace(/\s+/g, ' ');
  const m = t.match(/^(?:a bill to|to|a resolution to|a joint resolution to|a concurrent resolution to|an act to|relating to:?\s*)\s*(.+)$/i);
  if (!m) return null;
  let p = m[1].replace(/,?\s*and for other purposes\.?$/i, '').replace(/\.$/, '').trim();
  if (!p) return null;
  return p.charAt(0).toLowerCase() + p.slice(1);
}

function buildLetter(data, rep) {
  const b = data.bill;
  const support = data.stance === 'support';
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const place = data.place;

  const lines = [];
  lines.push(today, '');

  if (rep) {
    lines.push(`The Honorable ${rep.name}`);
    if (rep.address) {
      lines.push(...rep.address.split(/\s*;\s*/));
    } else if (b.level === 'national') {
      lines.push(rep.chamber === 'senate' ? 'United States Senate' : 'United States House of Representatives', 'Washington, DC');
    } else {
      lines.push(`${rep.stateName} State Legislature`);
    }
    lines.push('', `Dear ${rep.salutation} ${rep.lastName},`);
  } else {
    lines.push('[Your representative\'s name and address]', '', 'Dear Representative,');
  }
  lines.push('');

  const constituentBit = place
    ? `As your constituent in ${place.city}, ${place.state} ${data.zip}`
    : 'As a concerned constituent';
  const billRef = `${b.displayNumber}${b.title ? ', "' + b.title + '"' : ''}`;
  lines.push(
    `${constituentBit}, I am writing to respectfully urge you to ${support ? 'support' : 'oppose'} ${billRef}.`
  );
  lines.push('');

  const statusBits = [];
  if (b.sponsor) statusBits.push(`introduced by ${b.sponsor}`);
  if (b.introducedDate) statusBits.push(`on ${fmtDate(b.introducedDate)}`);
  if (statusBits.length || b.status) {
    let sentence = 'This legislation';
    if (statusBits.length) sentence += `, ${statusBits.join(' ')},`;
    sentence += b.status ? ` currently stands at: ${b.status.toLowerCase()}.` : ' is under consideration.';
    lines.push(sentence, '');
  }

  const reason = (data.reason || '').trim();
  const purpose = billPurpose(b.title);
  const stanceSentence = purpose
    ? (support
        ? `This bill would ${purpose} — a goal I believe would make a real, positive difference for families and communities like mine.`
        : `While the bill's stated aim is to ${purpose}, I believe this approach is the wrong one and would do more harm than good in communities like mine.`)
    : (support
        ? 'I believe this bill addresses an important need and deserves your active backing.'
        : 'I have serious concerns about this bill and believe its passage would be a mistake.');
  const communitySentence = support
    ? 'Its passage would have a meaningful, positive impact on our community, and constituents like me are counting on your leadership to help move it forward.'
    : 'Its consequences would be felt directly in our community, and constituents like me are counting on you to stand against it.';

  lines.push(stanceSentence, '');
  lines.push(reason || communitySentence, '');
  lines.push(
    support
      ? `I urge you to vote in favor of ${b.displayNumber}, to co-sponsor it if you have not already, and to encourage your colleagues to do the same.`
      : `I urge you to vote against ${b.displayNumber} and to encourage your colleagues to oppose it as well.`
  );
  lines.push('');
  lines.push('I would appreciate a reply letting me know your position on this bill. Thank you for your time and for your service to our community.');
  lines.push('');
  lines.push('Sincerely,');
  lines.push('');
  lines.push('[Your name]');
  lines.push(place ? `${place.city}, ${place.state} ${data.zip}` : '[Your address]');

  return lines.join('\n');
}

function updateEmailUI() {
  const note = $('email-note');
  const contact = $('contact-link');
  if (selectedRep && (selectedRep.contactForm || selectedRep.website)) {
    contact.href = selectedRep.contactForm || selectedRep.website;
    show('contact-link');
  } else {
    hide('contact-link');
  }
  if (selectedRep && !selectedRep.email && currentData.bill.level === 'national') {
    show('email-note',
      'Members of Congress don\'t publish public email addresses — the email button opens your mail app with the letter ready, but the surest way to be counted is pasting it into the official contact form above.');
  } else {
    hide('email-note');
  }
}

$('email-btn').addEventListener('click', () => {
  const letter = $('letter').value;
  const b = currentData ? currentData.bill : null;
  const stance = currentData && currentData.stance === 'oppose' ? 'Oppose' : 'Support';
  const subject = b ? `Please ${stance} ${b.displayNumber}${b.title ? ' — ' + b.title : ''}` : 'Constituent letter';
  const to = selectedRep && selectedRep.email ? selectedRep.email : '';
  const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(letter)}`;
  window.location.href = href;
});

$('copy-btn').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('letter').value);
  const btn = $('copy-btn');
  const old = btn.textContent;
  btn.textContent = '✅ Copied!';
  setTimeout(() => { btn.textContent = old; }, 1500);
});
