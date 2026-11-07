/* NexOS 3.3.0 file attachments for the NexAI chat (Classic and Enterprise).
   Picks PDFs, photos and text files, shrinks large photos, and hands base64 data to the chat. Files are not stored. */
(function () {
  const MAX_FILES = 3;
  const MAX_BYTES = 6 * 1024 * 1024;
  const KEEP_ORIGINAL_BYTES = 1.5 * 1024 * 1024;
  const IMG_MAX_DIM = 1600;
  const TEXT_EXT = /\.(txt|md|csv|json|xml|html|css|js|ts|py|java|c|cpp|h|cs|go|rs|php|rb|sql|ya?ml|log|tex)$/i;

  function kindOf(file) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
    if (/^image\//.test(file.type)) return 'image';
    if (TEXT_EXT.test(file.name)) return 'text';
    return null;
  }
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
      img.src = url;
    });
  }
  async function shrinkImage(file) {
    const img = await loadImage(file);
    const scale = Math.min(1, IMG_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) throw new Error('image');
    return blob;
  }
  function formatSize(n) {
    return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  }
  function injectStyle() {
    if (document.getElementById('nexos-attach-styles')) return;
    const st = document.createElement('style');
    st.id = 'nexos-attach-styles';
    const line = 'var(--border-subtle,var(--border,rgba(128,128,128,.35)))';
    st.textContent = '.nexos-attach-btn{flex:none;width:36px;height:36px;border-radius:50%;border:1px solid ' + line + ';background:transparent;color:inherit;font-size:16px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}'
      + '.nexos-attach-btn.lg{width:40px;height:40px}'
      + '.nexos-attach-tray{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}'
      + '.nexos-attach-tray[hidden]{display:none}'
      + '.nexos-attach-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:4px 6px 4px 10px;border:1px solid ' + line + ';border-radius:999px;font-size:12px}'
      + '.nexos-attach-chip.is-pending{opacity:.7}'
      + '.nexos-attach-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}'
      + '.nexos-attach-chip button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px;padding:2px 4px}';
    document.head.appendChild(st);
  }

  // opts: { input, button, tray, say(message), onChange() }
  function create(opts) {
    injectStyle();
    const { input, button, tray } = opts;
    const say = opts.say || function () {};
    const items = [];
    let pending = 0;

    function render() {
      tray.textContent = '';
      items.forEach((it, i) => {
        const chip = document.createElement('div');
        chip.className = 'nexos-attach-chip';
        const label = document.createElement('span');
        label.textContent = '📎 ' + it.name + ' · ' + formatSize(it.bytes);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove ' + it.name);
        remove.textContent = '✕';
        remove.addEventListener('click', () => { items.splice(i, 1); render(); if (opts.onChange) opts.onChange(); });
        chip.append(label, remove);
        tray.appendChild(chip);
      });
      if (pending) {
        const chip = document.createElement('div');
        chip.className = 'nexos-attach-chip is-pending';
        const label = document.createElement('span');
        label.textContent = 'Preparing file…';
        chip.appendChild(label);
        tray.appendChild(chip);
      }
      tray.hidden = !items.length && !pending;
    }

    async function addFiles(fileList) {
      const files = Array.from(fileList || []);
      for (const file of files) {
        if (items.length + pending >= MAX_FILES) { say('You can attach up to ' + MAX_FILES + ' files per message.'); break; }
        const kind = kindOf(file);
        if (!kind) { say('"' + file.name + '" is not supported. Use a PDF, photo or text file.'); continue; }
        pending++; render();
        try {
          let blob = file;
          let name = file.name;
          if (kind === 'image' && (file.size > KEEP_ORIGINAL_BYTES || !/^image\/(png|jpeg|webp)$/.test(file.type))) {
            blob = await shrinkImage(file);
            name = name.replace(/\.[^.]+$/, '') + '.jpg';
          }
          const data = await blobToBase64(blob);
          const bytes = Math.floor(data.length * 3 / 4);
          const total = items.reduce((s, x) => s + x.bytes, 0) + bytes;
          if (total > MAX_BYTES) { say('Too large. Keep the total under 6 MB per message.'); continue; }
          items.push({ name, data, bytes });
        } catch (_) {
          say('Could not read "' + file.name + '".');
        } finally {
          pending--; render(); if (opts.onChange) opts.onChange();
        }
      }
      input.value = '';
    }

    button.addEventListener('click', () => input.click());
    input.addEventListener('change', () => addFiles(input.files));
    render();

    return {
      list: () => items.map((x) => ({ name: x.name, data: x.data })),
      names: () => items.map((x) => x.name),
      count: () => items.length,
      busy: () => pending > 0,
      clear: () => { items.length = 0; render(); if (opts.onChange) opts.onChange(); },
    };
  }

  window.NexAttach = { create };
})();
