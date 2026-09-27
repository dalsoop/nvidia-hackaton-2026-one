// Cases list screen skeleton (J2 contract)

import { clear, h } from '../../ui/dom.js';

export function mount(root, params, ctx) {
  clear(root);

  const container = h('div', { class: 'screen-cases-placeholder' });
  root.appendChild(container);

  return () => {
    clear(root);
  };
}
