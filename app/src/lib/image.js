// Сжатие фото на телефоне до отправки: длинная сторона до 1600 px, JPEG — обычно 250–500 КБ.
// Так 1 100 фото в месяц занимают около 0,5 ГБ, а отправка без хорошей связи не тянется минутами.
const MAX = 1600;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть фото')); };
    img.src = url;
  });
}

export async function compressImage(file) {
  if (file.type === 'application/pdf') return { blob: file, name: file.name || 'document.pdf' };
  let img;
  try { img = await loadImage(file); } catch (_) { return { blob: file, name: file.name || 'photo.jpg' }; }
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.72));
  if (!blob || (blob.size > file.size && file.type === 'image/jpeg')) return { blob: file, name: file.name || 'photo.jpg' };
  return { blob, name: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg' };
}
