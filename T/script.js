/* ── Tab Switching ───────────────────────────────────────────── */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    document.getElementById('panel-' + target).classList.add('active');
  });
});

/* ── Style Chips ─────────────────────────────────────────────── */
document.querySelectorAll('.style-chips').forEach(group => {
  group.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });
});

/* ── Main Generate Dispatcher ────────────────────────────────── */
async function generate(type) {
  const btn    = document.querySelector(`#panel-${type} .btn-generate`);
  const output = document.getElementById('output-' + type);
  const actions = document.getElementById('actions-' + type);

  const prompt = document.getElementById(type + '-prompt').value.trim();
  if (!prompt) { showToast('Please enter a prompt first.'); return; }

  // Loading state
  btn.classList.add('loading');
  btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;margin:0;display:inline-block;vertical-align:middle;"></span> Generating…';
  output.classList.remove('has-content');
  output.innerHTML = '<span class="spinner"></span>';
  actions.classList.add('hidden');

  try {
    if (type === 'text')  await generateText(prompt, output, actions);
    else if (type === 'image') await generateImage(prompt, output, actions);
    else if (type === 'audio') await generateAudio(prompt, output, actions);
  } catch (err) {
    output.innerHTML = `<div style="color:#ef4444;padding:16px;font-size:14px;">&#9888; ${escapeHtml(err.message)}</div>`;
    showToast('Generation failed — see error above.');
  }

  const labels = { text: 'Text', image: 'Image', audio: 'Audio' };
  btn.innerHTML = `<span class="btn-icon">&#9654;</span> Generate ${labels[type]}`;
  btn.classList.remove('loading');
}

/* ── Text Generation (Claude via SSE stream) ─────────────────── */
async function generateText(prompt, output, actions) {
  const model  = document.getElementById('text-model').value;
  const tone   = document.getElementById('text-tone').value;
  const length = document.getElementById('text-length').value;

  output.innerHTML = '<div class="output-text"></div>';
  const textEl = output.querySelector('.output-text');
  let fullText = '';

  const response = await fetch('/api/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model, tone, length }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${response.status}`);
  }

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep any incomplete line for next chunk

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.text) {
          fullText += parsed.text;
          textEl.textContent = fullText;
        }
      } catch (e) {
        if (e.message.startsWith('Unexpected')) continue; // incomplete JSON chunk
        throw e;
      }
    }
  }

  output._content = fullText;
  output.classList.add('has-content');
  actions.classList.remove('hidden');
  showToast('Text generated!');
}

/* ── Image Generation (Pollinations.ai — free) ───────────────── */
async function generateImage(prompt, output, actions) {
  const style    = document.getElementById('image-style').value;
  const size     = document.getElementById('image-size').value;
  const negative = document.getElementById('image-negative').value.trim();

  // Show a waiting message — Pollinations can take ~10s
  output.innerHTML = `
    <div style="text-align:center;padding:28px 16px;">
      <span class="spinner" style="margin:0 auto 14px;display:block;"></span>
      <p style="color:var(--text-muted);font-size:13px;">Generating image… this may take ~10 seconds</p>
    </div>`;

  const res = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, negative, style, size }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }

  const { url } = await res.json();

  // Let the browser load the image before revealing it (retry up to 3 times)
  await new Promise((resolve, reject) => {
    let attempts = 0;
    function tryLoad() {
      attempts++;
      const img = new Image();
      img.onload = () => {
        output.innerHTML = '';
        img.style.cssText = 'width:100%;border-radius:8px;display:block;';
        img.alt = 'AI generated image';
        output.appendChild(img);
        resolve();
      };
      img.onerror = () => {
        if (attempts < 3) {
          setTimeout(tryLoad, 2000);
        } else {
          reject(new Error('Image failed to load — please try again'));
        }
      };
      // Bust cache on retry so Pollinations re-generates
      img.src = attempts === 1 ? url : url + '&retry=' + attempts;
    }
    tryLoad();
  });

  output._imageUrl = url;
  output.classList.add('has-content');
  actions.classList.remove('hidden');
  showToast('Image generated!');
}

/* ── Text-to-Speech (Web Speech API) ── */
async function generateAudio(prompt, output, actions) {
  if (!('speechSynthesis' in window)) throw new Error('Text-to-Speech is not supported in this browser.');

  window.speechSynthesis.cancel();

  output.innerHTML = `
    <div style="text-align:center;padding:28px 16px;">
      <span class="spinner" style="margin:0 auto 14px;display:block;"></span>
      <p style="color:var(--text-muted);font-size:13px;">Speaking your text…</p>
    </div>`;
  output.classList.add('has-content');

  const utterance = new SpeechSynthesisUtterance(prompt);
  utterance.rate = 1;
  utterance.pitch = 1;

  await new Promise((resolve, reject) => {
    utterance.onend = resolve;
    utterance.onerror = e => reject(new Error('Speech failed: ' + e.error));
    window.speechSynthesis.speak(utterance);
  });

  output.innerHTML = `
    <div style="text-align:center;padding:28px 16px;">
      <span style="font-size:40px;">&#127925;</span>
      <p style="color:var(--text-muted);font-size:13px;margin-top:14px;">Text-to-Speech completed.</p>
      <p style="color:var(--text);font-size:12px;opacity:.5;margin-top:6px;max-width:300px;margin:8px auto 0;">
        &ldquo;${escapeHtml(prompt.substring(0, 80))}${prompt.length > 80 ? '&hellip;' : ''}&rdquo;
      </p>
      <button id="tts-replay-btn" style="margin-top:16px;padding:8px 20px;background:var(--c-audio);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">&#9654; Speak Again</button>
    </div>`;
  document.getElementById('tts-replay-btn').addEventListener('click', () => {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(prompt));
  });

  showToast('Text-to-Speech completed!');
}

/* ── Copy Output ─────────────────────────────────────────────── */
function copyOutput(type) {
  const output = document.getElementById('output-' + type);
  const text = output._content || output.innerText;
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'));
}

/* ── Download Output ─────────────────────────────────────────── */
function downloadOutput(type, ext) {
  const output = document.getElementById('output-' + type);

  if (type === 'text' && output._content) {
    const blob = new Blob([output._content], { type: 'text/plain' });
    triggerDownload(blob, `generated-text.${ext}`);
    return;
  }

  if (type === 'image' && output._imageUrl) {
    // Open in new tab so user can right-click save (CORS prevents direct download)
    window.open(output._imageUrl, '_blank');
    showToast('Image opened in new tab — right-click to save.');
    return;
  }

  showToast(`Download .${ext} — connect a real model to enable.`);
}

function triggerDownload(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Toast ───────────────────────────────────────────────────── */
let toastTimeout;
function showToast(message) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  clearTimeout(toastTimeout);
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  toastTimeout = setTimeout(() => {
    toast.classList.add('out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 2800);
}

/* ── Helpers ─────────────────────────────────────────────────── */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
