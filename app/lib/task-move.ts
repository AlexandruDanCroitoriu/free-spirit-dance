export type TaskMove = { key: string; listId?: number | null; position: 'before' | 'after' | 'top' | 'bottom'; targetKey?: string };
export type TaskOrder = Record<string, string[]>;

// Translate a visible drag preview into the same relative move used by buttons.
// Never submit filtered columns as replacement lists: hidden tasks keep their order.
export function taskMoveFromOrder(key: string, before: TaskOrder, after: TaskOrder): TaskMove | null {
  const listIds = Object.keys(before);
  const origin = listIds.find(id => before[id]?.includes(key));
  const destination = listIds.find(id => after[id]?.includes(key));
  if (!origin || !destination) return null;
  const list = after[destination]!;
  const index = list.indexOf(key);
  if (origin === destination && before[origin]!.indexOf(key) === index) return null;
  if (destination !== 'inbox' && !/^[1-9]\d*$/.test(destination)) return null;
  const placement = { listId: destination === 'inbox' ? null : Number(destination) };
  const next = list[index + 1], previous = list[index - 1];
  if (next) return { key, ...placement, position: 'before', targetKey: next };
  if (previous) return { key, ...placement, position: 'after', targetKey: previous };
  return { key, ...placement, position: 'bottom' };
}
