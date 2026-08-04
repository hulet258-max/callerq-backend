export function dayRange(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function dateOnly(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
  return date;
}
