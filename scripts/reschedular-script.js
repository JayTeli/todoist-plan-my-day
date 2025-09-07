/**
 * Todoist hourly planner (Apps Script) + Email report — unique ranks starting at 1
 * - Fetch active tasks due "today | overdue"
 * - Order by category (urgent-now, low-hanging-fruit, urgent-today, high-pressure, low-pressure, urgent-soon, other)
 * - Within urgent-now: tasks with ALSO low-hanging-fruit come before urgent-now only
 * - Final tie-break: created_at oldest first
 * - Assign unique ranks 1..N in sorted order (no duplicates)
 * - Email report with columns: rank, labels, task, project, due time, due string
 * - Top 15 get due_datetime: now+5m, +15m, +25m... (10m gaps); others strip time
 */

const TODOIST_BASE = 'https://api.todoist.com/rest/v2';
const TOKEN_PROP_KEY = '';
const EMAIL_TO = 'kooljay999@gmail.com';
const TARGET_TZ = 'Asia/Kolkata'; // use your desired IANA timezone


// Category order (lower number = earlier in list)
const CATEGORY_ORDER = [
  'urgent-now',         // 0
  'low-hanging-fruit',  // 1
  'urgent-today',       // 2
  'high-pressure',      // 3
  'low-pressure',       // 4
  'urgent-soon'         // 5
  // 6 => all others (no recognized labels)
];

const TOP_N = 15; // how many to time-block

// ============= Entry point =============
function run() {
  const token = TOKEN_PROP_KEY;
  if (!token) throw new Error('Missing TODOIST_TOKEN Script Property');

  // Lookups
  const idToLabelName = fetchLabels_(token);     // Map<label_id, label_name>
  const projectIdx    = fetchProjects_(token);   // Map<project_id, project_name>

  // Fetch active tasks due today or overdue (completed excluded by REST /tasks)
  const tasks = fetchTasks_(token, 'today | overdue');

  // Decorate
  const enriched = tasks.map(t => decorateTask_(t, idToLabelName, projectIdx));

  // Sort per your rules
  const ordered = enriched.sort(comparePerRules_);

  // Assign unique ranks 1..N in the sorted order
  ordered.forEach((t, i) => { t.rank = i + 1; });

  // Log & Email
  logTasks_(ordered);
  emailRankedTasks_(ordered, EMAIL_TO);

  // Updates (time-block top N, strip time for others)
  const updates = buildUpdates_(ordered);
  applyUpdates_(token, updates);
}

// ============= Fetch helpers =============
function todoistFetch_(token, method, path, bodyObj, paramsObj) {
  const url = buildUrl_(TODOIST_BASE + path, paramsObj);
  const opts = {
    method: method || 'GET',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
  };
  if (bodyObj) opts.payload = JSON.stringify(bodyObj);

  const res  = UrlFetchApp.fetch(url, opts);
  const code = res.getResponseCode();
  const text = res.getContentText() || '';

  if (code === 429) {
    const retryAfter = parseInt(res.getHeaders()['Retry-After'] || '2', 10);
    Utilities.sleep(Math.max(1, retryAfter) * 1000);
    return todoistFetch_(token, method, path, bodyObj, paramsObj); // retry once
  }
  if (code < 200 || code >= 300) {
    throw new Error('Todoist HTTP ' + code + ' ' + url + ' :: ' + text);
  }
  try { return text ? JSON.parse(text) : null; } catch (_e) { return text; }
}

function buildUrl_(base, params) {
  if (!params) return base;
  const qs = Object.keys(params)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  return qs ? base + '?' + qs : base;
}

function fetchLabels_(token) {
  const labels = todoistFetch_(token, 'GET', '/labels');
  const map = new Map(); // id -> name
  (labels || []).forEach(l => map.set(String(l.id), String(l.name)));
  return map;
}

function fetchProjects_(token) {
  const projects = todoistFetch_(token, 'GET', '/projects');
  const idx = new Map(); // id -> name
  (projects || []).forEach(p => idx.set(String(p.id), String(p.name)));
  return idx;
}

