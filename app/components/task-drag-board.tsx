"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { DragDropProvider, KeyboardSensor, PointerSensor, useDroppable, type DragStartEvent, type DragOverEvent, type DragEndEvent } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import { Accessibility, AutoScroller, PointerActivationConstraints } from '@dnd-kit/dom';
import { pointerIntersection } from '@dnd-kit/collision';
import { move as moveItems } from '@dnd-kit/helpers';
import type { BoardTask, TaskBoard, TaskList } from '../lib/tasks';
import { taskMoveFromOrder, type TaskMove, type TaskOrder } from '../lib/task-move';
import TaskContainerComposer from './task-container-composer';
import TaskCard, { type TaskCardAdministrator } from './task-card';
import { taskRequest } from '../lib/tasks-client';
import TaskSettings from './task-settings';
import { taskBackground, type TaskColor, type TaskColorChange, type TaskListMove } from '../lib/task-colors';
import TaskQuickAdd from './task-quick-add';

const sensors = [PointerSensor.configure({
  // A touch must be held before it becomes a drag. This leaves ordinary swipes
  // available for scrolling the mobile board and Inbox tray.
  activationConstraints: event => event.pointerType === 'touch'
    ? [new PointerActivationConstraints.Delay({ value: 400, tolerance: 8 })]
    : [new PointerActivationConstraints.Distance({ value: 4 })],
  // Header buttons remain tap targets, but a touch hold anywhere on the
  // header picks up the list. Inputs and opened menus keep normal interaction.
  preventActivation: (event, source) => {
    if (!(event.target instanceof Element)) return false;
    if (event.pointerType === 'touch' && source.type === 'task-list'
      && event.target.closest('[data-list-handle]') && event.target.closest('button')
      && !event.target.closest('[popover]')) return false;
    return !!event.target.closest('a, details, input, select, textarea, [contenteditable="true"], button:not([data-task-open])');
  },
}), KeyboardSensor];

// Prefer cards over their parent column for pointer drops. Keep keyboard
// collision priorities equal so arrow navigation can reach empty columns.
const columnCollision: typeof pointerIntersection = input => {
  const collision = pointerIntersection(input);
  return collision ? { ...collision, priority: 1 } : null;
};

function Column({ columnId, title, disabled, children, statusSettings, onCreate, inbox = false, color, index, onColor, onRemove }: { statusSettings: ReactNode; color: TaskColor; index: number; onColor: (color: TaskColor) => Promise<void>; onRemove?: () => Promise<void>; columnId: string; title: string; disabled: boolean; children: ReactNode; onCreate: (title: string, key: string) => Promise<void>; inbox?: boolean }) {
  const { ref, isDropTarget } = useDroppable({ id: columnId, accept: 'task', collisionDetector: columnCollision, disabled });
  const sortable = useSortable({id: `list:${columnId}`, index, group: 'lists', type: 'task-list', accept: 'task-list', collisionDetector: pointerIntersection, disabled: disabled || inbox});
  const combinedRef = useCallback((element: HTMLElement | null) => { ref(element); sortable.ref(element); }, [ref, sortable.ref]);
  const add = <TaskQuickAdd inbox={inbox} compact disabled={disabled} onCreate={onCreate} />;
  return <section data-dragging={sortable.isDragSource || undefined} ref={combinedRef} id={inbox ? "task-inbox" : undefined} style={{background: taskBackground(color)}} aria-labelledby={`column-${columnId}`} className={`${inbox ? 'task-inbox-column order-3 md:order-1 flex flex-col' : 'flex max-h-full w-[272px] flex-col shadow-lg shadow-slate-950/25'} max-w-[calc(100vw-2rem)] shrink-0 rounded-xl border bg-stone-100 ${isDropTarget ? 'border-lime-600 ring-2 ring-lime-600' : 'border-black/20'}`}>
    <div className={`shrink-0 rounded-t-xl bg-transparent font-sans ${color === 'default' ? 'text-slate-800' : 'text-white [text-shadow:0_1px_2px_rgb(0_0_0_/_0.35)]'}`}>
      <div ref={inbox ? undefined : sortable.handleRef} tabIndex={inbox || disabled ? undefined : 0} aria-label={inbox ? undefined : `Drag list ${title}`} aria-roledescription={inbox ? undefined : 'draggable list'} data-list-handle={inbox ? undefined : columnId} className={`flex touch-auto items-center gap-2 pl-4 pr-1 focus-visible:outline-2 focus-visible:outline-lime-700 ${inbox ? 'h-14' : 'min-h-11 cursor-grab select-none'}`}>
        <h2 id={`column-${columnId}`} className="m-0 flex min-h-11 min-w-0 shrink-0 items-center text-sm font-bold"><span className="max-w-24 truncate">{title}</span></h2>
        <div className="min-w-0 flex-1">{add}</div>
        <TaskSettings label={inbox ? 'Inbox' : `${title} list`} color={color} disabled={disabled} onColor={onColor} onRemove={onRemove}>{statusSettings}</TaskSettings>
      </div>
    </div>
    <div className={`task-scrollbar min-h-0 flex-1 touch-auto overflow-y-auto space-y-2 p-2`}>
      <div className="min-h-1 space-y-2">{children}</div>
    </div>
  </section>;
}

