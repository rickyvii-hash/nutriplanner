// Example monthly target profiles. Values are editable after selection.

export const PROFILES = [
  {
    id: 'weight-loss',
    name: 'Weight loss',
    icon: '⚖️',
    blurb: 'A moderate calorie ceiling with enough protein and fibre.',
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
    blurb: 'Lower saturated fat, more fibre, steady energy.',
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
    blurb: 'A calorie and protein floor to support rebuilding.',
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
    blurb: 'Higher calorie and protein floors for training days.',
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