function fetchTasks_(token, filterStr) {
  return todoistFetch_(token, 'GET', '/tasks', null, { filter: filterStr }) || [];
}

// ============= Decorate / Sort rules =============
function getTaskLabelNames_(task, idToLabelName) {
  // Robust: task.labels can be numeric IDs or (rarely) names
  const out = [];
  const arr = task.labels || [];
  for (var i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (typeof v === 'number' || String(v).match(/^\d+$/)) {
      const nm = idToLabelName.get(String(v));
      if (nm) out.push(nm);
    } else {
      out.push(String(v)); // already a name
    }
  }
  return out; // array of names (original casing)
}

function computeCategoryIndex_(labelNamesLower) {
  // Return 0..5 based on CATEGORY_ORDER, else 6 (other)
  for (let idx = 0; idx < CATEGORY_ORDER.length; idx++) {
    if (labelNamesLower.indexOf(CATEGORY_ORDER[idx]) !== -1) return idx;
  }
  return 6;
}

function decorateTask_(t, idToLabelName, projectIdx) {
  const labelNames = getTaskLabelNames_(t, idToLabelName);
  const labelsLower = labelNames.map(s => s.toLowerCase());

  const categoryIndex = computeCategoryIndex_(labelsLower);
  const hasUrgentNow = labelsLower.indexOf('urgent-now') !== -1;
  const hasLowHanging = labelsLower.indexOf('low-hanging-fruit') !== -1;

  const createdAt = t.created_at || null;
  const projectName = projectIdx.get(String(t.project_id)) || '';

  return {
    raw: t,
    labelNames,                // for email display (comma-separated)
    labelsLower,               // for comparisons
    categoryIndex,             // 0 best category, 6 is "other"
    urgentNowHasLHF: hasUrgentNow && hasLowHanging, // special tie-break flag
    createdAt,                 // final tie-break
    projectName,
    rank: null                 // will be assigned 1..N later
  };
}

/**
 * Order rules:
 * 1) categoryIndex ASC (urgent-now first, then low-hanging-fruit, urgent-today, high-pressure, low-pressure, urgent-soon, other)
 * 2) If BOTH tasks are in urgent-now (categoryIndex==0):
 *      - Those with low-hanging-fruit ALSO come first (urgentNowHasLHF = true)
 * 3) Final tie-break: created_at ASC (oldest first)
 * 4) Stable by ID
 */
