/** Tiny DOM helpers shared by screens. */

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

/** Append one or more top-level nodes from an HTML string into `parent`. */
export function appendHtml(parent, html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  parent.appendChild(t.content);
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function nutrientLabel(key) {
  const map = {
    kcal: 'Calories',
    protein: 'Protein',
    fat: 'Total fat',
    satFat: 'Saturated fat',
    carbs: 'Carbohydrate',
    fibre: 'Fibre',
    sugars: 'Sugars',
    sodium: 'Sodium',
  };
  return map[key] || key;
}

export function nutrientUnit(key) {
  if (key === 'kcal') return 'kcal';
  if (key === 'sodium') return 'mg';
  return 'g';
}

export function formatKind(kind) {
  return kind === 'max' ? 'Max' : 'Min';
}
