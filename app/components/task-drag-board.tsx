"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DragDropProvider, KeyboardSensor, PointerSensor, useDroppable, type DragStartEvent, type DragOverEvent, type DragEndEvent } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import { Accessibility, PointerActivationConstraints } from '@dnd-kit/dom';
import { pointerIntersection } from '@dnd-kit/collision';
import { move as moveItems } from '@dnd-kit/helpers';
import type { BoardTask, TaskBoard, TaskStatus } from '../lib/tasks';
import { taskMoveFromOrder, type TaskMove, type TaskOrder } from '../lib/task-move';
import TaskCard, { type AutomaticAction } from './task-card';

const sensors = [PointerSensor.configure({
  activationConstraints: event => event.pointerType === 'touch'
    ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
    : [new PointerActivationConstraints.Distance({ value: 6 })],
}), KeyboardSensor];

// Prefer cards over their parent column for pointer drops. Keep keyboard
// collision priorities equal so arrow navigation can reach empty columns.
const columnCollision: typeof pointerIntersection = input => {
  const collision = pointerIntersection(input);
  return collision ? { ...collision, priority: 1 } : null;
};

function Column({ status, title, count, disabled, children }: { status: TaskStatus; title: string; count: number; disabled: boolean; children: ReactNode }) {
  const { ref, isDropTarget } = useDroppable({ id: status, accept: 'task', collisionDetector: columnCollision, disabled });
  return <section ref={ref} aria-labelledby={`column-${status}`} className={`min-w-0 rounded-xl border p-3 ${isDropTarget ? 'border-lime-600 bg-lime-50 ring-2 ring-lime-600' : 'border-stone-200 bg-stone-100'}`}>
    <h2 id={`column-${status}`} className="m-0 mb-3 flex items-center justify-between text-lg font-normal">{title}<span className="rounded-full bg-white px-2 py-1 font-sans text-xs">{count}</span></h2>
    <div className="min-h-28 space-y-3">{children}{count === 0 && <p className="py-6 text-center font-sans text-sm text-slate-500">No tasks. Drop a task here.</p>}</div>
  </section>;
}

function SortableCard({ task, index, status, disabled, children }: {
  task: BoardTask; index: number; status: TaskStatus; disabled: boolean; children: (handle: ReactNode) => ReactNode;
}) {
  const { ref, handleRef, isDragSource } = useSortable({ id: task.key, index, group: status, type: 'task', accept: 'task', collisionDetector: pointerIntersection, disabled, data: { title: task.title } });
  return <div ref={ref} id={`task-${task.key}`} data-dragging={isDragSource || undefined} className={isDragSource ? 'rounded-xl ring-2 ring-lime-600' : ''}>
    {children(<button ref={handleRef} type="button" disabled={disabled} aria-label={`Drag ${task.title}`} title="Drag to move; or use the movement controls below" onClick={event => { event.preventDefault(); event.stopPropagation(); }} className="min-h-11 min-w-11 shrink-0 touch-none select-none rounded-lg border border-stone-300 bg-white px-2 text-lg text-slate-500 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-lime-700 active:cursor-grabbing disabled:opacity-40 motion-reduce:transition-none" style={{ cursor: 'grab' }}><span aria-hidden="true">⠿</span></button>)}
  </div>;
}

export default function TaskDragBoard({ board, columns, visible, today, disabled, onDragging, onEdit, onStudent, onMove, onAction }: {
  board: TaskBoard; columns: TaskBoard['columns']; visible: BoardTask[]; today: string; disabled: boolean;
  onDragging: (dragging: boolean) => void; onEdit: (task: BoardTask) => void; onStudent: (id: number) => void; onMove: (change: TaskMove) => Promise<void>;
  onAction?: (task: BoardTask, action: AutomaticAction) => void;
}) {
  const [preview, setPreview] = useState<TaskOrder | null>(null);
  const [dragging, setDragging] = useState(false);
  const initial = useRef<TaskOrder | null>(null);
  const current = useRef<TaskOrder | null>(null);
  const order: TaskOrder = Object.fromEntries(columns.map(column => [column.status, visible.filter(task => task.status === column.status).sort((a, b) => a.sortOrder - b.sortOrder).map(task => task.key)]));
  const shown = preview ?? order;
  const tasksByKey = new Map(board.tasks.map(task => [task.key, task]));
  useEffect(() => () => onDragging(false), [onDragging]);
  const title = (id: unknown) => typeof id === 'string' ? tasksByKey.get(id)?.title ?? columns.find(column => column.status === id)?.title ?? 'task' : 'task';
  return <DragDropProvider sensors={sensors} plugins={defaults => [...defaults, Accessibility.configure({
    screenReaderInstructions: { draggable: 'To move a task, press Space or Enter on its drag handle, use the arrow keys, then press Space or Enter to drop. Escape cancels. You can also use the status selector and movement buttons on each task.' },
    announcements: {
      dragstart: (event: DragStartEvent) => `Picked up ${title(event.operation.source?.id)}.`,
      dragover: (event: DragOverEvent) => event.operation.target ? `Moving ${title(event.operation.source?.id)} over ${title(event.operation.target.id)}.` : 'Outside the board. Drop here to cancel.',
      dragend: (event: DragEndEvent) => event.canceled || !event.operation.target ? 'Move canceled.' : `Dropped ${title(event.operation.source?.id)}.`,
    },
  })]} onBeforeDragStart={event => { if (disabled) event.preventDefault(); }} onDragStart={() => {
    initial.current = order; current.current = order; setPreview(order); setDragging(true); onDragging(true);
  }} onDragOver={event => {
    if (!current.current) return;
    const next = moveItems(current.current as Record<string, string[]>, event);
    current.current = next; setPreview(next);
  }} onDragEnd={async event => {
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
        const handle = document.getElementById(`task-${key}`)?.querySelector<HTMLButtonElement>('button[aria-label^="Drag "]');
        if (handle && !handle.disabled) handle.focus();
        else document.getElementById('task-board-summary')?.focus();
      });
    }
  }}>
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3" aria-label="Task board" aria-busy={disabled}>
      {columns.map(column => {
        const keys = shown[column.status] ?? [];
        const all = board.tasks.filter(task => task.status === column.status).sort((a, b) => a.sortOrder - b.sortOrder);
        return <Column key={column.status} {...column} count={keys.length} disabled={disabled}>
          {keys.map((key, index) => {
            const task = tasksByKey.get(key);
            if (!task) return null;
            return <SortableCard key={key} task={task} index={index} status={column.status} disabled={disabled}>{handle => <TaskCard task={preview ? { ...task, status: column.status } : task} dragHandle={handle} categoryTitle={board.views?.find(view => view.key === task.category)?.title} onAction={onAction ? action => onAction(task, action) : undefined} columns={board.columns} today={today} previous={keys[index - 1]} next={keys[index + 1]} canTop={all[0]?.key !== key} canBottom={all.at(-1)?.key !== key} disabled={disabled || dragging || preview !== null} onEdit={() => onEdit(task)} onStudent={onStudent} onMove={change => void onMove(change)} />}</SortableCard>;
          })}
        </Column>;
      })}
    </div>
  </DragDropProvider>;
}
