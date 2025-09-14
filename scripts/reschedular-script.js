/**
 * Todoist hourly planner (Apps Script) + Email report — unique ranks starting at 1
 * - Fetch active tasks due "today | overdue"
 * - Group order: urgent-now, urgent-today, high-pressure, low-pressure, urgent-soon, other
 * - Within each group, sub-group by duration: estimated-under-5m, estimated-5m-to-15m, estimated-15m-to-30m, estimated-30m-to-1h, estimated-1h-2h, estimated-over-2h
 * - Final tie-break: created_at oldest first
 * - Assign unique ranks 1..N in sorted order (no duplicates)
 * - Email report with columns: rank, labels, task, project, due time, due string
 * - Top 10 get due_datetime: now+5m, +15m, +25m... (10m gaps); others strip time
 */

const TODOIST_BASE = 'https://api.todoist.com/rest/v2';
const TOKEN_PROP_KEY = '';
const EMAIL_TO = '';
const TARGET_TZ = 'Asia/Kolkata'; // use your desired IANA timezone


// Category order (lower number = earlier in list)
const CATEGORY_ORDER = [
  'urgent-now',         // 0
  'urgent-today',       // 1
  'high-pressure',      // 2
  'low-pressure',       // 3
  'urgent-soon'         // 4
  // 5 => all others (no recognized labels)
];

// Duration sub-group order within a category
const DURATION_ORDER = [
  'estimated-under-5m',
  'estimated-5m-to-15m',
  'estimated-15m-to-30m',
  'estimated-30m-to-1h',
  'estimated-1h-2h',
  'estimated-over-2h'
];

// Minutes estimate per duration label
const DURATION_TO_MINUTES = {
  'estimated-under-5m': 5,
  'estimated-5m-to-15m': 15,
  'estimated-15m-to-30m': 30,
  'estimated-30m-to-1h': 60,
  'estimated-1h-2h': 120,
  'estimated-over-2h': 150
};

const TOP_N = 10; // how many to time-block

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
  // Return 0..4 based on CATEGORY_ORDER, else 5 (other)
  for (let idx = 0; idx < CATEGORY_ORDER.length; idx++) {
    if (labelNamesLower.indexOf(CATEGORY_ORDER[idx]) !== -1) return idx;
  }
  return 5;
}

function computeDurationIndex_(labelNamesLower) {
  for (let idx = 0; idx < DURATION_ORDER.length; idx++) {
    if (labelNamesLower.indexOf(DURATION_ORDER[idx]) !== -1) return idx;
  }
  return DURATION_ORDER.length; // unknown durations go last
}

function decorateTask_(t, idToLabelName, projectIdx) {
  const labelNames = getTaskLabelNames_(t, idToLabelName);
  const labelsLower = labelNames.map(s => s.toLowerCase());

  const categoryIndex = computeCategoryIndex_(labelsLower);
  const durationIndex = computeDurationIndex_(labelsLower);

  const createdAt = t.created_at || null;
  const projectName = projectIdx.get(String(t.project_id)) || '';

  return {
    raw: t,
    labelNames,                // for email display (comma-separated)
    labelsLower,               // for comparisons
    categoryIndex,             // 0 best category, 5 is "other"
    durationIndex,             // 0..5 or DURATION_ORDER.length if none
    createdAt,                 // final tie-break
    projectName,
    rank: null                 // will be assigned 1..N later
  };
}

/**
 * Order rules:
 * 1) categoryIndex ASC (urgent-now, urgent-today, high-pressure, low-pressure, urgent-soon, other)
 * 2) durationIndex ASC within category (under-15m .. over-3h)
 * 3) Final tie-break: created_at ASC (oldest first)
 * 4) Stable by ID
 */
