// Agent chat panel skeleton (J7 contract)

import { clear, h } from '../ui/dom.js';

export function mountAgent(el, ctx) {
  clear(el);

  const container = h('div', { class: 'agent-panel-placeholder' });
  el.appendChild(container);

  return () => {
    clear(el);
  };
}
