// Workspace screen skeleton (J6 contract)

import { clear, h } from '../../ui/dom.js';

export function mount(root, params, ctx) {
  clear(root);

  const container = h('div', { class: 'screen-workspace-placeholder' });
  root.appendChild(container);

  return () => {
    clear(root);
  };
}
