import { clear, h } from '../ui/dom.js';
import { T_AGENT } from '../domain/vocab/agent.js';

export function createRuleIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({
    width: '13', height: '13', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  })) {
    svg.setAttribute(name, value);
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M13 3L5 13.5h6l-1 7.5 8-10.5h-6z');
  svg.appendChild(path);
  return svg;
}

function renderTrace(item) {
  const trace = h('div', { class: 'agent-trace' });
  for (const step of item.steps) {
    const stateLabel = step.state === 'done'
      ? T_AGENT.done
      : (step.state === 'failed' ? T_AGENT.failed : T_AGENT.running);
    trace.appendChild(h('div', { class: 'agent-trace-step' },
      h('span', { class: `agent-trace-dot ${step.state || 'running'}` }),
      h('span', { class: 'agent-trace-name' }, T_AGENT.tools[step.name] || step.name),
      h('span', { class: 'agent-trace-state' }, stateLabel)
    ));
  }
  return trace;
}

function renderError(item, isBusy, onResend) {
  const showTitle = !item.isOverload && item.title && item.message && item.title !== item.message;
  const bubble = h('div', { class: 'agent-bubble-error' },
    showTitle ? h('b', null, item.title) : null,
    item.message || item.title || T_AGENT.requestFailed
  );
  const elements = [bubble];
  if (item.canResend !== false) {
    elements.push(h('button', {
      type: 'button', class: 'btn-resend', disabled: isBusy, onClick: () => onResend(item)
    }, T_AGENT.resend));
  }
  return h('div', { class: 'agent-error-wrap' }, ...elements);
}

export function renderChatTranscript(transcript, items, { isBusy, onResend, ruleIcon }) {
  clear(transcript);
  for (const item of items) {
    if (item.role === 'user') {
      transcript.appendChild(h('div', { class: 'agent-msg-user-wrap' },
        h('div', { class: 'agent-bubble-user' }, item.content)
      ));
    } else if (item.role === 'trace') {
      transcript.appendChild(renderTrace(item));
    } else if (item.role === 'busy') {
      transcript.appendChild(h('div', { class: 'agent-busy-card', 'aria-busy': 'true' },
        h('span', { class: 'agent-busy-title' }, item.title),
        h('div', { class: 'agent-busy-bars' },
          h('span', { class: 'agent-busy-bar-1' }), h('span', { class: 'agent-busy-bar-2' })
        )
      ));
    } else if (item.role === 'assistant' && item.content) {
      transcript.appendChild(h('div', { class: 'agent-bubble-assistant' }, item.content));
    } else if (item.role === 'error') {
      transcript.appendChild(renderError(item, isBusy, onResend));
    } else if (item.role === 'system') {
      transcript.appendChild(h('div', { class: 'agent-system-notice' }, ruleIcon.cloneNode(true), item.content));
    }
  }
  transcript.scrollTop = transcript.scrollHeight;
}
