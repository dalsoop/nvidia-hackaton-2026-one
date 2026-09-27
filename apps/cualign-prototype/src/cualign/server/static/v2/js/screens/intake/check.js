// Scan input check screen skeleton (J4 contract)

import { clear, h } from '../../ui/dom.js';

export function mount(root, params, ctx) {
  clear(root);

  const container = h('div', { class: 'screen-check-placeholder' });
  root.appendChild(container);

  return () => {
    clear(root);
  };
}
