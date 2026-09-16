// Store preset keys, never user-provided CSS. Cards keep their neutral surface.
export const taskColors = [
  { key: 'default', name: 'Default', background: '#e7e5e4' },
  { key: 'navy', name: 'Midnight', background: 'linear-gradient(135deg,#1b3455,#102342)' },
  { key: 'ocean', name: 'Ocean', background: 'linear-gradient(135deg,#0968dc,#2cb8bb)' },
  { key: 'blue', name: 'Blue', background: 'linear-gradient(135deg,#0867d8,#123b78)' },
  { key: 'plum', name: 'Plum', background: 'linear-gradient(135deg,#273b75,#b14c9f)' },
  { key: 'lilac', name: 'Lilac', background: 'linear-gradient(135deg,#8057c3,#d672bd)' },
  { key: 'sunset', name: 'Sunset', background: 'linear-gradient(135deg,#e4492d,#ffac36)' },
  { key: 'rose', name: 'Rose', background: 'linear-gradient(135deg,#e36cba,#f77465)' },
  { key: 'lagoon', name: 'Lagoon', background: 'linear-gradient(135deg,#198669,#55bbd0)' },
  { key: 'slate', name: 'Slate', background: 'linear-gradient(135deg,#52617c,#192f50)' },
  { key: 'ember', name: 'Ember', background: 'linear-gradient(135deg,#542905,#b42918)' },
  { key: 'azure', name: 'Azure', background: '#007eb5' },
  { key: 'gold', name: 'Gold', background: '#ce9032' },
  { key: 'green', name: 'Green', background: '#529536' },
  { key: 'brick', name: 'Brick', background: '#ae4632' },
  { key: 'purple', name: 'Purple', background: '#9061a0' },
  { key: 'pink', name: 'Pink', background: '#c95391' },
  { key: 'mint', name: 'Mint', background: '#48bc70' },
  { key: 'cyan', name: 'Cyan', background: '#00acc1' },
  { key: 'gray', name: 'Gray', background: '#879296' },
] as const;
export type TaskColor = typeof taskColors[number]['key'];
export function taskBackground(key: string | undefined, fallback = '#f5f5f4') {
  return key && key !== 'default' ? taskColors.find(color => color.key === key)?.background ?? fallback : fallback;
}
export type TaskColorChange = { target: 'inbox'; color: TaskColor } | { target: 'board'; scope: 'school' | 'personal'; color: TaskColor } | { target: 'list'; listId: number; color: TaskColor };
export type TaskListMove = { listId: number; targetId: number; position: 'before' | 'after' };
