const form = document.getElementById('form');
const input = document.getElementById('url');
const submit = document.getElementById('submit');
const errorEl = document.getElementById('error');
const result = document.getElementById('result');
const link = document.getElementById('short-link');
const copy = document.getElementById('copy');

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  result.hidden = true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  submit.disabled = true;

  try {
    const res = await fetch('/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input.value }),
    });
    const data = await res.json();
    if (!res.ok) return showError(data.error || 'Something went wrong.');

    link.href = data.shortUrl;
    link.textContent = data.shortUrl;
    copy.textContent = 'Copy';
    result.hidden = false;
  } catch {
    showError('Could not reach the server. Please try again.');
  } finally {
    submit.disabled = false;
  }
});

copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(link.href);
    copy.textContent = 'Copied!';
  } catch {
    // Clipboard API needs a secure context; fall back to selecting the text.
    getSelection().selectAllChildren(link);
    copy.textContent = 'Press Ctrl+C';
  }
});
