// MV3 popup for reviewing today's Todoist tasks with grouped labels + calendar date (robust updates)
const API_BASE = 'https://api.todoist.com/rest/v2';
const KEY = 'pmd_todoist_token_v1';

// Screens
const scrStart = document.getElementById('screen-start');
const scrToken = document.getElementById('screen-token');
const scrTask  = document.getElementById('screen-task');
const scrDone  = document.getElementById('screen-done');

// Controls
const planBtn = document.getElementById('planBtn');
const saveTokenBtn = document.getElementById('saveToken');
const tokenInput = document.getElementById('tokenInput');
const submitUpdateBtn = document.getElementById('submitUpdate');
const skipTaskBtn = document.getElementById('skipTask');
const restartBtn = document.getElementById('restart');
const statusEl = document.getElementById('status');

// Task UI
const taskTitleEl = document.getElementById('taskTitle');
const taskMetaEl  = document.getElementById('taskMeta');

// Calendar controls
const openCalendarBtn = document.getElementById('openCalendar');
const customDateInput = document.getElementById('customDate');
const customDateLabel = document.getElementById('customDateLabel');

let tasks = [];
let idx = 0;
let token = '';
let customDateISO = null; // YYYY-MM-DD
let labelIndexByName = new Map(); // name -> id

function show(el){
  [scrStart, scrToken, scrTask, scrDone].forEach(s => s && s.classList.add('hidden'));
  el && el.classList.remove('hidden');
}
function qAll(sel){ return Array.from(document.querySelectorAll(sel)); }

// Token storage
function getToken(){
  return new Promise(res => chrome.storage.sync.get([KEY], r => res(r[KEY] || '')));
}
function setToken(v){
  return new Promise(res => chrome.storage.sync.set({ [KEY]: v }, res));
}

