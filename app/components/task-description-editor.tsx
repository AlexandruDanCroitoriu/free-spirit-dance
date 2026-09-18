"use client";

import { useEffect, useLayoutEffect, useRef, useState, useId, type ReactNode } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { descriptionDocument, serializeDescription } from '../lib/task-description';
import { TaskStudentMention, TaskCourseMention, TaskAdministratorMention, TaskEventMention, TaskMeetingMention } from './task-student-mention';
import { TaskImage } from './task-student-mention';
import type { TaskStudent } from '../lib/tasks';
import { compressImage } from '../lib/profile-image';

function MentionPopup({ editor, position, children, id, onPointerDown }: { editor: Editor; position: number; children: ReactNode; id: string; onPointerDown: () => void }) {
  const popup = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = popup.current!;
    element.showPopover();
    const place = () => {
      if (editor.isDestroyed) return;
      const caret = editor.view.coordsAtPos(position);
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      const below = top + height - caret.bottom - 12, above = caret.top - top - 12;
      const downward = below >= Math.min(220, above);
      element.style.width = `${Math.min(380, width - 24)}px`;
      element.style.maxHeight = `${Math.max(44, Math.min(260, downward ? below : above))}px`;
      element.style.left = `${Math.max(left + 12, Math.min(caret.left, left + width - element.offsetWidth - 12))}px`;
      element.style.top = `${downward ? caret.bottom + 6 : Math.max(top + 12, caret.top - element.offsetHeight - 6)}px`;
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      element.hidePopover();
    };
  }, [editor, position]);
  return <div ref={popup} popover="manual" role="listbox" aria-label="Task link suggestions" id={id} onPointerDownCapture={onPointerDown} className="fixed m-0 overflow-y-auto rounded-lg border border-white/20 bg-[#292a2c] p-1 font-sans text-sm text-stone-100 shadow-xl">{children}</div>;
}

