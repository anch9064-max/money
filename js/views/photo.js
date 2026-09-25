// Фото чеков: сжатие перед сохранением и просмотр на весь экран.

/** Уменьшить фото до 1280 px по большей стороне и сжать в JPEG. */
export async function resizeImage(file, max = 1280, quality = 0.72) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function openPhotoViewer(blob) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const el = document.createElement('div');
  el.className = 'photo-viewer';
  el.innerHTML = `<img alt="Фото чека"><button class="pv-close" aria-label="Закрыть">✕</button>`;
  el.querySelector('img').src = url;
  const close = () => { el.remove(); URL.revokeObjectURL(url); };
  el.addEventListener('click', close);
  document.body.append(el);
}
