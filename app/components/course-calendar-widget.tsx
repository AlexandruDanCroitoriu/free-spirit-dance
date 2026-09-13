"use client";

import { type PracticeSession, sessionEnd } from "../lib/practice-parties";
import { readJson } from "../lib/http";
import { useEffect, useMemo, useRef, useState } from "react";
import CalendarDayPanel from "./calendar-day-panel";
import PracticePartyPanel from "./practice-party-panel";
import ClassAttendancePanel from "./class-attendance-panel";
import StudentPanel from "./student-panel";
import { schoolToday } from "../lib/student-activity";
import { weekdays, type Course } from "../lib/courses";

type ClassSlot = { startDate: string | null; endDate: string | null; courseId: number; courseName: string; day: string; startTime: string; endTime: string };
type SelectedClass = { course: Course; date: Date; slot: ClassSlot };
type ApiError = { error?: string };
type Student = { id: number; firstName: string; lastName: string; picture: string | null; active: boolean };
type StudentCalendarEvent = { date: string; kind: "attendance" | "missed" | "payment"; courseName: string | null; count: number; paymentId: number | null; complimentary: number; coveredClasses?: { courseName: string; startsAt: string }[] };
type CoverageLine = { key: string; x1: number; y1: number; x2: number; y2: number };
type HoveredPayment = { event: StudentCalendarEvent; element: HTMLElement; studentId?: number };

const dayLabels: Record<string, string> = { Monday: "Luni", Tuesday: "Marți", Wednesday: "Miercuri", Thursday: "Joi", Friday: "Vineri", Saturday: "Sâmbătă", Sunday: "Duminică" };
const monthStorageKey = "fsd-calendar-month";
const viewStorageKey = "fsd-calendar-view";
const studentStorageKey = "fsd-calendar-student";
const studentsStorageKey = "fsd-calendar-students";
const coursesStorageKey = "fsd-calendar-courses";
const yearsStorageKey = "fsd-calendar-years";
const rangeStorageKey = "fsd-calendar-range";
type CalendarRange = "month" | "year" | "years";
// Temporary personal testing group; remove once the attendance-matrix review is complete.
const attendanceTestStudentIds = [92, 81, 137, 101, 53, 124, 37, 87, 91, 138, 150, 78, 114, 99, 63, 122, 89, 96, 43, 86, 140, 82, 65, 40, 60, 44, 35, 85, 70, 52, 56, 134, 71, 29, 145, 18];
const intermediatesGroupStudentIds = [92, 81, 101, 130, 52, 128, 96, 44, 49, 108, 143, 56, 129, 43, 70, 133, 58, 145, 75, 80, 88, 144, 83, 141, 45, 73, 97, 119];
const beginners2025StudentIds = [107, 28, 38, 122, 117, 25, 23, 40, 79, 127, 47, 65, 26, 104, 55, 54, 51, 39, 101, 81, 37, 91, 124, 92, 137, 53, 87];
const intermediates2025StudentIds = [52, 40, 49, 137, 96, 125, 44, 130, 53, 108, 144, 81, 79, 92, 47, 101, 143, 128];
const attendancePresets = [
  { name: "Beginners · 2024", course: "Beginners", year: 2024, studentIds: [18, 29, 35, 37, 40, 43, 44, 52, 53, 56, 60, 63, 65, 70, 71, 78, 81, 82, 85, 87, 89, 91, 92, 96, 99, 101, 114, 122, 124, 134, 137, 138, 140, 145, 150] },
  { name: "Beginners · 2025", course: "Beginners", year: 2025, studentIds: [23, 25, 28, 37, 38, 39, 40, 47, 51, 53, 54, 55, 65, 81, 87, 91, 92, 101, 104, 107, 117, 122, 124, 127, 137] },
  { name: "Beginners · 2026", course: "Beginners", year: 2026, studentIds: [19, 27, 32, 38, 69, 95, 109, 131, 135] },
  { name: "Intermediates · 2023", course: "Intermediates", year: 2023, studentIds: [45, 49, 58, 73, 75, 80, 83, 88, 97, 119, 128, 129, 130, 141, 143, 144] },
  { name: "Intermediates · 2024", course: "Intermediates", year: 2024, studentIds: [43, 49, 52, 56, 58, 70, 73, 75, 80, 96, 97, 108, 128, 129, 130, 133, 143, 145] },
  { name: "Intermediates · 2025", course: "Intermediates", year: 2025, studentIds: [40, 44, 47, 49, 52, 53, 56, 79, 81, 92, 96, 101, 108, 125, 128, 130, 137, 143, 144] },
  { name: "Intermediates · 2026", course: "Intermediates", year: 2026, studentIds: [19, 34, 38, 49, 53, 96, 106, 108, 118, 130, 135, 137, 144, 145, 146] },
] as const;
const namedPresets = [
  { name: "incepatori 26", course: "Beginners", year: 2026, studentIds: [19, 27, 32, 38, 69, 95, 109, 131, 135] },
  { name: "intermed 26", course: "Intermediates", year: 2026, studentIds: [19, 34, 38, 46, 49, 53, 96, 106, 108, 118, 130, 135, 137, 144, 145, 146] },
  { name: "Prezenta grupa intermediari 2025", course: "Intermediates", year: 2025, studentIds: intermediates2025StudentIds },
  { name: "Prezenta Grupa Mica 2025", course: "Beginners", year: 2025, studentIds: beginners2025StudentIds },
  { name: "Prezenta grupa intermediari", course: "Intermediates", year: 2023, studentIds: intermediatesGroupStudentIds, years: [2023, 2024] },
  { name: "Prezenta Grupa Mica", course: "Beginners", year: 2024, studentIds: attendanceTestStudentIds, years: [2024, 2025] },
] as const;

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function sameDate(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth() && first.getDate() === second.getDate();
}

function displayTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes));
}

function studentEventLabel(event: StudentCalendarEvent) {
  if (event.kind === "payment") return `${event.count} ${event.count === 1 ? "payment" : "payments"}`;
  const classes = `${event.count} ${event.count === 1 ? "class" : "classes"}`;
  return `${event.courseName ?? "Class"} · ${classes} ${event.kind === "attendance" ? "attended" : "missed"}`;
}

function studentEventColor(event: StudentCalendarEvent) {
  return event.kind === "payment" ? "border-cyan-300 bg-cyan-100 text-cyan-900" : event.kind === "attendance" ? event.complimentary ? "border-emerald-400 bg-emerald-100 text-emerald-950 shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "border-lime-300 bg-lime-100 text-lime-900" : "border-orange-300 bg-orange-100 text-orange-900";
}

