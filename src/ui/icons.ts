// Inline SVG icons (stroke style, 24px grid). Buttons get their names from aria-label.

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const icons = {
  copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 8.5V6.7a2.2 2.2 0 0 0-2.2-2.2H6.7a2.2 2.2 0 0 0-2.2 2.2v6.6a2.2 2.2 0 0 0 2.2 2.2h1.8"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  share: svg('<path d="M12 15V4"/><path d="M8 7.5L12 3.5l4 4"/><path d="M7 11H5.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H17"/>'),
  open: svg('<path d="M13.5 4.5H19.5V10.5"/><path d="M19.5 4.5L11 13"/><path d="M17 14v4.5A1.5 1.5 0 0 1 15.5 20h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>'),
  dice: svg('<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/>'),
  gift: svg('<rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M2.5 9h19V6.5h-19z"/><path d="M12 6.5V20"/><path d="M12 6.5C10.5 3 7 3 7 5s3 1.5 5 1.5z"/><path d="M12 6.5C13.5 3 17 3 17 5s-3 1.5-5 1.5z"/>'),
  replay: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4v4h4"/>'),
  warn: svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>'),
  bowClassic: svg('<path d="M12 12c-3-4.5-8-5-8-2s5 3 8 2zM12 12c3-4.5 8-5 8-2s-5 3-8 2z"/><path d="M11 13l-3.5 6M13 13l3.5 6"/>'),
  bowRosette: svg('<circle cx="12" cy="12" r="2"/><path d="M12 10c-1-4 1-6 0-6s1 2 0 6M14 12c4-1 6 1 6 0s-2 1-6 0M12 14c1 4-1 6 0 6s-1-2 0-6M10 12c-4 1-6-1-6 0s2-1 6 0"/><path d="M13.4 10.6c2-3 4.5-3 3.6-3.6s-.6 1.6-3.6 3.6M10.6 13.4c-2 3-4.5 3-3.6 3.6s.6-1.6 3.6-3.6M13.4 13.4c3 2 3 4.5 3.6 3.6s-1.6-.6-3.6-3.6M10.6 10.6c-3-2-3-4.5-3.6-3.6s1.6.6 3.6 3.6"/>'),
  bowSimple: svg('<path d="M12 11c-1.5-2.5-4-3-4-1.5S10.5 11 12 11zM12 11c1.5-2.5 4-3 4-1.5S13.5 11 12 11z"/><path d="M11.5 11.5L5 19M12.5 11.5L19 19"/>'),
};
