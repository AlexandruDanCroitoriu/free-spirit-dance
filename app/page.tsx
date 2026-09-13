"use client";

import { lazy, Suspense } from "react";
import { useDashboardWidgets } from "./components/dashboard-settings";

const CourseCalendarWidget = lazy(() => import("./components/course-calendar-widget"));
const StudentBalancesWidget = lazy(() => import("./components/student-balances-widget"));
const PaymentTransfersWidget = lazy(() => import("./components/payment-transfers-widget"));

export default function HomePage() {
  const { widgets, ready } = useDashboardWidgets();
  return <main className="flex-1 px-4 py-6 text-slate-800 md:px-12">
    {ready && <div className="grid w-full grid-cols-1 items-start gap-4 lg:gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
      <Suspense fallback={null}>{widgets.calendar && <div className="min-w-0"><CourseCalendarWidget /></div>}</Suspense>
      <Suspense fallback={null}>{widgets.balances && <StudentBalancesWidget />}</Suspense>
      <Suspense fallback={null}>{widgets.transfers && <div className="min-w-0 xl:col-span-2"><PaymentTransfersWidget /></div>}</Suspense>
      {!Object.values(widgets).some(Boolean) && <p className="py-8 text-center font-sans text-sm text-slate-500">All widgets are hidden. Use Settings above to show a widget.</p>}
    </div>}
  </main>;
}
