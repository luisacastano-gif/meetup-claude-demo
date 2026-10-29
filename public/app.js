const form = document.getElementById('shorten-form');
const urlInput = document.getElementById('url');
const submitButton = document.getElementById('submit');
const errorEl = document.getElementById('error');
const resultEl = document.getElementById('result');
const shortLink = document.getElementById('short-link');
const copyButton = document.getElementById('copy');

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  resultEl.hidden = true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  submitButton.disabled = true;
  try {
    const response = await fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlInput.value }),
    });
    const data = await response.json();
    if (!response.ok) return showError(data.error);
    shortLink.href = data.shortUrl;
    shortLink.textContent = data.shortUrl;
    copyButton.textContent = 'Copy';
    resultEl.hidden = false;
  } catch {
    showError('Could not reach the server. Check your connection and try again.');
  } finally {
    submitButton.disabled = false;
  }
});

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(shortLink.href);
    copyButton.textContent = 'Copied!';
  } catch {
    copyButton.textContent = 'Press Ctrl+C to copy';
  }
});