function SortableCard({ task, index, columnId, disabled, children }: {
  task: BoardTask; index: number; columnId: string; disabled: boolean; children: ReactNode;
}) {
  const { ref, isDragSource } = useSortable({ id: task.key, index, group: columnId, type: 'task', accept: 'task', collisionDetector: pointerIntersection, disabled, data: { title: task.title } });
  return <div ref={ref} id={`task-${task.key}`} tabIndex={disabled ? -1 : 0} aria-label={`Drag ${task.title}`} aria-roledescription="draggable card" data-dragging={isDragSource || undefined} className={`${isDragSource ? 'cursor-grabbing ring-2 ring-lime-600' : 'cursor-grab'} touch-auto select-none rounded-xl focus-visible:outline-2 focus-visible:outline-lime-700`}>
    {children}
  </div>;
}

export default function TaskDragBoard({ board, columns, visible, today, disabled, onDragging, onStudent, onMove, onEdit, onCreate, onAddList, header, onColor, onListMove, onRemoveList, boardScope = 'school', highlightedTask = null }: {
  highlightedTask?: string | null;
  onColor: (change: TaskColorChange) => Promise<void>; onListMove: (change: TaskListMove) => Promise<void>; onRemoveList: (listId: number) => Promise<void>;
  board: TaskBoard; columns: TaskList[]; visible: BoardTask[]; today: string; disabled: boolean;
  onDragging: (dragging: boolean) => void; onStudent: (id: number) => void; onMove: (change: TaskMove) => Promise<void>; onEdit: (task: BoardTask) => void;
  onCreate: (listId: number | null, title: string, key: string) => Promise<void>;
  onAddList: (name: string, requestKey: string) => Promise<void>; header?: ReactNode; boardScope?: 'school' | 'personal';
}) {
  const [listPreview, setListPreview] = useState<string[] | null>(null);
  const [hiddenStatuses, setHiddenStatuses] = useState<Record<string, string[]>>({});
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('fsd-task-list-statuses') ?? '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) setHiddenStatuses(Object.fromEntries(Object.entries(saved).filter(([, value]) => Array.isArray(value) && value.every(status => status === 'in_progress' || status === 'done'))));
    } catch { /* Use both statuses when preferences are unavailable. */ }
  }, []);
  const statusKey = (id: string) => id === 'inbox' ? 'inbox' : `${boardScope}:${id}`;
  const filteredVisible = visible.filter(task => task.key === highlightedTask || task.listId === null || !hiddenStatuses[statusKey(String(task.listId))]?.includes(task.status ?? 'in_progress'));
  function toggleStatus(id: string, status: string) {
    const key = statusKey(id), current = hiddenStatuses[key] ?? [];
    const next = { ...hiddenStatuses, [key]: current.includes(status) ? current.filter(value => value !== status) : [...current, status] };
    setHiddenStatuses(next);
    try { localStorage.setItem('fsd-task-list-statuses', JSON.stringify(next)); } catch { /* Filtering still works without storage. */ }
  }
  const [administrators, setAdministrators] = useState<TaskCardAdministrator[]>([]);
  useEffect(() => {
    let cancelled = false;
    void taskRequest<TaskCardAdministrator[]>('/api/tasks/administrators').then(data => {
      if (!cancelled) setAdministrators(data);
    }).catch(() => { /* Cards retain an initials fallback if the directory is unavailable. */ });
    return () => { cancelled = true; };
  }, [board.revision]);
  const listOrder = columns.map(column => `list:${column.id}`);
  const initialLists = useRef<string[] | null>(null);
  const currentLists = useRef<string[] | null>(null);
  const [preview, setPreview] = useState<TaskOrder | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draggingTask, setDraggingTask] = useState(false);
  const rail = useRef<HTMLDivElement>(null);
  const dragPoint = useRef<{ x: number; y: number } | null>(null);
  const [inboxHeight, setInboxHeight] = useState(260);
  const [inboxWidth, setInboxWidth] = useState(348);
  const workspace = useRef<HTMLDivElement>(null);
  const suppressClickUntil = useRef(0);
  const initial = useRef<TaskOrder | null>(null);
  const current = useRef<TaskOrder | null>(null);
  const order: TaskOrder = { inbox: filteredVisible.filter(task => task.listId === null).sort((a, b) => a.sortOrder - b.sortOrder).map(task => task.key), ...Object.fromEntries(columns.map(column => [String(column.id), filteredVisible.filter(task => task.listId === column.id).sort((a, b) => a.sortOrder - b.sortOrder).map(task => task.key)])) };
  const shown = preview ?? order;
  const tasksByKey = new Map(board.tasks.map(task => [task.key, task]));
  const maxInboxHeight = typeof window === 'undefined' ? 600 : Math.max(150, window.innerHeight - 220);
  const maxInboxWidth = typeof window === 'undefined' ? 700 : Math.max(240, (workspace.current?.clientWidth ?? window.innerWidth) - 300);
  useEffect(() => () => onDragging(false), [onDragging]);
  useEffect(() => {
    if (!draggingTask || !window.matchMedia('(max-width: 767px)').matches) return;
    let frame = 0, lastStep = 0;
    const tick = (time: number) => {
      const element = rail.current, point = dragPoint.current;
      if (element && point && time - lastStep > 550) {
        const bounds = element.getBoundingClientRect();
        const lists = Array.from(element.querySelectorAll<HTMLElement>(':scope > section'));
        const positions = lists.map(list => Math.max(0, Math.min(element.scrollWidth - element.clientWidth, list.getBoundingClientRect().left - bounds.left + element.scrollLeft - 12)));
        if (point.y >= bounds.top && point.y <= bounds.bottom) {
          const edge = Math.min(64, bounds.width * 0.18);
          const direction = point.x < bounds.left + edge ? -1 : point.x > bounds.right - edge ? 1 : 0;
          const next = direction > 0 ? positions.find(position => position > element.scrollLeft + 2) : direction < 0 ? positions.findLast(position => position < element.scrollLeft - 2) : undefined;
          if (next !== undefined) {
            element.scrollTo({ left: next, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
            lastStep = time;
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); dragPoint.current = null; const element = rail.current; if (element) element.scrollTo({ left: element.scrollLeft, behavior: 'instant' }); };
  }, [draggingTask]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('tasks-inbox-size') ?? 'null') as { width?: unknown; height?: unknown } | null;
      if (typeof saved?.width === 'number' && Number.isFinite(saved.width)) setInboxWidth(Math.max(0, saved.width));
      if (typeof saved?.height === 'number' && Number.isFinite(saved.height)) setInboxHeight(Math.max(0, saved.height));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('tasks-inbox-size', JSON.stringify({ width: inboxWidth, height: inboxHeight })); } catch {} }, [inboxWidth, inboxHeight]);
  useEffect(() => {
    if (!highlightedTask || disabled) return;
    const task = board.tasks.find(item => item.key === highlightedTask);
    if (task?.listId === null) { setInboxHeight(height => Math.max(height, 260)); setInboxWidth(width => Math.max(width, 348)); }
    let frame = 0, timer = 0;
    let card: HTMLElement | null = null;
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        card = document.getElementById(`task-${highlightedTask}`);
        if (!card) return;
        card.classList.add('task-card-highlight');
        card.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center', inline: 'center' });
        card.querySelector<HTMLButtonElement>('[data-task-open]')?.focus({ preventScroll: true });
        timer = window.setTimeout(() => card?.classList.remove('task-card-highlight'), 6000);
      });
    });
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); card?.classList.remove('task-card-highlight'); };
  }, [highlightedTask, boardScope, disabled]);

  function resizeInbox(event: ReactPointerEvent<HTMLButtonElement>) {
    if (window.matchMedia('(min-width: 768px)').matches) return;
    event.preventDefault();
    const startY = event.clientY, startHeight = inboxHeight;
    const move = (moveEvent: PointerEvent) => {
      const next = Math.min(window.innerHeight - 220, startHeight - moveEvent.clientY + startY);
      setInboxHeight(next <= 100 ? 0 : Math.max(150, next));
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
  }
  function resizeInboxWidth(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!window.matchMedia('(min-width: 768px)').matches) return;
    event.preventDefault();
    const startX = event.clientX, startWidth = inboxWidth;
    const move = (moveEvent: PointerEvent) => {
      const next = Math.min(Math.max(240, (workspace.current?.clientWidth ?? window.innerWidth) - 300), startWidth + moveEvent.clientX - startX);
      setInboxWidth(next <= 120 ? 0 : Math.max(240, next));
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
  }
  const title = (id: unknown) => typeof id === 'string' ? tasksByKey.get(id)?.title ?? columns.find(column => String(column.id) === id || `list:${column.id}` === id)?.title ?? 'task' : 'task';
  return <DragDropProvider sensors={sensors} plugins={defaults => [...defaults.filter(plugin => plugin !== AutoScroller), AutoScroller.configure({ threshold: { x: draggingTask && typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 0 : 0.2, y: 0.2 } }), Accessibility.configure({
    screenReaderInstructions: { draggable: 'To move a task, focus its card and press Space or Enter, use the arrow keys, then press Space or Enter to drop. Escape cancels. Open the card editor to choose a list or move the card up or down. To reorder lists, focus a list heading and use Space, arrow keys, and Space.' },
    announcements: {
      dragstart: (event: DragStartEvent) => `Picked up ${title(event.operation.source?.id)}.`,
      dragover: (event: DragOverEvent) => event.operation.target ? `Moving ${title(event.operation.source?.id)} over ${title(event.operation.target.id)}.` : 'Outside the board. Drop here to cancel.',
      dragend: (event: DragEndEvent) => event.canceled || !event.operation.target ? 'Move canceled.' : `Dropped ${title(event.operation.source?.id)}.`,
    },
  })]} onBeforeDragStart={event => { if (disabled) event.preventDefault(); }} onDragStart={event => {
    suppressClickUntil.current = Number.POSITIVE_INFINITY;
    if (event.operation.source?.type === 'task-list') { initialLists.current = listOrder; currentLists.current = listOrder; setListPreview(listOrder); setDragging(true); onDragging(true); return; }
    initial.current = order; current.current = order; setPreview(order); setDraggingTask(true); setDragging(true); onDragging(true);
  }} onDragMove={event => {
    dragPoint.current = event.operation.position.current;
  }} onDragOver={event => {
    if (currentLists.current) { const next = moveItems(currentLists.current, event); currentLists.current = next; setListPreview(next); return; }
    if (!current.current) return;
    const next = moveItems(current.current as Record<string, string[]>, event);
    current.current = next; setPreview(next);
  }} onDragEnd={async event => {
    setDraggingTask(false); dragPoint.current = null;
    suppressClickUntil.current = Date.now() + 350;
    if (initialLists.current) {
      const before = initialLists.current, after = currentLists.current!, key = String(event.operation.source?.id);
      initialLists.current = null; currentLists.current = null; setDragging(false);
      try {
        if (!event.canceled && event.operation.target && before.indexOf(key) !== after.indexOf(key)) {
          const index = after.indexOf(key), next = after[index + 1], previous = after[index - 1];
          if (next || previous) await onListMove({listId: Number(key.slice(5)), targetId: Number((next ?? previous).slice(5)), position: next ? 'before' : 'after'});
        }
      } finally { setListPreview(null); onDragging(false); window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-list-handle="${key.slice(5)}"]`)?.focus()); }
      return;
    }
    const before = initial.current, after = current.current;
    const key = String(event.operation.source?.id);
    initial.current = null; current.current = null; setDragging(false);
    try {
      if (event.canceled || !event.operation.target || !before || !after) return;
      const change = taskMoveFromOrder(key, before, after);
      if (change) await onMove(change);
    } finally {
      setPreview(null); onDragging(false);
      window.requestAnimationFrame(() => {
        const card = document.getElementById(`task-${key}`);
        if (card) card.focus();
        else document.getElementById('task-board-summary')?.focus();
      });
    }
  }}>
    <div ref={workspace} style={{ '--task-inbox-height': `${inboxHeight}px`, '--task-inbox-width': `${inboxWidth}px`, background: taskBackground(board.boards.find(item => item.scope === boardScope)?.color, '#e7e5e4') } as CSSProperties} className="flex h-[calc(100dvh-4rem)] min-h-0 min-w-0 flex-col gap-0 overflow-hidden bg-stone-200 p-0 md:min-h-[420px] md:flex-row" role="region" tabIndex={0} aria-label="Task workspace" aria-busy={disabled} onClickCapture={event => { if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); } }}>
      <section key={boardScope} aria-label={boardScope === 'school' ? 'School board' : 'Personal board'} className="order-1 flex min-h-0 min-w-0 flex-1 flex-col md:order-3">
        {header && <div className="min-h-14 shrink-0 border-b border-stone-300 bg-white/85">{header}</div>}
        <div ref={rail} className="task-scrollbar flex min-h-0 flex-1 items-start gap-3 overflow-auto p-3" role="region" tabIndex={0} aria-label="Task board">
          {(listPreview ?? listOrder).flatMap(id => { const column = columns.find(column => `list:${column.id}` === id); return column ? [renderColumn(String(column.id), column.title)] : []; })}
          <div hidden={draggingTask} className="w-[272px] shrink-0"><TaskContainerComposer disabled={disabled} onCreate={onAddList} /></div>
        </div>
      </section>
      <button type="button" role="separator" aria-label="Resize or hide Inbox" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={maxInboxHeight} aria-valuenow={inboxHeight} onPointerDown={resizeInbox} onKeyDown={event => { if (event.key === 'ArrowUp') { event.preventDefault(); setInboxHeight(value => Math.min(maxInboxHeight, Math.max(150, value + 24))); } if (event.key === 'ArrowDown') { event.preventDefault(); setInboxHeight(value => value <= 150 ? 0 : value - 24); } }} className="order-2 group flex h-7 shrink-0 touch-none cursor-row-resize items-center justify-center border-y border-slate-950/15 bg-slate-950/10 transition-colors hover:bg-slate-950/15 focus-visible:outline-2 focus-visible:outline-lime-700 md:hidden"><span aria-hidden="true" className="h-1 w-12 rounded-full bg-slate-950/35 transition-colors group-active:bg-slate-950/60" /></button>
      {renderColumn('inbox', 'Inbox', true)}
      <button type="button" role="separator" aria-label="Resize or hide Inbox" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={maxInboxWidth} aria-valuenow={inboxWidth} onPointerDown={resizeInboxWidth} onKeyDown={event => { if (event.key === 'ArrowLeft') { event.preventDefault(); setInboxWidth(value => value <= 240 ? 0 : value - 24); } if (event.key === 'ArrowRight') { event.preventDefault(); setInboxWidth(value => Math.min(maxInboxWidth, Math.max(240, value + 24))); } }} className="order-2 hidden w-3 shrink-0 touch-none cursor-col-resize items-center justify-center border-x border-slate-950/15 bg-slate-950/10 transition-colors hover:bg-slate-950/15 focus-visible:outline-2 focus-visible:outline-lime-700 md:flex md:order-2"><span aria-hidden="true" className="h-12 w-1 rounded-full bg-slate-950/35 transition-colors group-active:bg-slate-950/60" /></button>
    </div>
  </DragDropProvider>;
  function renderColumn(id: string, title: string, inbox = false) {
    const keys = shown[id] ?? [], listId = inbox ? null : Number(id);
    const list = columns.find(column => column.id === listId), index = (listPreview ?? listOrder).indexOf(`list:${listId}`);
    const statusSettings = inbox ? null : <div className="border-b border-white/10 px-2 pb-3 pt-2"><p className="mb-2 mt-0 text-xs font-semibold text-stone-400">Show tasks</p><div role="group" aria-label={`${title} task statuses`} className="flex gap-1">
      {(['in_progress', 'done'] as const).map(status => {
        const active = !hiddenStatuses[statusKey(id)]?.includes(status);
        return <button key={status} type="button" aria-pressed={active} disabled={disabled || dragging} onClick={() => toggleStatus(id, status)} className={`min-h-11 flex-1 rounded-lg px-2 text-sm font-semibold transition-colors disabled:opacity-50 ${active ? 'bg-blue-400/20 text-blue-200 ring-1 ring-inset ring-blue-400/40' : 'bg-white/5 text-stone-400 hover:bg-white/10'}`}>{status === 'done' ? 'Done' : 'In progress'}</button>;
      })}
    </div></div>;
    return <Column statusSettings={statusSettings} color={inbox ? board.inboxColor : list?.color ?? 'default'} index={index} onColor={color => onColor(inbox ? {target: 'inbox', color} : {target: 'list', listId: listId!, color})} onRemove={!inbox ? () => onRemoveList(listId!) : undefined} key={id} columnId={id} title={title} inbox={inbox} disabled={disabled} onCreate={(title, key) => onCreate(listId, title, key)}>
      {keys.map((key, index) => {
        const task = tasksByKey.get(key);
        if (!task) return null;
        return <SortableCard key={key} task={task} index={index} columnId={id} disabled={disabled}><TaskCard administrator={administrators.find(admin => admin.email.toLowerCase() === task.assignedTo?.toLowerCase())} task={preview ? { ...task, listId } : task} today={today} disabled={disabled || dragging || preview !== null} onStudent={onStudent} onEdit={onEdit} /></SortableCard>;
      })}
    </Column>;
  }
}
