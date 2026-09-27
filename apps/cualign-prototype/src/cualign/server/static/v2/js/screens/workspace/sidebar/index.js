// Workspace right sidebar skeleton (J8 contract)

import { clear, h } from '../../../ui/dom.js';

export function mountSidebar(el, ctx) {
  clear(el);

  const container = h('div', { class: 'sidebar-placeholder' });
  el.appendChild(container);

  return () => {
    clear(el);
  };
}
