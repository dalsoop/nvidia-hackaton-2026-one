// Patient & scan intake screen skeleton (J3 contract)

import { clear, h } from '../../ui/dom.js';

export function mount(root, params, ctx) {
  clear(root);

  const container = h('div', { class: 'screen-patient-placeholder' });
  root.appendChild(container);

  return () => {
    clear(root);
  };
}
