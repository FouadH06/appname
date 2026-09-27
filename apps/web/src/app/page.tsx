import { COLOR_TOKENS } from '@app/ui-web';
import { FoundationControls } from './foundation-controls';

// M0 placeholder: proves tokens, theming and RTL wiring. Replaced by real screens in M5/M8.
export default function FoundationPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">APP_NAME</h1>
      <p className="mt-1 text-ink-700">Foundation build (M0). No product features yet.</p>

      <FoundationControls />

      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Design tokens">
        {COLOR_TOKENS.map((token) => (
          <li
            key={token}
            className="flex items-center gap-3 rounded-card border border-line-200 bg-surface-0 p-3"
          >
            <span
              className="size-8 shrink-0 rounded-control border border-line-200"
              style={{ background: `var(--${token})` }}
            />
            <code className="text-sm">{token}</code>
          </li>
        ))}
      </ul>

      <p className="mt-6 ps-4 border-s-4 border-accent-600" data-testid="rtl-sample">
        الشغل كتير حلو بس الموظفة كانت rude شوي — mixed-language sample for RTL checks.
      </p>
    </main>
  );
}