function comparePerRules_(a, b) {
  if (a.categoryIndex !== b.categoryIndex) return a.categoryIndex - b.categoryIndex;
  if (a.durationIndex !== b.durationIndex) return a.durationIndex - b.durationIndex;

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

  // Compute estimates (minutes)
  const toMinutes = (labelsLower) => {
    for (let i = 0; i < DURATION_ORDER.length; i++) {
      const key = DURATION_ORDER[i];
      if (labelsLower.indexOf(key) !== -1) return DURATION_TO_MINUTES[key];
    }
    return 0; // unknown duration contribute 0
  };
  let totalMin = 0, urgentNowMin = 0, urgentTodayMin = 0, highPressureMin = 0;
  ordered.forEach(t => {
    const minutes = toMinutes(t.labelsLower || []);
    totalMin += minutes;
    if (t.labelsLower.indexOf('urgent-now') !== -1) urgentNowMin += minutes;
    if (t.labelsLower.indexOf('urgent-today') !== -1) urgentTodayMin += minutes;
    if (t.labelsLower.indexOf('high-pressure') !== -1) highPressureMin += minutes;
  });
  const fmt = (m) => {
    const h = Math.floor(m / 60);
    const min = m % 60;
    if (h && min) return `${h}h ${min}m`;
    if (h) return `${h}h`;
    return `${min}m`;
  };

  // Helpers for label rendering
  const precedence = CATEGORY_ORDER.concat(DURATION_ORDER);
  function precedenceIndex_(nm){
    const i = precedence.indexOf(nm);
    return i === -1 ? 999 : i;
  }
  function sortLabelsForDisplay_(arr){
    const lower = (arr || []).map(s => String(s).toLowerCase());
    return lower.sort((a,b) => {
      const ai = precedenceIndex_(a), bi = precedenceIndex_(b);
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });
  }
  function pill_(text, bg, border, color){
    const safe = html_(text);
    return `<span style="display:inline-block;padding:4px 12px;border:1px solid ${border};background:${bg};color:${color};border-radius:999px;font-size:12px;white-space:nowrap;word-break:normal;hyphens:none;">${safe}</span>`;
  }
  function labelPillHtml_(nm){
    const n = nm.toLowerCase();
    if (n === 'urgent-now')        return pill_(nm, '#dcfce7', '#86efac', '#065f46');
    if (n === 'urgent-today')      return pill_(nm, '#e0f2fe', '#93c5fd', '#1e3a8a');
    if (n === 'urgent-soon')       return pill_(nm, '#fef3c7', '#fde68a', '#92400e');
    if (n === 'high-pressure')     return pill_(nm, '#fee2e2', '#fecaca', '#991b1b');
    if (n === 'low-pressure')      return pill_(nm, '#f3f4f6', '#e5e7eb', '#374151');
    if (DURATION_ORDER.indexOf(n) !== -1) return pill_(nm, '#f3e8ff', '#e9d5ff', '#5b21b6');
    return pill_(nm, '#eef2ff', '#e0e7ff', '#3730a3');
  }

  // Column order: rank , labels , task , project name , Due time , Due String
  const tdStyle = 'style="border-bottom:1px solid #e5e7eb; vertical-align:top;"';
  const rankTdStyle = 'style="border-bottom:1px solid #e5e7eb; vertical-align:top; width:6%; min-width:40px;"';
  const labelsTdStyle = 'style="border-bottom:1px solid #e5e7eb; vertical-align:top; width:12%; min-width:140px;"';
  const taskTdStyle = 'style="border-bottom:1px solid #e5e7eb; vertical-align:top; width:44%; min-width:340px;"';
  const projectTdStyle = 'style="border-bottom:1px solid #e5e7eb; vertical-align:top; width:12%; min-width:120px;"';
  const dueTimeTdStyle = 'style="border-bottom:1px solid #e5e7eb; vertical-align:top; width:8%; min-width:70px; text-align:center;"';
  const dueStrTdStyle = 'style="border-bottom:1px solid #e5e7eb; vertical-align:top; width:14%; min-width:160px; white-space:nowrap;"';
  const rows = ordered.map((t, i) => {
    const rank = String(t.rank);
    const labelsSorted = sortLabelsForDisplay_(t.labelNames);
    const labels = labelsSorted.map(labelPillHtml_).join('<br/>');
    const task = t.raw.content || '';
    const project = t.projectName || '';
    const dueTime = formatDueTime_(t.raw.due ? t.raw.due.datetime : null) || '';
    const dueString = t.raw.due ? (t.raw.due.string || '') : '';

    const zebra = (i % 2 === 1) ? 'background:#f9fafb;' : '';
    return `
      <tr style="${zebra}">
        <td ${rankTdStyle}>${html_(rank)}</td>
        <td ${labelsTdStyle}>${labels}</td>
        <td ${taskTdStyle}>${html_(task)}</td>
        <td ${projectTdStyle}>${html_(project)}</td>
        <td ${dueTimeTdStyle}>${html_(dueTime)}</td>
        <td ${dueStrTdStyle}>${html_(dueString)}</td>
      </tr>`;
  }).join('');

  const htmlBody = `
    <div style="font:14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
      <h2 style="margin:0 0 8px">Todoist Ranked Tasks</h2>
      <div style="color:#555;margin-bottom:12px">
        Unique ranks assigned from <strong>1..${ordered.length}</strong> (1 = highest priority).
        Groups: urgent-now, urgent-today, high-pressure, low-pressure, urgent-soon. Within each group, duration sub-groups from <em>estimated-under-5m</em> to <em>estimated-over-2h</em>, then by oldest created.
      </div>
      <div style="margin:8px 0 16px; font-size:13px; color:#111;">
        <span style="display:inline-block; padding:4px 10px; border:1px solid #e5e7eb; background:#f8fafc; border-radius:999px; margin-right:8px;"><strong>Total</strong>&nbsp;${fmt(totalMin)}</span>
        <span style="display:inline-block; padding:4px 10px; border:1px solid #e5e7eb; background:#f0fdf4; border-radius:999px; margin-right:8px;"><strong>Urgent-now</strong>&nbsp;${fmt(urgentNowMin)}</span>
        <span style="display:inline-block; padding:4px 10px; border:1px solid #e5e7eb; background:#ecfeff; border-radius:999px; margin-right:8px;"><strong>Urgent-today</strong>&nbsp;${fmt(urgentTodayMin)}</span>
        <span style="display:inline-block; padding:4px 10px; border:1px solid #e5e7eb; background:#fefce8; border-radius:999px; margin-right:8px;"><strong>High-pressure</strong>&nbsp;${fmt(highPressureMin)}</span>
      </div>
      <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      <table cellpadding="8" cellspacing="0" border="0" style="width:100%; border-collapse:separate; border-spacing:0; background:#ffffff;">
        <thead>
          <tr>
            <th style="text-align:left; background:linear-gradient(90deg,#2563eb,#1d4ed8); color:#fff; letter-spacing:.3px;">Rank</th>
            <th style="text-align:left; background:linear-gradient(90deg,#2563eb,#1d4ed8); color:#fff; letter-spacing:.3px;">Labels</th>
            <th style="text-align:left; background:linear-gradient(90deg,#2563eb,#1d4ed8); color:#fff; letter-spacing:.3px;">Task</th>
            <th style="text-align:left; background:linear-gradient(90deg,#2563eb,#1d4ed8); color:#fff; letter-spacing:.3px;">Project</th>
            <th style="text-align:left; background:linear-gradient(90deg,#2563eb,#1d4ed8); color:#fff; letter-spacing:.3px;">Due time</th>
            <th style="text-align:left; background:linear-gradient(90deg,#2563eb,#1d4ed8); color:#fff; letter-spacing:.3px;">Due string</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
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

  // First slot: execution time + 15 minutes (instant arithmetic), display/log in TARGET_TZ
  let slot = new Date(now.getTime() + 15 * 60000);
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
        note: 'time-block',
        slot: new Date(slot.getTime())
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


// Create a reminder using Sync API: relative 0 minutes (at due time)
function createReminderRelativeAtDue_(token, taskId) {
  const syncUrl = 'https://api.todoist.com/sync/v9/sync';
  const command = {
    type: 'reminder_add',
    uuid: Utilities.getUuid(),
    temp_id: Utilities.getUuid(),
    args: {
      type: 'relative',
      item_id: String(taskId),
      minute_offset: 0,
      is_deleted: false
    }
  };
  const payload = {
    resource_types: ['reminders'],
    sync_token: '*',
    commands: [command]
  };
  const res = UrlFetchApp.fetch(syncUrl, {
    method: 'post',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    payload: JSON.stringify(payload)
  });
  if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
    Logger.log('   └ reminder (relative 0) set for task %s', taskId);
  } else {
    Logger.log('   └ failed reminder for %s: %s %s', taskId, res.getResponseCode(), res.getContentText());
  }
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

      // If we set a due_datetime, also create a reminder at the due time via Sync API
      if (u.body && u.body.due_datetime) {
        createReminderRelativeAtDue_(token, u.id);
      }
    } catch (e) {
      Logger.log(' [%s/%s] FAIL %s (%s): %s', idx + 1, updates.length, u.id, u.note, e.message);
    }
    // stay well under 50 req/min
    Utilities.sleep(250);
  });

  Logger.log('Done in %sms', Date.now() - start);
}
