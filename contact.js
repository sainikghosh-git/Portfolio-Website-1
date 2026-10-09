/**
 * Contact form handler.
 * Posts to /api/contact and shows inline status. Never logs message contents.
 */
(function () {
  'use strict';

  const form = document.getElementById('contact-form');
  if (!form) return;

  const submitBtn = document.getElementById('cf-submit');
  const statusEl = document.getElementById('cf-status');

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = 'contact-status' + (kind ? ' ' + kind : '');
  }

  function fieldError(name) {
    return form.querySelector(`[name="${name}"]`);
  }

  function clearFieldErrors() {
    ['name', 'email', 'message'].forEach((n) => {
      const el = fieldError(n);
      if (el) el.removeAttribute('aria-invalid');
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors();

    // Native constraint check first, so the browser's own bubbles/validation
    // kick in before we spend a round trip.
    if (!form.reportValidity()) return;

    const payload = {
      name: form.elements.name.value,
      email: form.elements.email.value,
      subject: form.elements.subject.value,
      message: form.elements.message.value,
      website: form.elements.website.value,
    };

    submitBtn.disabled = true;
    setStatus('Sending…');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        // non-JSON error body
      }

      if (!res.ok) {
        if (data.fields) {
          Object.entries(data.fields).forEach(([field, _msg]) => {
            const el = fieldError(field);
            if (el) el.setAttribute('aria-invalid', 'true');
          });
        }
        setStatus(data.error || 'Could not send. Please try again.', 'err');
        return;
      }

      form.reset();
      setStatus('Message sent. I’ll get back to you soon.', 'ok');
    } catch {
      setStatus('Network error. Please email me directly.', 'err');
    } finally {
      submitBtn.disabled = false;
    }
  });
})();