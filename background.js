// Focus timer background (MV3 service worker)
// Stores start timestamp, optional end, task info, and nudge interval; creates alarms and notifies.

const FOCUS_KEY = 'focus_timer_state_v1';
const TOKEN_KEY = 'pmd_todoist_token_v1';
let promptTimer = null;

async function getTokenFromSync(){
  return new Promise((resolve) => {
    chrome.storage.sync.get([TOKEN_KEY], (r) => resolve(r[TOKEN_KEY] || ''));
  });
}
async function bgFetch(path, { method='GET', body } = {}){
  const token = await getTokenFromSync();
  if (!token) throw new Error('Missing Todoist token');
  const res = await fetch('https://api.todoist.com/rest/v2' + path, {
    method,
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error((data && data.error) ? data.error : ('HTTP ' + res.status + ': ' + text));
  return data;
}
async function ensureLabelExists(name){
  try { await bgFetch('/labels', { method: 'POST', body: { name } }); } catch(e) {
    const msg = String(e && e.message || '');
    if (msg.includes('already exists')) return; // ignore
    console.warn('Label create issue (bg) for', name, msg);
  }
}
async function getLabelIdByName(name){
  try {
    const labels = await bgFetch('/labels');
    const found = Array.isArray(labels) ? labels.find(l => l && String(l.name).toLowerCase() === String(name).toLowerCase()) : null;
    return found && found.id ? found.id : null;
  } catch(_e){
    return null;
  }
}
async function namesToLabelIdsBg(names){
  const unique = Array.from(new Set((names || []).map(s => String(s))));
  const result = [];
  for (const n of unique){
    const id = await getLabelIdByName(n);
    if (id) result.push(id);
  }
  return Array.from(new Set(result));
}
async function stopFocusAndLabelActual(){
  return new Promise((resolve) => {
    chrome.storage.local.get([FOCUS_KEY], async (data) => {
      const st = data[FOCUS_KEY];
      if (!st) { resolve(); return; }
      try {
        const taskId = st.taskId;
        // No automatic accumulation; popup now asks user and applies update
        // Background just clears state now.
        if (false) {
          const t = await bgFetch('/tasks/' + String(taskId));
          const existing = Array.isArray(t && t.labels) ? t.labels.slice() : [];
          // Get current actual-* max
          let previousActualMinutes = 0;
          const actualNamesToRemove = new Set();
          for (const v of existing){
            const nm = String(v);
            if (/^actual-\d+$/.test(nm)){
              const m = Number(nm.slice('actual-'.length));
              if (Number.isFinite(m) && m > previousActualMinutes) previousActualMinutes = m;
              actualNamesToRemove.add(nm);
            }
          }
          const newTotal = previousActualMinutes + sessionStep;
          const newLabel = `actual-${newTotal}`;
          await ensureLabelExists(newLabel);
          const keptNames = existing.filter(n => !actualNamesToRemove.has(String(n)));
          const nextNames = keptNames.concat([newLabel]);
          const nextIds = await namesToLabelIdsBg(nextNames);
          await bgFetch('/tasks/' + String(taskId), { method: 'POST', body: { labels: nextIds } });
        }
      } catch(_e) {}
      chrome.storage.local.remove([FOCUS_KEY], () => resolve());
    });
  });
}

function openExtensionPopupSafe(){
  try {
    const maybePromise = chrome?.action?.openPopup && chrome.action.openPopup();
    if (maybePromise && typeof maybePromise.then === 'function'){
      maybePromise.catch(() => {});
    }
  } catch(_e) {
    // swallow when no active window
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // noop
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'focus_start') {
    const { taskId, taskTitle, startAt } = msg;
    if (!startAt || !taskId) { sendResponse({ ok: false, error: 'invalid_args' }); return; }
    const state = { taskId, taskTitle, startAt };
    chrome.storage.local.set({ [FOCUS_KEY]: state }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === 'focus_cancel') {
    chrome.storage.local.remove(FOCUS_KEY, () => sendResponse({ ok: true }));
    return true;
  }
});

// Nudging removed
