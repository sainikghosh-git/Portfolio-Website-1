/**
 * Admin inbox UI.
 * Talks only to /api/admin/* - never touches the DB or secrets directly.
 */
(function () {
  'use strict';

  const loginView = document.getElementById('login-view');
  const listView = document.getElementById('list-view');
  const loginForm = document.getElementById('login-form');
  const loginStatus = document.getElementById('login-status');
  const passwordInput = document.getElementById('password');
  const listEl = document.getElementById('messages');
  const countEl = document.getElementById('count');

  function setStatus(el, msg, kind) {
    el.textContent = msg;
    el.className = 'inbox-status' + (kind ? ' ' + kind : '');
  }

  function show(view) {
    const isLogin = view === 'login';
    loginView.hidden = !isLogin;
    listView.hidden = isLogin;
    if (isLogin) passwordInput.focus();
  }

  async function api(path, options) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      // fall through with empty data
    }

    if (res.status === 401) {
      show('login');
      return { unauthorized: true };
    }
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function renderMessages(messages, total) {
    const unread = messages.filter((m) => !m.is_read).length;
    countEl.textContent = total === 0
      ? 'No messages'
      : `${messages.length} shown · ${unread} unread · ${total} total`;

    if (messages.length === 0) {
      listEl.innerHTML = '<div class="inbox-empty">Inbox is empty.</div>';
      return;
    }

    listEl.innerHTML = messages
      .map((m) => {
        const id = Number(m.id);
        const subject = m.subject ? escapeHtml(m.subject) : '(no subject)';
        return `
      <article class="inbox-msg ${m.is_read ? '' : 'unread'}" data-id="${id}">
        <div class="inbox-msg-top">
          <span class="inbox-msg-from">${escapeHtml(m.name)}</span>
          <span class="inbox-msg-date">${escapeHtml(formatDate(m.created_at))}</span>
        </div>
        <a class="inbox-msg-email" href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a>
        <div class="inbox-msg-subject">${subject}</div>
        <div class="inbox-msg-body">${escapeHtml(m.message)}</div>
        <div class="inbox-msg-actions">
          <button class="inbox-mini" data-action="toggle">${m.is_read ? 'MARK UNREAD' : 'MARK READ'}</button>
          <button class="inbox-mini" data-action="delete">DELETE</button>
        </div>
      </article>`;
      })
      .join('');
  }

  async function load() {
    try {
      const data = await api('/api/admin/messages?limit=50');
      if (data.unauthorized) return;
      show('list');
      renderMessages(data.messages || [], data.total || 0);
    } catch (err) {
      setStatus(loginStatus, err.message, 'err');
      show('login');
    }
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    setStatus(loginStatus, 'Checking…');

    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password: passwordInput.value }),
      });
      passwordInput.value = '';
      setStatus(loginStatus, '');
      await load();
    } catch (err) {
      setStatus(loginStatus, err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('refresh').addEventListener('click', load);

  document.getElementById('logout').addEventListener('click', async () => {
    try {
      await api('/api/admin/logout', { method: 'POST' });
    } catch {
      // Even if the call fails, drop to the login view locally.
    }
    show('login');
  });

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const card = btn.closest('.inbox-msg');
    const id = Number(card?.dataset.id);
    if (!Number.isInteger(id)) return;

    const action = btn.dataset.action;

    if (action === 'delete') {
      if (!window.confirm('Delete this message permanently?')) return;
      btn.disabled = true;
      try {
        await api(`/api/admin/messages?id=${id}`, { method: 'DELETE' });
        card.remove();
        await load();
      } catch (err) {
        window.alert(err.message);
        btn.disabled = false;
      }
      return;
    }

    if (action === 'toggle') {
      const isUnread = card.classList.contains('unread');
      btn.disabled = true;
      try {
        await api('/api/admin/messages', {
          method: 'PATCH',
          body: JSON.stringify({ id, isRead: isUnread }),
        });
        await load();
      } catch (err) {
        window.alert(err.message);
        btn.disabled = false;
      }
    }
  });

  // If a session cookie is still valid, skip the login screen.
  load();
})();