export default function TaskDescriptionEditor({ value, onChange, disabled = false, readOnly = false, students = [], courses = [], administrators = [], events = [], meetings = [] }: {
  value: string; onChange?: (value: string) => void; disabled?: boolean; readOnly?: boolean; students?: TaskStudent[]; courses?: { id: number; name: string }[]; administrators?: { email: string; name: string; picture: string | null }[]; events?: { id: number; name: string; imagePath?: string | null }[]; meetings?: { id: number; eventId: number; name: string; eventName: string }[];
}) {
  const [dismissedQuery, setDismissedQuery] = useState('');
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [popupInteraction, setPopupInteraction] = useState(false);
  const [imageStatus, setImageStatus] = useState('');
  const [imageError, setImageError] = useState('');
  const suggestionId = useId();
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: false } }), TaskList, TaskItem.configure({ nested: true }), TaskStudentMention, TaskCourseMention, TaskAdministratorMention, TaskEventMention, TaskMeetingMention, TaskImage],
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    content: descriptionDocument(value),
    editable: !readOnly && !disabled,
    editorProps: {
      attributes: { class: 'task-rich-text outline-none', 'aria-label': 'Task description', ...(readOnly ? {} : { role: 'textbox', 'aria-multiline': 'true' }) },
    },
    onUpdate: ({ editor }) => { setActiveSuggestion(0); onChange?.(serializeDescription(editor.getJSON(), editor.isEmpty)); },
  });
  useEffect(() => { editor?.setEditable(!readOnly && !disabled); }, [editor, disabled, readOnly]);
  useEffect(() => {
    if (!popupInteraction) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (editor?.view.dom.contains(target) || document.getElementById(suggestionId)?.contains(target))) return;
      setPopupInteraction(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [editor, popupInteraction, suggestionId]);
  useEffect(() => { if (editor && !readOnly) editor.commands.focus('end'); }, [editor, readOnly]);
  useEffect(() => {
    if (readOnly && editor) editor.commands.setContent(descriptionDocument(value), { emitUpdate: false });
  }, [editor, value, readOnly]);
  useEffect(() => {
    if (!editor || editor.isDestroyed || (!administrators.length && !students.length)) return;
    const transaction = editor.state.tr;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === 'studentMention') {
        const student = students.find(person => person.id === node.attrs.id);
        if (student && (node.attrs.name !== student.name || node.attrs.picture !== student.picture)) transaction.setNodeMarkup(position, undefined, { ...node.attrs, name: student.name, picture: student.picture });
      } else if (node.type.name === 'administratorMention') {
        const administrator = administrators.find(person => person.email === node.attrs.id);
        if (administrator && node.attrs.picture !== administrator.picture) transaction.setNodeMarkup(position, undefined, { ...node.attrs, picture: administrator.picture });
      }
    });
    // Resolve photos for existing mentions without replacing the draft or
    // adding an automatic profile-image update to the user's undo history.
    if (transaction.docChanged) editor.view.dispatch(transaction.setMeta('addToHistory', false).setMeta('preventUpdate', true));
  }, [editor, administrators, students, value, readOnly]);
  if (!editor) return <div role="status" className="p-3 text-stone-400">Loading description…</div>;
  if (readOnly) return <EditorContent editor={editor} />;
  const { selection } = editor.state;
  const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '\n', '\ufffc');
  const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  // Only a slash command at a word boundary opens mention suggestions.
  type MentionChoice = { id: string | number; name: string; picture: string | null; kind: 'studentMention' | 'courseMention' | 'administratorMention' | 'eventMention' | 'meetingMention' };
  const choices: MentionChoice[] = [...students.map(student => ({ ...student, kind: 'studentMention' as const })), ...courses.map(course => ({ ...course, picture: null, kind: 'courseMention' as const })), ...administrators.map(admin => ({ ...admin, id: admin.email, kind: 'administratorMention' as const })), ...events.map(event => ({ ...event, picture: event.imagePath ?? null, kind: 'eventMention' as const })), ...meetings.map(meeting => ({ id: meeting.id, name: `${meeting.eventName} — ${meeting.name}`, picture: events.find(event => event.id === meeting.eventId)?.imagePath ?? null, kind: 'meetingMention' as const }))];
  let query = '', matches: MentionChoice[] = [];
  if (!disabled && (editor.isFocused || popupInteraction) && selection.empty && !editor.isActive('codeBlock') && !editor.isActive('link')) {
    const command = before.match(/(?:^|\s)(\/[^\/\n\ufffc]+)$/u)?.[1];
    const search = command?.slice(1).trim() ?? '';
    if (command && search.length >= 3) {
      query = command;
      const term = normalize(search);
      matches = choices.filter(choice => normalize(choice.name).includes(term) || (choice.kind === 'administratorMention' && normalize(String(choice.id)).includes(term)))
        .sort((a, b) => Number(b.kind === 'administratorMention') - Number(a.kind === 'administratorMention') || Number(normalize(b.name) === term) - Number(normalize(a.name) === term) || a.name.localeCompare(b.name));
    }
  }
  const queryKey = `${selection.from}:${query}`;
  const suggestions = query && queryKey !== dismissedQuery ? matches : [];
  const active = Math.min(activeSuggestion, Math.max(0, suggestions.length - 1));
  function insertStudent(student: MentionChoice) {
    if (!editor || disabled) return;
    editor.chain().focus().insertContentAt({ from: selection.from - query.length, to: selection.from }, [
      { type: student.kind, attrs: { id: student.id, name: student.name, ...(student.kind !== 'courseMention' ? { picture: student.picture } : {}) } }, { type: 'text', text: ' ' },
    ]).run();
    setActiveSuggestion(0);
  }
  async function uploadImage(file: File | undefined) {
    if (!file || !editor || editor.isDestroyed || !editor.isEditable || disabled || readOnly) return;
    setImageError('');
    setImageStatus('Uploading image…');
    try {
      const compressed = await compressImage(file, 'task-image.jpg');
      const form = new FormData(); form.append('file', compressed);
      const response = await fetch('/api/tasks/images', { method: 'POST', body: form });
      const result = await response.json().catch(() => null) as { id?: string; error?: string } | null;
      if (!response.ok || !result?.id) throw new Error(result?.error ?? 'Could not upload image.');
      if (!editor.isDestroyed && editor.isEditable) editor.chain().focus().insertContent({ type: 'taskImage', attrs: { id: result.id } }).run();
    } catch (reason) { setImageError(reason instanceof Error ? reason.message : 'Could not upload image.'); }
    finally { setImageStatus(''); }
  }
  function pasteChecklist(text: string) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const items = lines.map(line => /^\s*(?:[-*]\s*)?\[([ xX])\]\s+(.+)\s*$/u.exec(line));
    if (!items.length || items.some(item => item === null)) return false;
    editor.chain().focus().insertContent({ type: 'taskList', content: items.map(item => ({
      type: 'taskItem', attrs: { checked: item![1].toLowerCase() === 'x' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: item![2] }] }],
    })) }).run();
    return true;
  }
  const control = 'min-h-10 min-w-10 rounded px-2 text-sm hover:bg-white/10 aria-pressed:bg-blue-400/20 aria-pressed:text-blue-300 disabled:opacity-40';
  const actions = [
    { label: 'Bold', text: 'B', active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Italic', text: 'I', active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Underline', text: 'U', active: editor.isActive('underline'), run: () => editor.chain().focus().toggleUnderline().run() },
    { label: 'Bullet list', text: '• List', active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: 'Numbered list', text: '1. List', active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: 'Checkbox list', text: '☐ List', active: editor.isActive('taskList'), run: () => editor.chain().focus().toggleTaskList().run() },
    { label: 'Quote', text: '❝', active: editor.isActive('blockquote'), run: () => editor.chain().focus().toggleBlockquote().run() },
  ];
  return <div className="overflow-hidden rounded-md border border-white/25 bg-[#242528] focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400">
    <div role="group" aria-label="Description formatting" className="flex flex-wrap items-center gap-1 border-b border-white/10 p-1">
      <select aria-label="Text style" disabled={disabled} className={`${control} bg-[#242528] text-stone-100 [color-scheme:dark] [&>option]:bg-[#292a2c] [&>option]:text-stone-100`} value={editor.isActive('heading', { level: 2 }) ? 'heading' : 'paragraph'} onChange={event => event.target.value === 'heading' ? editor.chain().focus().setHeading({ level: 2 }).run() : editor.chain().focus().setParagraph().run()}><option value="paragraph">Text</option><option value="heading">Heading</option></select>
      {actions.map(action => <button key={action.label} type="button" title={action.label} aria-label={action.label} aria-pressed={action.active} disabled={disabled} className={control} onMouseDown={event => event.preventDefault()} onClick={action.run}>{action.text}</button>)}
      <button type="button" aria-label="Undo" className={control} disabled={disabled || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>↶</button>
      <button type="button" aria-label="Redo" className={control} disabled={disabled || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>↷</button>
      <label className={`${control} cursor-pointer`} title="Add image">Image<input className="sr-only" type="file" accept="image/*" disabled={disabled} onChange={event => { void uploadImage(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
    </div>
    <div className="min-h-60 p-4" onPasteCapture={event => {
      if (disabled || !editor.isEditable) return;
      if (pasteChecklist(event.clipboardData.getData('text/plain'))) {
        event.preventDefault(); event.stopPropagation();
        return;
      }
      // Read the original clipboard before the rich-text editor parses it.
      // File managers can supply an image file with an empty or generic MIME type.
      const files = [...Array.from(event.clipboardData.files), ...Array.from(event.clipboardData.items).flatMap(item => {
        const file = item.kind === 'file' ? item.getAsFile() : null;
        return file ? [file] : [];
      })];
      const image = files.find(file => file.type.startsWith('image/') || ((!file.type || file.type === 'application/octet-stream') && /\.(png|jpe?g|webp|gif|bmp|avif|svg|ico|tiff?)$/i.test(file.name)));
      if (image) {
        event.preventDefault(); event.stopPropagation();
        void uploadImage(image);
      } else if (files.length || /file:\/\//i.test(event.clipboardData.getData('text/uri-list')) || /<img\b[^>]*\bsrc\s*=\s*["']file:\/\//i.test(event.clipboardData.getData('text/html'))) {
        event.preventDefault(); event.stopPropagation();
        setImageError('The clipboard did not provide a readable image. Open the picture and copy the image, or use the Image button to choose the file.');
      }
    }} onKeyDownCapture={event => {
      if (!suggestions.length || event.nativeEvent.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setActiveSuggestion((active + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length); }
      else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); insertStudent(suggestions[active]); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissedQuery(queryKey); }
    }}><EditorContent editor={editor} />
      {suggestions.length > 0 && <MentionPopup editor={editor} position={selection.from} id={suggestionId} onPointerDown={() => setPopupInteraction(true)}>
        {suggestions.map((student, index) => <button key={`${student.kind}:${student.id}`} type="button" role="option" aria-selected={index === active} onPointerDown={event => event.preventDefault()} onClick={() => insertStudent(student)} className={`flex min-h-11 w-full items-center gap-2 rounded-md p-2 text-left ${index === active ? 'bg-green-800 text-green-50' : 'hover:bg-white/10'}`}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-200 text-xs text-slate-900">{student.picture ? <img src={student.picture} alt="" className="h-full w-full object-cover" /> : student.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('')}</span>{student.name}
          <span className="ml-auto text-xs opacity-70">{student.kind === 'administratorMention' ? 'Administrator' : student.kind === 'courseMention' ? 'Course' : student.kind === 'eventMention' ? 'Event' : student.kind === 'meetingMention' ? 'Meeting' : 'Student'}</span>
        </button>)}
      </MentionPopup>}
    </div>
    {imageStatus && <p role="status" className="px-4 text-stone-300">{imageStatus}</p>}
    {imageError && <p role="alert" className="px-4 text-red-300">{imageError}</p>}
    {value.length > 50000 && <p role="alert" className="px-4 text-red-300">Description is too long to save. Shorten the text or simplify its formatting.</p>}
  </div>;
}
