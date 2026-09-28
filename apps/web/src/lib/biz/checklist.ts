// Go-live checklist (Phase 2 B1 "Go-live minimum"); the server decides (get_go_live_checklist).
export interface ChecklistItem {
  key: 'location' | 'hours' | 'service' | 'staff_hours' | 'cover';
  ok: boolean;
}

export const CHECKLIST_COPY: Record<ChecklistItem['key'], { label: string; step: string }> = {
  location: { label: 'Location with a map pin', step: 'location' },
  hours: { label: 'Opening hours', step: 'hours' },
  service: {
    label: 'At least one bookable service with a price and a team member',
    step: 'services',
  },
  staff_hours: { label: 'A team member with working hours', step: 'team' },
  cover: { label: 'Cover photo', step: 'photos' },
};