function comparePerRules_(a, b) {
  if (a.categoryIndex !== b.categoryIndex) return a.categoryIndex - b.categoryIndex;

  // Special tie-break inside urgent-now
  if (a.categoryIndex === 0 && b.categoryIndex === 0) {
    if (a.urgentNowHasLHF !== b.urgentNowHasLHF) {
      // true (has LHF) comes before false
      return a.urgentNowHasLHF ? -1 : 1;
    }
  }

  // Final tie-break: created_at oldest first
  const ac = a.createdAt ? new Date(a.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
  const bc = b.createdAt ? new Date(b.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (ac !== bc) return ac - bc;

  // Stable by id
  return String(a.raw.id).localeCompare(String(b.raw.id));
}

// ============= Logging & Email =============
function logTasks_(ordered) {
  Logger.log('— Ranked tasks (unique ranks start at 1; TOP %s will be time-blocked) —', TOP_N);
  ordered.forEach(t => {
    Logger.log(
      'rank=%s  labels=%s  task=%s  project=%s  due.time=%s  due.string=%s  id=%s',
      t.rank,
      t.labelNames.join(', ') || '(none)',
      t.raw.content,
      t.projectName || '(none)',
      formatDueTime_(t.raw.due ? t.raw.due.datetime : null) || '(none)',
      t.raw.due ? (t.raw.due.string || '(none)') : '(none)',
      t.raw.id
    );
  });
}

function emailRankedTasks_(ordered, recipient) {
  if (!recipient) return;
  const now = new Date();
  const subject = `Todoist Planner — Ranked (${ordered.length}) — ${now.toDateString()}`;

  // Column order: rank , labels , task , project name , Due time , Due String
  const rows = ordered.map(t => {
    const rank = String(t.rank);
    const labels = t.labelNames.join(', ');
    const task = t.raw.content || '';
    const project = t.projectName || '';
    const dueTime = formatDueTime_(t.raw.due ? t.raw.due.datetime : null) || '';
    const dueString = t.raw.due ? (t.raw.due.string || '') : '';

    return `
      <tr>
        <td>${html_(rank)}</td>
        <td>${html_(labels)}</td>
        <td>${html_(task)}</td>
        <td>${html_(project)}</td>
        <td>${html_(dueTime)}</td>
        <td>${html_(dueString)}</td>
      </tr>`;
  }).join('');

  const htmlBody = `
    <div style="font:14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
      <h2 style="margin:0 0 8px">Todoist Ranked Tasks</h2>
      <div style="color:#555;margin-bottom:12px">
        Unique ranks assigned from <strong>1..${ordered.length}</strong> (1 = highest priority).
        Within <code>urgent-now</code>, tasks that also have <code>low-hanging-fruit</code> come first.
        Final tie-break is <em>created date</em> (oldest first).
      </div>
      <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse; border-color:#e5e7eb; width:100%;">
        <thead style="background:#f8fafc">
          <tr>
            <th>Rank</th><th>Labels</th><th>Task</th><th>Project</th><th>Due time</th><th>Due string</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  MailApp.sendEmail({ to: recipient, subject: subject, htmlBody: htmlBody });
}

function html_(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function formatDueTime_(dueDateTime) {
  if (!dueDateTime) return '';
  return Utilities.formatDate(new Date(dueDateTime), TARGET_TZ, 'HH:mm');
}


// ============= Updates =============
function buildUpdates_(ordered) {
  const updates = [];

  // "now" as an instant; we’ll treat it as local wall clock in TARGET_TZ
  const now = new Date();
  const todayStr = localYMD_(now, TARGET_TZ);

  // First slot: execution time + 5 minutes (instant arithmetic), display/log in TARGET_TZ
  let slot = new Date(now.getTime() + 5 * 60000);
  Logger.log('Planner first slot (IST): now=%s -> first=%s',
             Utilities.formatDate(now, TARGET_TZ, 'yyyy-MM-dd HH:mm'),
             Utilities.formatDate(slot, TARGET_TZ, 'yyyy-MM-dd HH:mm'));

  // Assign slots to the top N tasks, +10 minutes each, but never cross midnight
  for (let i = 0; i < Math.min(TOP_N, ordered.length); i++) {
    const t = ordered[i].raw;

    // If slot crosses into next local day, DO NOT set time for this task
    if (localYMD_(slot, TARGET_TZ) !== todayStr) {
      // Skip time-setting (leave as-is). You can optionally strip time here if you want.
    } else {
      updates.push({
        id: t.id,
        body: { due_datetime: toIsoWithTz_(slot, TARGET_TZ) },
        note: 'time-block'
      });
    }

    // Next slot: +10 minutes
    slot = new Date(slot.getTime() + 10 * 60000);
  }

  // Remaining tasks: strip time if they currently have a time component
  for (let i = TOP_N; i < ordered.length; i++) {
    const info = ordered[i];
    const due = info.raw.due;
    if (due && due.date && due.datetime) {
      updates.push({
        id: info.raw.id,
        body: { due_date: due.date }, // keep date, remove time
        note: 'strip-time'
      });
    }
  }

  return updates;
}


function roundUpToNext10_(d) {
  // Returns a NEW Date rounded up to the NEXT multiple of 10 minutes.
  const x = new Date(d.getTime());
  x.setSeconds(0, 0);
  const m = x.getMinutes();
  const add = (10 - (m % 10)) % 10 || 10; // if already on a multiple, bump to next 10
  x.setMinutes(m + add);
  return x;
}

function sameLocalYMD_(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

// Round "now" (an instant) to the NEXT multiple of 10 minutes in TARGET_TZ.
// If already at 10-minute mark, bump to the next one (e.g., 05:50 -> 06:00).
function roundUpToNext10SlotDate_(tz, nowInstant) {
  const parts = getLocalPartsInTz_(nowInstant, tz); // {y,m,d,H,Min}
  const rem = parts.Min % 10;
  const add = (rem === 0) ? 10 : (10 - rem);
  parts.Min += add;
  // Normalize overflow (hours/days) using Date.UTC (auto-normalizes)
  return toInstantFromLocalParts_(tz, parts.y, parts.m, parts.d, parts.H, parts.Min);
}

// Returns local Y-M-D string for an instant, in the given tz.
function localYMD_(instant, tz) {
  return Utilities.formatDate(instant, tz, 'yyyy-MM-dd');
}

// Extract local date-time components for an instant in tz.
function getLocalPartsInTz_(instant, tz) {
  const s = Utilities.formatDate(instant, tz, 'yyyy,MM,dd,HH,mm');
  const [y, m, d, H, Min] = s.split(',').map(Number);
  return { y, m, d, H, Min };
}

// Build the actual UTC instant (Date) for a given "local" wall clock in tz.
// We compute the tz offset at that local wall-time and subtract it from UTC components.
function toInstantFromLocalParts_(tz, y, m, d, H, Min) {
  // Normalize via Date.UTC first (handles overflow on m/d/H/Min).
  const guessUtc = new Date(Date.UTC(y, m - 1, d, H, Min, 0, 0));
  // Get the offset of tz at that instant (RFC 822, e.g., +0530)
  const zstr = Utilities.formatDate(guessUtc, tz, 'Z'); // e.g., "+0530"
  const offMin = parseOffsetMinutes_(zstr);
  // Local wall clock to UTC: UTC = local - offset
  const utcMs = Date.UTC(y, m - 1, d, H, Min, 0, 0) - offMin * 60000;
  return new Date(utcMs);
}

// Parse "+0530" / "-0700" into minutes.
function parseOffsetMinutes_(z) {
  const sign = z[0] === '-' ? -1 : 1;
  const hh = parseInt(z.slice(1, 3), 10);
  const mm = parseInt(z.slice(3, 5), 10);
  return sign * (hh * 60 + mm);
}

// Convert an instant (Date) to ISO UTC "Z"
function toIsoUtc_(d) {
  // d is already an instant (UTC-based); return canonical Zulu time
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Format an instant as RFC3339 with explicit tz offset, e.g., 2025-09-07T06:17:00+05:30
function toIsoWithTz_(instant, tz) {
  const ymdHMS = Utilities.formatDate(instant, tz, "yyyy-MM-dd'T'HH:mm:ss");
  const z = Utilities.formatDate(instant, tz, 'Z'); // like +0530
  // Insert colon in offset for RFC3339 (+05:30)
  const zWithColon = z.length === 5 ? (z.slice(0, 3) + ':' + z.slice(3)) : z;
  return ymdHMS + zWithColon;
}


function applyUpdates_(token, updates) {
  if (!updates.length) {
    Logger.log('No updates needed.');
    return;
  }
  const start = Date.now();
  Logger.log('Applying %s updates…', updates.length);

  updates.forEach((u, idx) => {
    try {
      todoistFetch_(token, 'POST', '/tasks/' + u.id, u.body);
      Logger.log(' [%s/%s] OK %s (%s)', idx + 1, updates.length, u.id, u.note);
    } catch (e) {
      Logger.log(' [%s/%s] FAIL %s (%s): %s', idx + 1, updates.length, u.id, u.note, e.message);
    }
    // stay well under 50 req/min
    Utilities.sleep(250);
  });

  Logger.log('Done in %sms', Date.now() - start);
}