// ----- Date helpers (timezone-safe) -----
function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); // strip time
  x.setDate(x.getDate() + n);
  return x;
}
function toLocalISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`; // YYYY-MM-DD
}
function nextWeekdayISO(targetDow /* 0=Sun..6=Sat */) {
  const now = new Date();
  const todayDow = now.getDay();
  let delta = (targetDow - todayDow + 7) % 7;
  if (delta === 0) delta = 7; // “next” => next week if today is that day
  return toLocalISO(addDays(now, delta));
}
function presetChoiceToISO(choice) {
  const now = new Date();
  switch (choice) {
    case 'today':         return toLocalISO(now);
    case 'tomorrow':      return toLocalISO(addDays(now, 1));
    case 'next_tuesday':  return nextWeekdayISO(2); // Tue=2
    case 'next_saturday': return nextWeekdayISO(6); // Sat=6
    default:              return toLocalISO(now);
  }
}
function humanDateFromISO(iso) {
  // e.g., "7 Sep 2025"
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

// ----- API helpers -----
async function tdFetch(path, opts){
  const method = (opts && opts.method) ? opts.method : 'GET';
  const body   = (opts && opts.body)   ? opts.body   : undefined;
  if (!token) throw new Error('Missing Todoist token');

  const res = await fetch(API_BASE + path, {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_e) { data = text; }

  if (!res.ok) throw new Error((data && data.error) ? data.error : ('HTTP ' + res.status + ': ' + text));
  return data;
}

async function fetchTodayTasks(){
  const data = await tdFetch('/tasks?filter=' + encodeURIComponent('today'));
  return data || [];
}

async function preloadLabels(){
  const labels = await tdFetch('/labels');
  labelIndexByName.clear();
  for (const l of (labels || [])) {
    if (l.name && l.id) labelIndexByName.set(l.name.toLowerCase(), l.id);
  }
}

function namesToLabelIds(names){
  const ids = [];
  for (const n of names) {
    const id = labelIndexByName.get(String(n).toLowerCase());
    if (id) ids.push(id);
  }
  return ids;
}

// ----- UI flow -----
function renderCurrentTask(){
  const t = tasks[idx];
  if (!t){ show(scrDone); return; }
  taskTitleEl.textContent = t.content || '(Untitled)';
  const due = (t.due && t.due.string) ? ('Due: ' + t.due.string) : 'No due date';
  const recurring = (t.due && t.due.is_recurring) ? ' • Recurring' : '';
  const project = t.project_id ? (' • Project: ' + t.project_id) : '';
  taskMetaEl.textContent = due + recurring + project;

  // Reset UI
  qAll('input[name="dateChoice"]').forEach(r => { r.checked = (r.value === 'today'); });
  qAll('.checks input[type=checkbox]').forEach(c => { c.checked = false; });
  customDateISO = null;
  if (customDateInput) customDateInput.value = '';
  if (customDateLabel) customDateLabel.textContent = '';
  if (statusEl) statusEl.textContent = '';
}

async function startFlow(){
  show(scrStart);
  if (planBtn){ planBtn.disabled = true; planBtn.textContent = 'Fetching…'; }
  try{
    await preloadLabels();           // <-- load labels first
    tasks = await fetchTodayTasks(); // <-- then load tasks
    idx = 0;
    if (!tasks.length){ show(scrDone); return; }
    show(scrTask);
    renderCurrentTask();
  }catch(e){
    alert('Failed to fetch tasks: ' + e.message);
  }finally{
    if (planBtn){ planBtn.disabled = false; planBtn.textContent = 'Plan my day'; }
  }
}

async function ensureTaskExists(id){
  try {
    await tdFetch('/tasks/' + id); // GET one task
    return true;
  } catch (e) {
    // 404, etc.
    return false;
  }
}

async function submitCurrent(){
  const t = tasks[idx];
  if (!t) return;

  // Make sure task still exists (not completed/archived in the meantime)
  const exists = await ensureTaskExists(t.id);
  if (!exists) {
    if (statusEl) statusEl.textContent = 'Task no longer exists (skipping)…';
    idx += 1;
    if (idx >= tasks.length){ show(scrDone); } else { renderCurrentTask(); }
    return;
  }

  const chosenRadio = document.querySelector('input[name="dateChoice"]:checked');
  const dateChoice = chosenRadio ? chosenRadio.value : 'today';
  const selectedLabels = qAll('.checks input[type=checkbox]:checked').map(c => c.value);
  const label_ids = namesToLabelIds(selectedLabels);

  // Compute target date (explicit) to avoid timezone drift
  const targetISO = customDateISO ? customDateISO : presetChoiceToISO(dateChoice);
  const isRecurring = !!(t.due && t.due.is_recurring);

  // Update strategy:
  // - "tomorrow" -> use /postpone (works for recurring & non-recurring)
  //   then update labels (if any) in a separate call.
  // - other presets/custom:
  //     recurring -> due_string: "7 Sep 2025", due_lang: "en"
  //     nonrecurring -> due_date: "YYYY-MM-DD"
  if (!customDateISO && dateChoice === 'tomorrow') {
    await tdFetch('/tasks/' + t.id + '/postpone', { method: 'POST' });
    if (label_ids.length) {
      await tdFetch('/tasks/' + t.id, { method: 'POST', body: { labels: label_ids } });
    }
  } else {
    const body = {};
    if (label_ids.length) body.labels = label_ids;

    if (isRecurring) {
      body.due_string = humanDateFromISO(targetISO);
      body.due_lang = 'en';
    } else {
      body.due_date = targetISO;
    }
    await tdFetch('/tasks/' + t.id, { method: 'POST', body });
  }

  if (statusEl) statusEl.textContent = 'Updated ✔';
  idx += 1;
  if (idx >= tasks.length){ show(scrDone); } else { renderCurrentTask(); }
}

function skipCurrent(){
  idx += 1;
  if (idx >= tasks.length){ show(scrDone); } else { renderCurrentTask(); }
}

// Events
if (planBtn){
  planBtn.addEventListener('click', async function(){
    token = await getToken();
    if (!token){ show(scrToken); return; }
    startFlow();
  });
}
if (saveTokenBtn){
  saveTokenBtn.addEventListener('click', async function(){
    const v = tokenInput ? (tokenInput.value || '').trim() : '';
    if (!v) { alert('Please paste your Todoist API token'); return; }
    await setToken(v); token = v;
    if (tokenInput) tokenInput.value = '';
    startFlow();
  });
}
if (submitUpdateBtn) submitUpdateBtn.addEventListener('click', async function(){
  try {
    if (statusEl) statusEl.textContent = 'Updating…';
    await submitCurrent();
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Update failed: ' + e.message;
  }
});
if (skipTaskBtn)     skipTaskBtn.addEventListener('click', skipCurrent);
if (restartBtn)      restartBtn.addEventListener('click', function(){ show(scrStart); });

// Calendar interactions
if (openCalendarBtn){
  openCalendarBtn.addEventListener('click', function(){
    if (customDateInput){
      customDateInput.classList.remove('hidden');
      if (customDateInput.showPicker) customDateInput.showPicker();
    }
  });
}
if (customDateInput){
  customDateInput.addEventListener('change', function(){
    if (customDateInput.value){
      customDateISO = customDateInput.value; // YYYY-MM-DD
      if (customDateLabel) customDateLabel.textContent = 'Selected: ' + customDateISO;
    } else {
      customDateISO = null;
      if (customDateLabel) customDateLabel.textContent = '';
    }
  });
}

// Init
(function init(){
  getToken().then(function(tok){
    token = tok;
    show(token ? scrStart : scrToken);
  });
})();
