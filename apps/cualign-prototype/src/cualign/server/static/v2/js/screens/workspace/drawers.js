// Open/closed state of the workspace drawers. Which widths turn a column into
// a drawer is decided by the stylesheet; this module only flips the classes:
// - workspace-left-open: plan + chat column (toggle button, shown by CSS at narrow widths)
// - workspace-sidebar-open: right sidebar, opened from the tab rail
import { h } from '../../ui/dom.js';
import { WORKSPACE_VOCAB as W } from '../../domain/vocab/workspace.js';

export const LEFT_DRAWER_ID = 'workspace-left-drawer';

// Clicking the tab that is already shown closes an open drawer; any other click opens it.
export function nextSidebarOpen({ open, clickedActive }) {
  return !(open && clickedActive);
}

export function bindDrawers(shell, { left, tabs }) {
  left.id = LEFT_DRAWER_ID;
  const toggle = h('button', {
    type: 'button',
    class: 'btn btn-outline workspace-left-drawer-toggle',
    hidden: true,
    'aria-controls': LEFT_DRAWER_ID,
    'aria-expanded': 'false',
    'aria-label': W.planPanel
  }, W.plansTitle);

  function setLeftOpen(open) {
    shell.classList.toggle('workspace-left-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', () => setLeftOpen(!shell.classList.contains('workspace-left-open')));

  // Runs in the capture phase, before the tab button writes sidebarTab.
  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || !tabs.contains(button)) return;
    const open = nextSidebarOpen({
      open: shell.classList.contains('workspace-sidebar-open'),
      clickedActive: button.classList.contains('active')
    });
    shell.classList.toggle('workspace-sidebar-open', open);
  }, true);

  shell.appendChild(toggle);
  return { setLeftOpen };
}
