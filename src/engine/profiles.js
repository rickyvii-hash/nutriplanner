// Example monthly target profiles. Values are editable after selection.

export const PROFILES = [
  {
    id: 'weight-loss',
    name: 'Weight loss',
    icon: '⚖️',
    blurb: 'Example targets: a moderate calorie maximum, with protein and fibre minima.',
    targets: [
      { nutrient: 'kcal', kind: 'max', daily: 1800 },
      { nutrient: 'protein', kind: 'min', daily: 90 },
      { nutrient: 'fibre', kind: 'min', daily: 25 },
      { nutrient: 'satFat', kind: 'max', daily: 18 },
    ],
  },
  {
    id: 'cholesterol',
    name: 'Cholesterol',
    icon: '💚',
    blurb: 'Example targets: a saturated-fat maximum and a fibre minimum.',
    targets: [
      { nutrient: 'satFat', kind: 'max', daily: 13 },
      { nutrient: 'fibre', kind: 'min', daily: 30 },
      { nutrient: 'kcal', kind: 'max', daily: 2000 },
      { nutrient: 'sodium', kind: 'max', daily: 2300 },
    ],
  },
  {
    id: 'recovery',
    name: 'Recovery',
    icon: '🌱',
    blurb: 'Example targets: calorie and protein minima you can edit.',
    targets: [
      { nutrient: 'kcal', kind: 'min', daily: 2200 },
      { nutrient: 'protein', kind: 'min', daily: 100 },
      { nutrient: 'fibre', kind: 'min', daily: 20 },
      { nutrient: 'fat', kind: 'min', daily: 60 },
    ],
  },
  {
    id: 'athlete',
    name: 'Athlete',
    icon: '🏃',
    blurb: 'Example targets: higher calorie and protein minima.',
    targets: [
      { nutrient: 'kcal', kind: 'min', daily: 2800 },
      { nutrient: 'protein', kind: 'min', daily: 150 },
      { nutrient: 'fibre', kind: 'min', daily: 30 },
      { nutrient: 'fat', kind: 'min', daily: 80 },
    ],
  },
];

export function profileById(id) {
  return PROFILES.find((p) => p.id === id) || null;
}
