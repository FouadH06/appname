'use client';

import { Suspense } from 'react';
import { CalendarScreen } from '@/components/biz/calendar/calendar-screen';

// B3 Calendar (Phase 2 Part 3): Day · Columns, Day · Single, Week, Agenda
export default function CalendarPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-ink-500">Loading…</p>}>
      <CalendarScreen />
    </Suspense>
  );
}