export default function CourseCalendarWidget() {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedPractice, setSelectedPractice] = useState<number | null>(null);
  const [eventSessions, setEventSessions] = useState<PracticeSession[]>([]);
  const [canOpenEvents, setCanOpenEvents] = useState(false);
  const [eventError, setEventError] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [calendarReload, setCalendarReload] = useState(0);
  const [visibleMonth, setVisibleMonth] = useState(() => { const date = new Date(schoolToday() + "T12:00:00"); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const [monthRestored, setMonthRestored] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedClass, setSelectedClass] = useState<SelectedClass | null>(null);
  const [calendarMode, setCalendarMode] = useState<"school" | "student">("school");
  const [calendarModeBeforeYears, setCalendarModeBeforeYears] = useState<"school" | "student">("school");
  const [calendarRange, setCalendarRange] = useState<CalendarRange>("month");
  const [isDesktop, setIsDesktop] = useState(false);
  const [viewportReady, setViewportReady] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<number[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [studentEvents, setStudentEvents] = useState<StudentCalendarEvent[]>([]);
  const [multipleStudentEvents, setMultipleStudentEvents] = useState<Record<number, StudentCalendarEvent[]>>({});
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const studentSearchInput = useRef<HTMLInputElement>(null);
  const studentPickerRef = useRef<HTMLDivElement>(null);
  const presetMenuRef = useRef<HTMLDivElement>(null);
  const courseFilterRef = useRef<HTMLDetailsElement>(null);
  const yearFilterRef = useRef<HTMLDetailsElement>(null);
  const [openedAttendanceDate, setOpenedAttendanceDate] = useState<string | null>(null);
  const [openedPaymentId, setOpenedPaymentId] = useState<number | null>(null);
  const [hoveredPayment, setHoveredPayment] = useState<HoveredPayment | null>(null);
  const [showPaymentCoverage, setShowPaymentCoverage] = useState(false);
  const [coverageLines, setCoverageLines] = useState<CoverageLine[]>([]);
  const [matrixScrollOffsets, setMatrixScrollOffsets] = useState<Record<string, number>>({});
  const [selectedMatrixStudentId, setSelectedMatrixStudentId] = useState<number | null>(null);
  const selectedMatrixRowRef = useRef<HTMLTableRowElement | null>(null);
  const calendarBodyRef = useRef<HTMLDivElement>(null);
  const activityCardRefs = useRef(new Map<string, HTMLElement>());
  const paymentCardRefs = useRef(new Map<number | string, HTMLElement>());
  const matrixActivityCardRefs = useRef(new Map<string, HTMLElement>());
  const matrixPaymentCardRefs = useRef(new Map<string, HTMLElement>());
  const courseSelectionInitialized = useRef(false);
  const yearSelectionInitialized = useRef(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const updateDesktop = () => setIsDesktop(desktop.matches);
    updateDesktop();
    setViewportReady(true);
    desktop.addEventListener("change", updateDesktop);
    return () => desktop.removeEventListener("change", updateDesktop);
  }, []);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(monthStorageKey);
      if (saved && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(saved)) {
        const [year, month] = saved.split("-").map(Number);
        setVisibleMonth(new Date(year, month - 1, 1));
      }
      const savedView = window.localStorage.getItem(viewStorageKey);
      if (savedView === "school" || savedView === "student") { setCalendarMode(savedView); setCalendarModeBeforeYears(savedView); }
      const savedRange = window.localStorage.getItem(rangeStorageKey);
      if (savedRange === "month" || savedRange === "year" || savedRange === "years") {
        setCalendarRange(savedRange);
        if (savedRange === "years") setCalendarMode("student");
      }
      const savedStudent = Number(window.localStorage.getItem(studentStorageKey));
      if (Number.isInteger(savedStudent) && savedStudent > 0) setSelectedStudentId(savedStudent);
      const savedStudents = JSON.parse(window.localStorage.getItem(studentsStorageKey) ?? "[]") as unknown;
      if (Array.isArray(savedStudents)) setSelectedStudentIds([...new Set(savedStudents.filter((id): id is number => Number.isInteger(id) && id > 0))]);
      const savedCourses = window.localStorage.getItem(coursesStorageKey);
      if (savedCourses !== null) { const values = JSON.parse(savedCourses) as unknown; if (Array.isArray(values)) { setSelectedCourseIds([...new Set(values.filter((id): id is number => Number.isInteger(id) && id > 0))]); courseSelectionInitialized.current = true; } }
      const savedYears = window.localStorage.getItem(yearsStorageKey);
      if (savedYears !== null) { const values = JSON.parse(savedYears) as unknown; if (Array.isArray(values)) { setSelectedYears([...new Set(values.filter((year): year is number => Number.isInteger(year) && year >= 1900 && year <= 9999))]); yearSelectionInitialized.current = true; } }
    } catch { /* Keep the current month when browser storage is unavailable. */ }
    setMonthRestored(true);
  }, []);

  function changeCalendarRange(range: CalendarRange) {
    if (range === "years") {
      setCalendarModeBeforeYears(calendarMode);
      setCalendarMode("student");
    } else if (calendarRange === "years") {
      setCalendarMode(calendarModeBeforeYears);
    }
    setCalendarRange(range);
  }
  useEffect(() => {
    if (calendarRange !== "years") setCalendarModeBeforeYears(calendarMode);
  }, [calendarRange, calendarMode]);
  useEffect(() => {
    if (viewportReady && !isDesktop && calendarRange === "years" && selectedYears.length > 1) setSelectedYears([Math.max(...selectedYears)]);
  }, [viewportReady, isDesktop, calendarRange, selectedYears]);

  useEffect(() => {
    if (!monthRestored) return;
    try {
      window.localStorage.setItem(monthStorageKey, `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`);
    } catch { /* Calendar navigation still works without browser storage. */ }
  }, [visibleMonth, monthRestored]);

  useEffect(() => {
    if (!monthRestored) return;
    try {
      window.localStorage.setItem(viewStorageKey, calendarRange === "years" ? calendarModeBeforeYears : calendarMode);
      window.localStorage.setItem(rangeStorageKey, calendarRange);
      if (selectedStudentId !== null) window.localStorage.setItem(studentStorageKey, String(selectedStudentId));
      else window.localStorage.removeItem(studentStorageKey);
      window.localStorage.setItem(studentsStorageKey, JSON.stringify(selectedStudentIds));
      window.localStorage.setItem(coursesStorageKey, JSON.stringify(selectedCourseIds));
      window.localStorage.setItem(yearsStorageKey, JSON.stringify(selectedYears));
    } catch { /* Selection still works without browser storage. */ }
  }, [calendarMode, calendarModeBeforeYears, calendarRange, selectedStudentId, selectedStudentIds, selectedCourseIds, selectedYears, monthRestored]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch("/api/calendar", { signal: controller.signal }).then(async (response) => {
      const data = await readJson<Course[] | ApiError>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) && data.error ? data.error : "Could not load the course calendar.");
      if (!controller.signal.aborted) setCourses(data);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the course calendar."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [calendarReload]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/students", { signal: controller.signal }).then(async response => {
      const data = await readJson<Student[] | ApiError>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) && data.error ? data.error : "Could not load students.");
      if (!controller.signal.aborted) setStudents(data.filter(student => student.active).sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)));
    }).catch(() => { /* School calendar remains available if the directory is unavailable. */ });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const refresh = () => setCalendarReload((value) => value + 1);
    window.addEventListener("calendar-updated", refresh);
    return () => window.removeEventListener("calendar-updated", refresh);
  }, []);
  useEffect(() => {
    const selectMatrixDay = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const dateCell = target?.closest<HTMLTableCellElement>("th[scope='row']");
      if (!dateCell || !calendarBodyRef.current?.contains(dateCell)) return;
      const row = dateCell.closest<HTMLTableRowElement>("tr");
      if (!row) return;
      if (selectedMatrixRowRef.current === row) {
        row.classList.remove("matrix-selected-day");
        selectedMatrixRowRef.current = null;
        return;
      }
      selectedMatrixRowRef.current?.classList.remove("matrix-selected-day");
      row.classList.add("matrix-selected-day");
      selectedMatrixRowRef.current = row;
    };
    document.addEventListener("click", selectMatrixDay);
    return () => document.removeEventListener("click", selectMatrixDay);
  }, []);
  useEffect(() => {
    if (!studentPickerOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (!studentPickerRef.current?.contains(event.target as Node)) setStudentPickerOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [studentPickerOpen]);
  useEffect(() => {
    if (!presetMenuOpen) return;
    const closeOutside = (event: MouseEvent) => { if (!presetMenuRef.current?.contains(event.target as Node)) setPresetMenuOpen(false); };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [presetMenuOpen]);
  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (courseFilterRef.current?.open && !courseFilterRef.current.contains(event.target as Node)) courseFilterRef.current.open = false;
      if (yearFilterRef.current?.open && !yearFilterRef.current.contains(event.target as Node)) yearFilterRef.current.open = false;
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, []);

  const today = useMemo(() => new Date(schoolToday() + "T12:00:00"), []);
  const firstDayOffset = (visibleMonth.getDay() + 6) % 7;
  const gridStart = addDays(visibleMonth, -firstDayOffset);
  const yearStart = new Date(visibleMonth.getFullYear(), 0, 1);
  const calendarStart = calendarRange === "year" ? yearStart : gridStart;
  const calendarLength = calendarRange === "year" ? (new Date(visibleMonth.getFullYear() + 1, 0, 1).getTime() - yearStart.getTime()) / 86400000 : 42;
  const calendarDates = Array.from({ length: calendarLength }, (_, index) => addDays(calendarStart, index));
  const from = calendarRange === "years" ? "1900-01-01" : calendarDates[0].getFullYear() + '-' + String(calendarDates[0].getMonth() + 1).padStart(2, '0') + '-' + String(calendarDates[0].getDate()).padStart(2, '0');
  const last = calendarDates[calendarDates.length - 1];
  const to = calendarRange === "years" ? `${today.getFullYear() + 5}-12-31` : last.getFullYear() + '-' + String(last.getMonth() + 1).padStart(2, '0') + '-' + String(last.getDate()).padStart(2, '0');
  useEffect(() => {
    const controller = new AbortController(); setEventError('');
    fetch(`/api/practice-calendar?from=${from}&to=${to}${calendarRange === "years" ? "&all=true" : ""}`, { signal: controller.signal }).then(async response => {
      const body = await response.json() as { sessions: PracticeSession[]; canOpen: boolean; error?: string }; if (!response.ok) throw new Error(body.error ?? 'Could not load events.');
      if (!controller.signal.aborted) { setEventSessions(body.sessions); setCanOpenEvents(body.canOpen); }
    }).catch(e => { if (!controller.signal.aborted) setEventError(e.message); });
    return () => controller.abort();
  }, [from, to, calendarRange, calendarReload]);
  useEffect(() => {
    if (calendarMode !== "student" || selectedStudentId === null) { setStudentEvents([]); return; }
    const controller = new AbortController();
    fetch(`/api/student-calendar?studentId=${selectedStudentId}&from=${from}&to=${to}${calendarRange === "years" ? "&all=true" : ""}`, { signal: controller.signal }).then(async response => {
      const body = await readJson<{ events: StudentCalendarEvent[] } | ApiError>(response);
      if (!response.ok || !("events" in body)) throw new Error("Could not load student calendar.");
      if (!controller.signal.aborted) setStudentEvents(body.events);
    }).catch(() => { if (!controller.signal.aborted) setStudentEvents([]); });
    return () => controller.abort();
  }, [calendarMode, selectedStudentId, from, to, calendarRange]);
  useEffect(() => {
    if (calendarRange !== "years" || calendarMode !== "student" || selectedStudentIds.length === 0) { setMultipleStudentEvents({}); return; }
    const controller = new AbortController();
    Promise.all(selectedStudentIds.map(async (studentId) => {
      const response = await fetch(`/api/student-calendar?studentId=${studentId}&from=${from}&to=${to}&all=true`, { signal: controller.signal });
      const body = await readJson<{ events: StudentCalendarEvent[] } | ApiError>(response);
      if (!response.ok || !("events" in body)) throw new Error("Could not load student calendar.");
      return [studentId, body.events] as const;
    })).then((entries) => { if (!controller.signal.aborted) setMultipleStudentEvents(Object.fromEntries(entries)); }).catch(() => { if (!controller.signal.aborted) setMultipleStudentEvents({}); });
    return () => controller.abort();
  }, [calendarRange, calendarMode, selectedStudentIds, from, to]);
  useEffect(() => {
    if (!calendarBodyRef.current) { setCoverageLines([]); return; }
    const payments: HoveredPayment[] = hoveredPayment ? [hoveredPayment] : !showPaymentCoverage ? [] : calendarRange === "years"
      ? selectedMatrixStudents.flatMap((student) => (multipleStudentEvents[student.id] ?? []).filter((event) => event.kind === "payment" && event.paymentId !== null).flatMap((event) => {
          const element = matrixPaymentCardRefs.current.get(`${student.id}|${event.paymentId}`);
          return element ? [{ event, element, studentId: student.id }] : [];
        }))
      : studentEvents.filter((event) => event.kind === "payment" && event.paymentId !== null).flatMap((event) => {
          const element = paymentCardRefs.current.get(event.paymentId!) ?? paymentCardRefs.current.get(`${event.date}|${event.courseName}`);
          return element ? [{ event, element }] : [];
        });
    if (!payments.length) { setCoverageLines([]); return; }
    const updateLines = () => {
      const body = calendarBodyRef.current;
      if (!body) return;
      const bodyRect = body.getBoundingClientRect();
      const lines = payments.flatMap((payment) => {
        const paymentRect = payment.element.getBoundingClientRect();
        const x1 = paymentRect.left + paymentRect.width / 2 - bodyRect.left;
        const y1 = paymentRect.top + paymentRect.height / 2 - bodyRect.top;
        return (payment.event.coveredClasses ?? []).flatMap((covered) => {
          const key = `${covered.startsAt.slice(0, 10)}|${covered.courseName}`;
          const target = payment.studentId === undefined
            ? activityCardRefs.current.get(key)
            : matrixActivityCardRefs.current.get(`${payment.studentId}|${key}`);
          if (!target) return [];
          const targetRect = target.getBoundingClientRect();
          return [{ key: `${payment.studentId ?? "student"}|${payment.event.paymentId}|${covered.startsAt}|${covered.courseName}`, x1, y1, x2: targetRect.left + targetRect.width / 2 - bodyRect.left, y2: targetRect.top + targetRect.height / 2 - bodyRect.top }];
        });
      });
      setCoverageLines(lines);
    };
    updateLines();
    window.addEventListener("resize", updateLines);
    return () => window.removeEventListener("resize", updateLines);
  }, [hoveredPayment, showPaymentCoverage, studentEvents, multipleStudentEvents, selectedStudentIds, students, calendarRange, visibleMonth]);
  useEffect(() => {
    const toggleGlow = (element: HTMLElement, active: boolean) => ["ring-2", "ring-emerald-500", "shadow-[0_0_8px_rgba(16,185,129,0.9)]", "relative", "z-10"].forEach((name) => element.classList.toggle(name, active));
    const matrixKeys = new Set(Object.entries(multipleStudentEvents).flatMap(([studentId, events]) => events.filter((event) => event.kind === "attendance" && event.complimentary).map((event) => `${studentId}|${event.date}|${event.courseName}`)));
    for (const [key, element] of matrixActivityCardRefs.current) toggleGlow(element, matrixKeys.has(key));
    const cardKeys = new Set(studentEvents.filter((event) => event.kind === "attendance" && event.complimentary).map((event) => `${event.date}|${event.courseName}`));
    for (const [key, element] of activityCardRefs.current) toggleGlow(element, cardKeys.has(key));
  }, [multipleStudentEvents, studentEvents, calendarRange, visibleMonth]);
  const slots = courses.flatMap<ClassSlot>((course) =>
    course.schedules.map((schedule) => ({ courseId: course.id, courseName: course.name, startDate: course.startDate, endDate: course.endDate, ...schedule }))
  ).sort((first, second) => first.startTime.localeCompare(second.startTime) || first.courseName.localeCompare(second.courseName));
  function schoolSlotsOn(dateKey: string, day: string) {
    const daySlots = slots.filter((slot) => dateKey >= schoolToday() && slot.day === day && (!slot.startDate || dateKey >= slot.startDate) && (!slot.endDate || dateKey <= slot.endDate));
    for (const course of courses) for (const occurrence of course.occurrences ?? []) {
      if (occurrence.classDate !== dateKey) continue;
      const existing = daySlots.findIndex((slot) => slot.courseId === course.id && slot.startTime === occurrence.startTime);
      const recorded = { courseId: course.id, courseName: course.name, day, startTime: occurrence.startTime, endTime: occurrence.endTime ?? "", startDate: course.startDate, endDate: course.endDate };
      if (existing >= 0) daySlots[existing] = recorded; else daySlots.push(recorded);
    }
    return daySlots.sort((first, second) => first.startTime.localeCompare(second.startTime) || first.courseName.localeCompare(second.courseName));
  }
  function cancelledSlotsOn(dateKey: string) {
    return courses.flatMap((course) => (course.occurrences ?? [])
      .filter((occurrence) => occurrence.cancelled && occurrence.classDate === dateKey)
      .map((occurrence) => ({ courseId: course.id, courseName: course.name, startTime: occurrence.startTime, endTime: occurrence.endTime ?? "" })))
      .sort((first, second) => first.startTime.localeCompare(second.startTime) || first.courseName.localeCompare(second.courseName));
  }
  const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(visibleMonth);
  const months = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(2000, month, 1)));
  const courseYears = courses.flatMap((course) => [course.startDate, course.endDate, ...(course.occurrences ?? []).map((occurrence) => occurrence.classDate)])
    .filter((date): date is string => Boolean(date)).map((date) => Number(date.slice(0, 4)));
  const firstYear = Math.min(2024, today.getFullYear(), visibleMonth.getFullYear(), ...courseYears);
  const lastYear = Math.max(today.getFullYear() + 5, visibleMonth.getFullYear(), ...courseYears);
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index);
  const selectedStudent = students.find(student => student.id === selectedStudentId) ?? null;
  const filteredStudents = students.filter((student) => `${student.firstName} ${student.lastName}`.toLocaleLowerCase().includes(studentSearch.trim().toLocaleLowerCase()));
  const visiblePaymentEvents = hoveredPayment ? [hoveredPayment.event] : showPaymentCoverage ? studentEvents.filter((event) => event.kind === "payment") : [];
  const coveredCardKeys = new Set(visiblePaymentEvents.flatMap((event) => (event.coveredClasses ?? []).map((item) => `${item.startsAt.slice(0, 10)}|${item.courseName}`)));
  function changeMonth(amount: number) { setVisibleMonth((current) => new Date(current.getFullYear() + (calendarRange === "year" || calendarRange === "years" ? amount : 0), current.getMonth() + (calendarRange === "month" ? amount : 0), 1)); }
  function applyPreset(preset: { course: string; year: number; studentIds: readonly number[]; years?: readonly number[] }) {
    setSelectedStudentIds([...preset.studentIds]);
    setSelectedYears(isDesktop ? [...(preset.years ?? [preset.year])] : [preset.year]);
    setSelectedCourseIds(courses.filter((course) => course.name === preset.course).map((course) => course.id));
    setPresetMenuOpen(false);
  }
  const schoolActivityYears = [...new Set(courses.flatMap((course) => {
    const occurrenceYears = (course.occurrences ?? []).map((occurrence) => Number(occurrence.classDate.slice(0, 4)));
    const startYear = course.startDate ? Number(course.startDate.slice(0, 4)) : Math.min(...occurrenceYears);
    const endYear = course.endDate ? Number(course.endDate.slice(0, 4)) : Math.max(...occurrenceYears);
    return Number.isFinite(startYear) && Number.isFinite(endYear) ? Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index) : occurrenceYears;
  }))].sort((first, second) => second - first);
  const selectedMatrixStudents = selectedStudentIds.map((id) => students.find((student) => student.id === id)).filter((student): student is Student => Boolean(student));
  const selectedCourseLabel = courses.filter((course) => selectedCourseIds.includes(course.id)).map((course) => course.name).join(", ") || "No courses";
  const selectedYearLabel = [...selectedYears].sort((first, second) => first - second).join(", ") || "No years";
  const studentActivityYears = [...new Set(Object.values(multipleStudentEvents).flatMap((events) => events.map((event) => Number(event.date.slice(0, 4)))))].sort((first, second) => second - first);
  const multiYears = calendarMode === "student" ? studentActivityYears : schoolActivityYears;
  const selectableYears = [...new Set([...schoolActivityYears, ...studentActivityYears])].sort((first, second) => second - first);
  useEffect(() => {
    if (calendarRange !== "years" || courseSelectionInitialized.current || courses.length === 0) return;
    setSelectedCourseIds(courses.map((course) => course.id));
    courseSelectionInitialized.current = true;
  }, [calendarRange, courses]);
  useEffect(() => {
    if (!viewportReady || calendarRange !== "years" || yearSelectionInitialized.current || multiYears.length === 0) return;
    setSelectedYears(isDesktop ? multiYears : [multiYears[0]]);
    yearSelectionInitialized.current = true;
  }, [viewportReady, calendarRange, isDesktop, multiYears]);
  function renderYearMonth(year: number, month: number) {
    const firstDate = new Date(year, month, 1);
    const leadingDays = (firstDate.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return <section key={month} className="overflow-hidden rounded-lg border border-stone-300 bg-white">
      <h3 className="border-b border-stone-200 bg-stone-50 py-1 text-center font-sans text-xs font-bold text-slate-700">{months[month]}</h3>
      <div className="calendar-grid border-b border-stone-200 bg-stone-50">{weekdays.map((day) => <div className="py-1 text-center font-sans text-[8px] font-bold uppercase text-slate-400" key={day}>{dayLabels[day].slice(0, 1)}</div>)}</div>
      <div className="calendar-grid">{Array.from({ length: leadingDays }, (_, index) => <div className="min-h-10 border-b border-r border-stone-100 bg-stone-50/60" key={`blank-${index}`} />)}{Array.from({ length: daysInMonth }, (_, index) => {
        const date = new Date(year, month, index + 1); const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const day = weekdays[(date.getDay() + 6) % 7]; const dayStudentEvents = studentEvents.filter((item) => item.date === dateKey);
        const daySlots = calendarMode === "school" ? schoolSlotsOn(dateKey, day) : [];
        const cancelledSlots = calendarMode === "student" ? cancelledSlotsOn(dateKey) : [];
        const current = sameDate(date, today);
        return <div className={`relative min-h-10 border-b border-r border-stone-100 p-0.5 ${current ? "bg-lime-50" : "bg-white"}`} key={dateKey}><span className={`block text-[8px] font-semibold ${current ? "text-lime-700" : "text-slate-500"}`}>{date.getDate()}</span><div className="mt-0.5 space-y-0.5">{calendarMode === "student" && selectedStudentId !== null && dayStudentEvents.map((event, eventIndex) => { const cardKey = `${event.date}|${event.courseName}`; const covered = event.kind !== "payment" && coveredCardKeys.has(cardKey); const common = `relative z-20 block w-full rounded border px-0.5 py-px text-left font-sans text-[7px] font-bold leading-tight ${covered ? "ring-1 ring-cyan-500" : ""} ${studentEventColor(event)}`; return event.kind === "attendance" ? <button type="button" key={`${event.kind}-${event.courseName}-${eventIndex}`} ref={(element) => { if (element) activityCardRefs.current.set(cardKey, element); else activityCardRefs.current.delete(cardKey); }} onClick={() => setOpenedAttendanceDate(dateKey)} className={common} title={studentEventLabel(event)}>A</button> : <div key={`${event.kind}-${event.courseName}-${eventIndex}`} ref={event.kind === "missed" ? (element) => { if (element) activityCardRefs.current.set(cardKey, element); else activityCardRefs.current.delete(cardKey); } : event.kind === "payment" ? (element) => { if (element && event.paymentId !== null) paymentCardRefs.current.set(cardKey, element); else if (event.paymentId !== null) paymentCardRefs.current.delete(cardKey); } : undefined} className={common} title={studentEventLabel(event)} role={event.kind === "payment" ? "button" : undefined} onClick={event.kind === "payment" && event.paymentId !== null ? () => setOpenedPaymentId(event.paymentId) : undefined} onKeyDown={event.kind === "payment" && event.paymentId !== null ? (key) => { if (key.key === "Enter" || key.key === " ") { key.preventDefault(); setOpenedPaymentId(event.paymentId!); } } : undefined} onBlur={() => setHoveredPayment(null)} onFocus={event.kind === "payment" ? (focus) => setHoveredPayment({ event, element: focus.currentTarget }) : undefined} onMouseEnter={event.kind === "payment" ? (hover) => setHoveredPayment({ event, element: hover.currentTarget }) : undefined} onMouseLeave={event.kind === "payment" ? () => setHoveredPayment(null) : undefined} tabIndex={event.kind === "payment" ? 0 : undefined}>{event.kind === "payment" ? "P" : "M"}</div>; })}{calendarMode === "student" && cancelledSlots.map((slot) => <span key={`${slot.courseId}-${slot.startTime}`} className="block w-full truncate rounded border border-stone-300 bg-stone-100 px-0.5 py-px text-left font-sans text-[7px] font-bold leading-tight text-stone-500" title={`${slot.courseName} · Cancelled · ${displayTime(slot.startTime)}–${displayTime(slot.endTime)}`}>C</span>)}{calendarMode === "school" && daySlots.map((slot) => { const cancelled = courses.find((course) => course.id === slot.courseId)?.cancellations?.some((item) => item.classDate === dateKey && item.startTime === slot.startTime); return <button type="button" key={`${slot.courseId}-${slot.startTime}`} className={`block w-full truncate rounded border px-0.5 py-px text-left font-sans text-[7px] font-bold leading-tight ${cancelled ? "border-stone-300 bg-stone-100 text-stone-500" : "border-lime-200 bg-lime-50 text-lime-800"}`} title={`${slot.courseName}${cancelled ? " · Cancelled" : ""} · ${displayTime(slot.startTime)}–${displayTime(slot.endTime)}`} onClick={() => { const course = courses.find((course) => course.id === slot.courseId); if (course) setSelectedClass({ course, date, slot }); }}>{slot.courseName}{cancelled ? " · Cancelled" : ""}</button>; })}</div></div>;
      })}</div>
    </section>;
  }
  function coursesForYear(year: number) {
    return courses.filter((course) => selectedCourseIds.includes(course.id) && (() => {
      if ((course.occurrences ?? []).some((occurrence) => Number(occurrence.classDate.slice(0, 4)) === year)) return true;
      const startYear = course.startDate ? Number(course.startDate.slice(0, 4)) : year;
      const endYear = course.endDate ? Number(course.endDate.slice(0, 4)) : year;
      return startYear <= year && year <= endYear;
    })());
  }
  function renderAttendanceMatrixHeader(year: number, course: Course, scrollLeft: number) {
    const selectedColumnIndex = selectedMatrixStudents.findIndex((student) => student.id === selectedMatrixStudentId);
    return <div className="sticky top-0 z-30 overflow-hidden bg-stone-50 shadow-sm">
      <style>{`.calendar-widget-body > div > section > h3 { display: none; } .calendar-widget-body .matrix-selected-day > * { background-color: #f0f9ff; box-shadow: inset 0 2px #0284c7, inset 0 -2px #0284c7; } .calendar-widget-body .matrix-selected-day > td > * { box-shadow: inset 0 2px #0284c7, inset 0 -2px #0284c7; }`}</style>
      {selectedColumnIndex >= 0 && <style>{`.calendar-widget-body table.table-fixed tbody tr > td:nth-of-type(${selectedColumnIndex + 1}) { background-color: #f0f9ff; } .calendar-widget-body table.table-fixed tbody tr > td:nth-of-type(${selectedColumnIndex + 1}) > * { box-shadow: inset 2px 0 #0284c7, inset -2px 0 #0284c7; }`}</style>}
      <div className="border-b border-stone-200 py-2 text-center font-sans text-lg font-bold text-slate-700">{year}</div>
      <div className="border-b border-stone-200 bg-stone-100 px-3 py-2 text-center font-sans text-sm font-bold text-slate-700">{course.name}</div>
      <div className="relative h-32 overflow-hidden">
        <div className="absolute top-0 flex h-32 text-left font-sans text-[10px] text-slate-600" style={{ width: `${selectedMatrixStudents.length * 28}px`, transform: `translateX(${98 - Math.round(scrollLeft)}px)` }}>{selectedMatrixStudents.map((student) => { const selected = selectedMatrixStudentId === student.id; return <div key={student.id} className={`h-32 w-7 shrink-0 border-b border-r border-stone-200 text-center font-bold antialiased ${selected ? "border-x-2 border-sky-600 bg-sky-50 text-sky-950" : "bg-stone-50"}`} title={`${student.firstName} ${student.lastName}`}><button type="button" aria-pressed={selected} onClick={() => setSelectedMatrixStudentId((id) => id === student.id ? null : student.id)} className="relative flex h-32 w-7 items-start justify-center pt-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-600"><span className="inline-block whitespace-nowrap" style={{ writingMode: "vertical-rl", direction: "rtl" }}>{student.firstName} {student.lastName}</span>{student.picture ? <img src={student.picture} alt="" className="absolute bottom-1 size-5 rounded-full border border-white object-cover shadow" /> : <span aria-hidden="true" className="absolute bottom-1 flex size-5 items-center justify-center rounded-full bg-slate-200 text-[7px] font-bold text-slate-600">{student.firstName[0]}{student.lastName[0]}</span>}</button></div>; })}</div>
        <div className="absolute inset-y-0 left-0 z-10 flex bg-stone-50 text-left font-sans text-[9px] text-slate-500"><div className="box-border w-[38px] border-b border-r border-stone-200 px-1 py-1">Month</div><div className="box-border w-[60px] border-b border-r border-stone-200 px-1 py-1">Date</div></div>
      </div>
    </div>;
  }
  function renderAttendanceMatrix(year: number, month: number, course: Course, showHeader: boolean) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const classRows = Array.from({ length: daysInMonth }, (_, index) => {
      const date = new Date(year, month, index + 1); const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`; const day = weekdays[(date.getDay() + 6) % 7];
      const occurrences = (course.occurrences ?? []).filter((occurrence) => occurrence.classDate === dateKey);
      // Stored occurrences are authoritative for historical dates: a later
      // schedule change must not add a second class at a different time.
      const dateSlots = occurrences.length
        ? occurrences.map((occurrence) => ({ courseId: course.id, courseName: course.name, startDate: course.startDate, endDate: course.endDate, day, startTime: occurrence.startTime, endTime: occurrence.endTime ?? "", cancelled: Boolean(occurrence.cancelled) }))
        : slots.filter((slot) => slot.courseId === course.id && slot.day === day && (!slot.startDate || dateKey >= slot.startDate) && (!slot.endDate || dateKey <= slot.endDate)).map((slot) => ({ ...slot, cancelled: false }));
      dateSlots.sort((first, second) => first.startTime.localeCompare(second.startTime));
      return dateSlots.map((slot) => ({ dateKey, date, slot, payment: false }));
    }).flat();
    const rows = classRows;
    const matrixWidth = 98 + selectedMatrixStudents.length * 28;
    return <div key={`${year}-${month}`}><table className="table-fixed border-collapse text-left font-sans text-[9px]" style={{ width: `${matrixWidth}px`, minWidth: `${matrixWidth}px` }}><colgroup><col style={{ width: 38 }} /><col style={{ width: 60 }} />{selectedMatrixStudents.map((student) => <col key={student.id} style={{ width: 28 }} />)}</colgroup>{showHeader && <thead><tr className="bg-stone-50 text-slate-500"><th className="sticky left-0 z-20 border-b border-r border-stone-200 bg-stone-50 px-1 py-1">Month</th><th className="sticky left-[38px] z-20 border-b border-r border-stone-200 bg-stone-50 px-1 py-1">Date</th>{selectedMatrixStudents.map((student) => <th key={student.id} className="h-32 min-w-7 border-b border-r border-stone-200 px-1 py-1 text-center font-semibold" title={`${student.firstName} ${student.lastName}`}><span className="inline-block whitespace-nowrap" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>{student.firstName} {student.lastName}</span></th>)}</tr></thead>}<tbody>{rows.map(({ dateKey, date, slot }, index) => <tr key={`${dateKey}-${slot.courseId}-${slot.startTime}`}>{index === 0 && <th rowSpan={rows.length} scope="rowgroup" className="sticky left-0 z-20 border-b border-r border-stone-300 bg-violet-50 px-1 text-center font-bold uppercase tracking-wide text-violet-900"><span className="absolute inset-x-0 top-1" style={{ writingMode: "vertical-rl", textOrientation: "upright" }}>{months[month]}</span></th>}<th scope="row" className={`sticky left-[38px] z-10 whitespace-nowrap border-b border-r border-stone-200 px-1 py-1 font-medium ${slot.cancelled ? "bg-stone-200 text-stone-500" : "bg-white text-slate-700"}`} title={`${slot.courseName} · ${displayTime(slot.startTime)}`}>{date.getDate()} {dayLabels[slot.day].slice(0, 3)}</th>{selectedMatrixStudents.map((student) => { const events = multipleStudentEvents[student.id] ?? []; const attendance = events.find((item) => item.date === dateKey && item.courseName === slot.courseName && (item.kind === "attendance" || item.kind === "missed")); const payment = events.find((item) => item.kind === "payment" && (item.coveredClasses ?? []).find((covered) => covered.courseName === course.name)?.startsAt.slice(0, 10) === dateKey); const attendanceClass = slot.cancelled ? "bg-stone-200" : attendance?.kind === "attendance" ? "bg-lime-400" : attendance?.kind === "missed" ? "bg-orange-300" : "bg-white"; const title = slot.cancelled ? "Cancelled" : payment ? `Payment on ${payment.date}` : attendance?.kind === "attendance" ? "Attended" : attendance?.kind === "missed" ? "Missed" : "Available class"; const activityKey = `${student.id}|${dateKey}|${slot.courseName}`; const openAttendance = () => { if (attendance) { setSelectedStudentId(student.id); setOpenedPaymentId(null); setOpenedAttendanceDate(dateKey); } }; const openPayment = () => { if (payment?.paymentId !== null && payment?.paymentId !== undefined) { setSelectedStudentId(student.id); setOpenedAttendanceDate(null); setOpenedPaymentId(payment.paymentId); } }; const activityRef = (element: HTMLButtonElement | null) => { if (element) matrixActivityCardRefs.current.set(activityKey, element); else matrixActivityCardRefs.current.delete(activityKey); }; const paymentRef = (element: HTMLButtonElement | null) => { if (payment?.paymentId === null || payment?.paymentId === undefined) return; const key = `${student.id}|${payment.paymentId}`; if (element) matrixPaymentCardRefs.current.set(key, element); else matrixPaymentCardRefs.current.delete(key); }; return <td key={student.id} className="h-7 w-7 border-b border-r border-stone-200 p-0 text-center font-bold" title={title}>{payment ? <span className="grid h-7 w-7 grid-cols-2"><button ref={activityRef} type="button" onClick={openAttendance} className={`flex items-center justify-center ${attendanceClass} hover:brightness-95 focus:outline-none focus:ring-1 focus:ring-lime-700`}>{slot.cancelled ? "—" : attendance?.kind === "attendance" ? "A" : attendance?.kind === "missed" ? "M" : ""}</button><button ref={paymentRef} type="button" onClick={openPayment} onMouseEnter={(event) => setHoveredPayment({ event: payment, element: event.currentTarget, studentId: student.id })} onMouseLeave={() => setHoveredPayment(null)} onFocus={(event) => setHoveredPayment({ event: payment, element: event.currentTarget, studentId: student.id })} onBlur={() => setHoveredPayment(null)} className="flex items-center justify-center bg-cyan-300 text-cyan-950 hover:bg-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-800">P</button></span> : <button ref={activityRef} type="button" onClick={openAttendance} disabled={!attendance} className={`flex h-7 w-7 items-center justify-center ${attendanceClass} enabled:hover:brightness-95 focus:outline-none focus:ring-1 focus:ring-lime-700 disabled:cursor-default`}>{slot.cancelled ? "—" : attendance?.kind === "attendance" ? "A" : attendance?.kind === "missed" ? "M" : ""}</button>}</td>; })}</tr>)}{!rows.length && <tr><th className="sticky left-0 z-20 border-b border-r border-stone-300 bg-violet-50 px-1 text-center font-bold uppercase tracking-wide text-violet-900" style={{ writingMode: "vertical-rl", textOrientation: "upright" }}>{months[month]}</th><td colSpan={selectedMatrixStudents.length + 1} className="px-2 py-4 text-center text-slate-400">No scheduled classes</td></tr>}</tbody></table></div>;
  }
  function matrixMonthHasClasses(year: number, month: number, course: Course) {
    const firstDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`;
    return (course.occurrences ?? []).some((occurrence) => occurrence.classDate >= firstDate && occurrence.classDate <= lastDate) || slots.some((slot) => slot.courseId === course.id && (!slot.startDate || lastDate >= slot.startDate) && (!slot.endDate || firstDate <= slot.endDate));
  }
  function renderMatrixCourse(year: number, course: Course) {
    const key = `${year}-${course.id}`;
    const firstScheduledMonth = months.findIndex((_, month) => matrixMonthHasClasses(year, month, course));
    const displayedMonths = firstScheduledMonth === -1 ? months.map((_, month) => month) : months.map((_, month) => month).slice(firstScheduledMonth);
    return <section key={course.id} className="min-w-0 self-start bg-white"><div className="overflow-x-auto" onScroll={(event) => { const scrollLeft = Math.round(event.currentTarget.scrollLeft); setMatrixScrollOffsets((offsets) => ({ ...offsets, [key]: scrollLeft })); }}>{displayedMonths.map((month) => renderAttendanceMatrix(year, month, course, false))}</div></section>;
  }
  function renderYearMatrix(year: number) {
    const yearCourses = coursesForYear(year);
    const columns = yearCourses.length === 1 ? "grid-cols-1" : "grid-cols-2";
    return <section key={year} className="overflow-visible rounded-xl border border-stone-200 bg-stone-50/50">
      <h3 className="m-3 mb-0 border-b border-stone-200 pb-2 text-center font-sans text-lg font-bold text-slate-700">{year}</h3>
      <div className={`sticky top-0 z-30 grid ${columns} gap-px bg-stone-200 shadow-sm`}>{yearCourses.map((course) => <div key={course.id} className="min-w-0 self-start">{renderAttendanceMatrixHeader(year, course, matrixScrollOffsets[`${year}-${course.id}`] ?? 0)}</div>)}</div>
      <div className={`grid ${columns} items-start gap-px bg-stone-200`}>{yearCourses.map((course) => renderMatrixCourse(year, course))}</div>
    </section>;
  }

  return <>
    <style>{`@media (max-width: 1023px) { [role="menu"][aria-label="Student presets"] { width: calc(100vw - 2rem); grid-template-columns: 1fr; max-height: min(32rem, calc(100vh - 8rem)); overflow-y: auto; } [role="menu"][aria-label="Student presets"] > section { border-right: 0; border-bottom: 1px solid #e7e5e4; } [role="menu"][aria-label="Student presets"] > section:last-child { border-bottom: 0; } }`}</style>
    {selectedDay && <CalendarDayPanel date={selectedDay} courses={courses} onClose={() => setSelectedDay(null)} />}
    {selectedPractice !== null && <PracticePartyPanel id={selectedPractice} onClose={() => { setSelectedPractice(null); setCalendarReload(v => v + 1); }} />}
    {selectedClass && <ClassAttendancePanel courseName={selectedClass.course.name} slot={{ courseId: selectedClass.slot.courseId, classDate: `${selectedClass.date.getFullYear()}-${String(selectedClass.date.getMonth() + 1).padStart(2, "0")}-${String(selectedClass.date.getDate()).padStart(2, "0")}`, startTime: selectedClass.slot.startTime }} onClose={() => setSelectedClass(null)} />}
    {selectedStudentId !== null && (openedAttendanceDate || openedPaymentId !== null) && <StudentPanel key={`calendar-activity-${selectedStudentId}-${openedAttendanceDate ?? "payment"}-${openedPaymentId ?? ""}`} id={selectedStudentId} attendanceDate={openedAttendanceDate ?? undefined} targetPaymentId={openedPaymentId ?? undefined} onClose={() => { setOpenedAttendanceDate(null); setOpenedPaymentId(null); }} onUpdate={() => {}} onDelete={() => { setOpenedAttendanceDate(null); setOpenedPaymentId(null); }} />}
    <section className={`${calendarRange === "month" ? "mx-auto w-full max-w-6xl" : "w-full"} relative z-20 min-w-0 overflow-visible rounded-2xl border border-stone-200 bg-white shadow-sm`} aria-labelledby="calendar-title">
      <div className="relative z-50 flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 font-sans text-xs"><h2 className="sr-only" id="calendar-title">Calendar</h2>
          <label className="sr-only" htmlFor="calendar-range">Calendar range</label>
          <select id="calendar-range" aria-label="Calendar range" className="h-8 rounded-md border border-stone-300 bg-white px-2 font-semibold text-slate-700 focus:ring-2 focus:ring-lime-600" value={calendarRange} onChange={(event) => changeCalendarRange(event.target.value as CalendarRange)}><option value="month">Month</option><option value="year">Whole year</option><option value="years">Multiple years</option></select>
          {calendarRange !== "years" && <><label className="font-semibold text-slate-700" htmlFor="calendar-view">View</label>
          <select id="calendar-view" className="h-8 rounded-md border border-stone-300 bg-white px-2 font-semibold text-slate-700 focus:ring-2 focus:ring-lime-600" value={calendarMode} onChange={event => { setCalendarMode(event.target.value as "school" | "student"); setSelectedDay(null); setSelectedClass(null); setOpenedAttendanceDate(null); setOpenedPaymentId(null); }}><option value="school">School calendar</option><option value="student">Student</option></select></>}
          {calendarMode === "student" && <div ref={studentPickerRef} className="relative"><button type="button" aria-haspopup="listbox" aria-expanded={studentPickerOpen} className="flex h-8 min-w-52 items-center gap-2 rounded-md border border-stone-300 bg-white px-2 text-left font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-lime-600" onClick={() => setStudentPickerOpen(open => { const next = !open; if (next) { setStudentSearch(""); window.setTimeout(() => studentSearchInput.current?.focus(), 0); } return next; })}>{selectedStudent?.picture && calendarRange !== "years" ? <img className="h-5 w-5 rounded-full object-cover" alt="" src={selectedStudent.picture} /> : <span className="flex h-5 w-5 items-center justify-center rounded-full bg-lime-100 text-[9px] text-lime-800">{calendarRange === "years" ? selectedStudentIds.length : selectedStudent?.firstName.slice(0, 1) ?? "?"}</span>}<span className="flex-1 truncate">{calendarRange === "years" ? (selectedStudentIds.length ? `${selectedStudentIds.length} students selected` : "Choose students…") : selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : "Choose a student…"}</span><span aria-hidden="true">⌄</span></button>{studentPickerOpen && <div role="listbox" aria-label="Students" className="absolute z-30 mt-1 w-64 rounded-md border border-stone-300 bg-white p-1 shadow-lg"><input ref={studentSearchInput} type="search" aria-label="Filter students" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Type a student name…" className="mb-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm outline-none focus:border-lime-600 focus:ring-1 focus:ring-lime-600" />{calendarRange === "years" && <div className="mb-1 flex gap-1"><button type="button" className="flex-1 rounded border border-stone-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-lime-50" onClick={() => setSelectedStudentIds(students.map((student) => student.id))}>Select all</button><button type="button" className="flex-1 rounded border border-stone-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-stone-50" onClick={() => setSelectedStudentIds([])}>Clear all</button></div>}<div className="max-h-56 overflow-y-auto">{filteredStudents.map(student => <button role="option" aria-selected={calendarRange === "years" ? selectedStudentIds.includes(student.id) : student.id === selectedStudentId} type="button" key={student.id} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-lime-50 focus:bg-lime-50 focus:outline-none" onClick={() => { if (calendarRange === "years") setSelectedStudentIds((ids) => ids.includes(student.id) ? ids.filter((id) => id !== student.id) : [...ids, student.id]); else { setSelectedStudentId(student.id); setStudentPickerOpen(false); setStudentSearch(""); } }}>{student.picture ? <img className="h-7 w-7 rounded-full object-cover" alt="" src={student.picture} /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-lime-100 text-[10px] font-bold text-lime-800">{student.firstName.slice(0, 1)}</span>}<span className="flex-1">{student.firstName} {student.lastName}</span>{calendarRange === "years" && selectedStudentIds.includes(student.id) && <span aria-hidden="true">✓</span>}</button>)}{filteredStudents.length === 0 && <p className="px-2 py-3 text-sm text-slate-500">No students found.</p>}</div></div>}</div>}
          {calendarRange === "years" && calendarMode === "student" && <div ref={presetMenuRef} className="relative"><button type="button" aria-haspopup="menu" aria-expanded={presetMenuOpen} className="flex h-8 items-center gap-2 rounded-md border border-stone-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-lime-600" onClick={() => setPresetMenuOpen((open) => !open)}>Student presets <span aria-hidden="true">⌄</span></button>{presetMenuOpen && <div role="menu" aria-label="Student presets" className="absolute z-40 mt-1 grid w-[48rem] grid-cols-3 gap-0 overflow-hidden rounded-md border border-stone-300 bg-white shadow-lg"><section className="border-r border-stone-200 p-2"><p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Beginners</p>{attendancePresets.filter((preset) => preset.course === "Beginners").map((preset) => <button role="menuitem" type="button" key={preset.name} className="block w-full rounded px-2 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-lime-50 focus:bg-lime-50 focus:outline-none" onClick={() => applyPreset(preset)}>{preset.name}<span className="ml-1 font-normal text-slate-400">· {preset.studentIds.length}</span></button>)}</section><section className="border-r border-stone-200 p-2"><p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Intermediates</p>{attendancePresets.filter((preset) => preset.course === "Intermediates").map((preset) => <button role="menuitem" type="button" key={preset.name} className="block w-full rounded px-2 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-lime-50 focus:bg-lime-50 focus:outline-none" onClick={() => applyPreset(preset)}>{preset.name}<span className="ml-1 font-normal text-slate-400">· {preset.studentIds.length}</span></button>)}</section><section className="p-2"><p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">armin.xlsx</p>{namedPresets.map((preset) => <button role="menuitem" type="button" key={preset.name} className="block w-full rounded px-2 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-lime-50 focus:bg-lime-50 focus:outline-none" onClick={() => applyPreset(preset)}>{preset.name}<span className="ml-1 font-normal text-slate-400">· {preset.studentIds.length}</span></button>)}</section></div>}</div>}
          {calendarMode === "student" && <button aria-pressed={showPaymentCoverage} type="button" className={`h-8 rounded-md border px-2 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-600 ${showPaymentCoverage ? "border-cyan-700 bg-cyan-700 text-white" : "border-stone-300 bg-white text-slate-700 hover:bg-cyan-50"}`} onClick={() => setShowPaymentCoverage((shown) => !shown)}>Payment coverage</button>}
          {calendarRange === "years" && <><details ref={courseFilterRef} className="relative"><summary title={selectedCourseLabel} className="flex h-8 max-w-48 cursor-pointer list-none items-center truncate rounded-md border border-stone-300 bg-white px-2 font-semibold text-slate-700">Courses: {selectedCourseLabel}</summary><div className="absolute z-30 mt-1 w-56 rounded-md border border-stone-300 bg-white p-2 shadow-lg"><div className="mb-1 flex gap-1"><button type="button" className="flex-1 rounded border border-stone-300 px-1 py-1 text-xs" onClick={() => setSelectedCourseIds(courses.map((course) => course.id))}>All</button><button type="button" className="flex-1 rounded border border-stone-300 px-1 py-1 text-xs" onClick={() => setSelectedCourseIds([])}>Clear</button></div>{courses.map((course) => <label key={course.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-lime-50"><input type="checkbox" checked={selectedCourseIds.includes(course.id)} onChange={() => setSelectedCourseIds((ids) => ids.includes(course.id) ? ids.filter((id) => id !== course.id) : [...ids, course.id])} />{course.name}</label>)}</div></details><details ref={yearFilterRef} className="relative"><summary title={selectedYearLabel} className="flex h-8 max-w-40 cursor-pointer list-none items-center truncate rounded-md border border-stone-300 bg-white px-2 font-semibold text-slate-700">Years: {selectedYearLabel}</summary><div className="absolute z-30 mt-1 w-40 rounded-md border border-stone-300 bg-white p-2 shadow-lg"><div className="mb-1 grid grid-cols-2 gap-1"><button type="button" className="rounded border border-stone-300 px-1 py-1 text-xs" onClick={() => setSelectedYears(multiYears)}>Activity years</button><button type="button" className="rounded border border-stone-300 px-1 py-1 text-xs" onClick={() => setSelectedYears(schoolActivityYears)}>All class years</button><button type="button" className="col-span-2 rounded border border-stone-300 px-1 py-1 text-xs" onClick={() => setSelectedYears([])}>Clear</button></div>{selectableYears.map((year) => <label key={year} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-lime-50"><input type="checkbox" checked={selectedYears.includes(year)} onChange={() => setSelectedYears((years) => years.includes(year) ? years.filter((item) => item !== year) : [...years, year])} />{year}</label>)}</div></details></>}
        </div>
        <div className="flex items-center gap-1.5 font-sans">
          {calendarRange !== "years" && <button type="button" aria-label={calendarRange === "year" ? "Previous year" : "Previous month"} className="flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-white text-slate-600 hover:bg-stone-50" onClick={() => changeMonth(-1)}>‹</button>}
          {calendarRange === "month" && <select aria-label="Calendar month" className="h-8 rounded-md border border-stone-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-lime-600" value={visibleMonth.getMonth()} onChange={(event) => { const month = Number(event.target.value); setVisibleMonth((current) => new Date(current.getFullYear(), month, 1)); }}>
            {months.map((month, index) => <option key={month} value={index}>{month}</option>)}
          </select>}
          {calendarRange !== "years" && <select aria-label="Calendar year" className="h-8 rounded-md border border-stone-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-lime-600" value={visibleMonth.getFullYear()} onChange={(event) => { const year = Number(event.target.value); setVisibleMonth((current) => new Date(year, current.getMonth(), 1)); }}>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>}
          {calendarRange === "years" && <span className="px-1 text-xs font-semibold text-slate-600">All relevant years</span>}
          <span className="sr-only" aria-live="polite">{monthLabel}</span>
          {calendarRange !== "years" && <button type="button" aria-label={calendarRange === "year" ? "Next year" : "Next month"} className="flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-white text-slate-600 hover:bg-stone-50" onClick={() => changeMonth(1)}>›</button>}
        </div>
      </div>
      {eventError && <p role="alert" className="p-3 text-sm text-red-700">{eventError} <button onClick={() => setCalendarReload(v => v + 1)}>Retry</button></p>}
      {loading ? <p className="p-8 text-center font-sans text-xs text-slate-400">Loading calendar...</p> : error ? <p className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 font-sans text-xs text-red-700" role="alert">{error}</p> : <div className="min-w-0"><div className="calendar-widget-body relative" ref={calendarBodyRef}>
        {!!coverageLines.length && <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible" preserveAspectRatio="none"><defs><marker id="payment-coverage-arrow" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3"><path d="M0,0 L0,6 L6,3 z" fill="#0891b2" /></marker></defs>{coverageLines.map((line) => <path key={line.key} d={`M ${line.x1} ${line.y1} C ${line.x1} ${(line.y1 + line.y2) / 2}, ${line.x2} ${(line.y1 + line.y2) / 2}, ${line.x2} ${line.y2}`} fill="none" markerEnd="url(#payment-coverage-arrow)" stroke="#0891b2" strokeDasharray="3 3" strokeWidth="1.5" />)}</svg>}
        {calendarRange === "year" ? <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 md:grid-cols-4">{months.map((_, month) => renderYearMonth(visibleMonth.getFullYear(), month))}</div> : calendarRange === "years" ? <div className="grid grid-cols-1 items-start gap-5 p-3 lg:grid-cols-[repeat(auto-fit,minmax(32rem,1fr))]">{selectableYears.filter((year) => selectedYears.includes(year)).sort((first, second) => first - second).map(renderYearMatrix)}{!multiYears.length && <p className="p-6 text-center font-sans text-sm text-slate-500">{calendarMode === "student" ? "Choose students with activity to show their attendance matrix." : "No calendar activity to show."}</p>}</div> : <><div className="calendar-grid border-b border-stone-200 bg-stone-50">{weekdays.map((day) => <div className="px-1 py-2 text-center font-sans text-[10px] font-bold uppercase tracking-wider text-slate-400" key={day}>{dayLabels[day].slice(0, 3)}</div>)}</div>
        <div className="calendar-grid border-l border-stone-200">{calendarDates.map((date) => { const day = weekdays[(date.getDay() + 6) % 7]; const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; const dayStudentEvents = studentEvents.filter(item => item.date === dateKey); const daySlots = calendarMode === "school" ? schoolSlotsOn(dateKey, day) : [];
        const dayPractices = calendarMode === "school" ? eventSessions.filter(s => s.startsAt.slice(0, 10) === dateKey) : [];
        const empty = calendarMode === "school" && daySlots.length === 0 && dayPractices.length === 0;
        const current = sameDate(date, today); const inMonth = date.getMonth() === visibleMonth.getMonth(); return <section className={`calendar-widget-day relative border-b border-r border-stone-200 p-0.5 sm:p-1.5 ${current ? "bg-lime-50/70" : inMonth ? "bg-white" : "bg-stone-50/70"}`} key={date.toISOString()} aria-label={date.toLocaleDateString()}>
          {empty && <button type="button" aria-label={`Add event on ${dateKey}`} onClick={() => setSelectedDay(dateKey)} className="absolute inset-0 z-10 rounded-sm hover:bg-lime-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime-600" />}
          <p className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full font-sans text-[10px] font-semibold ${current ? "bg-lime-600 text-white" : inMonth ? "text-slate-700" : "text-slate-300"}`}>{date.getDate()}</p>
          <div className="space-y-1">{calendarMode === "student" && selectedStudentId !== null && dayStudentEvents.map((event, index) => { const cardKey = `${event.date}|${event.courseName}`; const covered = event.kind !== "payment" && coveredCardKeys.has(cardKey); const cardClass = `relative z-20 ${covered ? "ring-2 ring-cyan-500 ring-offset-1" : ""}`; return event.kind === "attendance" ? <button type="button" key={`${event.kind}-${event.courseName}-${index}`} ref={(element) => { if (element) activityCardRefs.current.set(cardKey, element); else activityCardRefs.current.delete(cardKey); }} onClick={() => setOpenedAttendanceDate(dateKey)} className={`${cardClass} block w-full rounded border p-1 text-left font-sans text-[9px] font-bold transition-colors hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-lime-600 ${studentEventColor(event)}`} title={`Open ${event.courseName ?? "class"} attendance in the student log`}>{studentEventLabel(event)}</button> : <div key={`${event.kind}-${event.courseName}-${index}`} ref={event.kind === "missed" ? (element) => { if (element) activityCardRefs.current.set(cardKey, element); else activityCardRefs.current.delete(cardKey); } : event.kind === "payment" ? (element) => { if (element && event.paymentId !== null) paymentCardRefs.current.set(event.paymentId, element); else if (event.paymentId !== null) paymentCardRefs.current.delete(event.paymentId); } : undefined} className={`${cardClass} rounded border p-1 font-sans text-[9px] font-bold ${studentEventColor(event)}`} role={event.kind === "payment" ? "button" : undefined} onClick={event.kind === "payment" && event.paymentId !== null ? () => setOpenedPaymentId(event.paymentId) : undefined} onKeyDown={event.kind === "payment" && event.paymentId !== null ? (key) => { if (key.key === "Enter" || key.key === " ") { key.preventDefault(); setOpenedPaymentId(event.paymentId!); } } : undefined} onBlur={() => setHoveredPayment(null)} onFocus={event.kind === "payment" ? (focus) => setHoveredPayment({ event, element: focus.currentTarget }) : undefined} onMouseEnter={event.kind === "payment" ? (hover) => setHoveredPayment({ event, element: hover.currentTarget }) : undefined} onMouseLeave={event.kind === "payment" ? () => setHoveredPayment(null) : undefined} tabIndex={event.kind === "payment" ? 0 : undefined}><span className="block">{studentEventLabel(event)}</span></div>; })}{dayPractices.map(s => <button type="button" key={`practice-${s.id}`} disabled={!canOpenEvents} onClick={() => setSelectedPractice(s.id)} className={`block w-full rounded border border-pink-200 bg-pink-50 p-1 text-left font-sans text-[9px] ${s.cancelled ? 'opacity-50' : ''}`} title={`Practice party · ${s.startsAt.slice(11)}–${sessionEnd(s).slice(11)}`}><span className="block truncate font-bold">Practice party{s.cancelled ? ' · Cancelled' : ''}</span><span>{s.startsAt.slice(11)}</span></button>)}{daySlots.map((slot, index) => { const cancelled = courses.find((course) => course.id === slot.courseId)?.cancellations?.some((item) => item.classDate === dateKey && item.startTime === slot.startTime); return <button className={`block w-full min-w-0 rounded border px-0.5 py-1 sm:px-1.5 text-left focus:outline-none focus:ring-2 ${cancelled ? "border-stone-300 bg-stone-100 hover:border-stone-400 focus:ring-stone-500" : "hover:border-lime-400 focus:ring-lime-600"} ${cancelled ? (inMonth ? "" : "opacity-60") : inMonth ? "border-lime-200 bg-lime-50" : "border-stone-200 bg-white/60 opacity-60"}`} key={`${date.toISOString()}-${slot.courseId}-${slot.startTime}-${index}`} onClick={() => { const course = courses.find(({ id }) => id === slot.courseId); if (course) setSelectedClass({ course, date, slot }); }} title={`${slot.courseName} · ${displayTime(slot.startTime)}–${displayTime(slot.endTime)}`} type="button"><span className="block truncate font-sans text-[9px] font-bold leading-3 text-slate-800">{slot.courseName}{cancelled ? " · Cancelled" : ""}</span><span className={`block truncate font-sans text-[8px] font-semibold leading-3 ${cancelled ? "text-stone-500" : "text-lime-700"}`}>{displayTime(slot.startTime)}–{displayTime(slot.endTime)}</span></button>; })}</div>
        </section>; })}</div></>}
      </div></div>}
    </section>
  </>;
}
