// Agent chat panel mounting and interaction (J7 contract)

import { clear, h } from '../ui/dom.js';
import { STRINGS } from './strings.js';
import { turnToChatItems } from './events.js';
import { executeChatStream, executeRulePlan } from './stream.js';

export function mountAgent(el, ctx) {
  clear(el);

  let isBusy = false;
  let activeTurn = null;
  let unsubscribeStore = null;

  const panel = h('div', { class: 'agent-panel' });
  const header = h('div', { class: 'agent-header' },
    h('h2', { class: 'agent-title' }, STRINGS.agentTitle)
  );

  const transcript = h('div', {
    class: 'agent-transcript',
    role: 'log',
    'aria-live': 'polite'
  });

  const textarea = h('textarea', {
    class: 'agent-textarea',
    rows: 3,
    placeholder: STRINGS.messagePlaceholder
  });

  const sendBtn = h('button', {
    type: 'button',
    class: 'btn-send',
    disabled: true
  }, STRINGS.send);

  const ruleSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ruleSvg.setAttribute('width', '13');
  ruleSvg.setAttribute('height', '13');
  ruleSvg.setAttribute('viewBox', '0 0 24 24');
  ruleSvg.setAttribute('fill', 'none');
  ruleSvg.setAttribute('stroke', 'currentColor');
  ruleSvg.setAttribute('stroke-width', '2');
  ruleSvg.setAttribute('stroke-linecap', 'round');
  ruleSvg.setAttribute('stroke-linejoin', 'round');
  const rulePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  rulePath.setAttribute('d', 'M13 3L5 13.5h6l-1 7.5 8-10.5h-6z');
  ruleSvg.appendChild(rulePath);

  const ruleCalcBtn = h('button', {
    type: 'button',
    class: 'btn-rule-calc'
  }, ruleSvg, STRINGS.ruleCalc);

  const actions = h('div', { class: 'agent-actions' }, sendBtn, ruleCalcBtn);

  const inputContainer = h('div', { class: 'agent-input-container' },
    h('label', { class: 'agent-input-label' },
      h('span', { class: 'sr-only' }, STRINGS.messageLabel),
      textarea
    ),
    actions
  );

  panel.appendChild(header);
  panel.appendChild(transcript);
  panel.appendChild(inputContainer);
  el.appendChild(panel);

  function updateControls() {
    textarea.disabled = isBusy;
    ruleCalcBtn.disabled = isBusy;
    sendBtn.disabled = isBusy || !textarea.value.trim();
  }

  function renderTranscript() {
    clear(transcript);

    const storeState = ctx.store ? ctx.store.get() : {};
    const chatHistory = storeState.chat || [];

    // All committed items plus current in-progress active turn items
    const allItems = [...chatHistory];
    if (activeTurn) {
      const activeItems = turnToChatItems(activeTurn);
      allItems.push(...activeItems);
    }

    for (const item of allItems) {
      if (item.role === 'user') {
        const wrap = h('div', { class: 'agent-msg-user-wrap' },
          h('div', { class: 'agent-bubble-user' }, item.content)
        );
        transcript.appendChild(wrap);
      } else if (item.role === 'trace') {
        const traceEl = h('div', { class: 'agent-trace' });
        for (const step of item.steps) {
          const dotClass = 'agent-trace-dot ' + (step.state || 'running');
          const stateLabel = step.state === 'done'
            ? STRINGS.done
            : (step.state === 'failed' ? STRINGS.failed : STRINGS.running);

          const stepEl = h('div', { class: 'agent-trace-step' },
            h('span', { class: dotClass }),
            h('span', { class: 'agent-trace-name' }, step.name),
            h('span', { class: 'agent-trace-state' }, stateLabel)
          );
          traceEl.appendChild(stepEl);
        }
        transcript.appendChild(traceEl);
      } else if (item.role === 'busy') {
        const busyEl = h('div', { class: 'agent-busy-card', 'aria-busy': 'true' },
          h('span', { class: 'agent-busy-title' }, item.title),
          h('div', { class: 'agent-busy-bars' },
            h('span', { class: 'agent-busy-bar-1' }),
            h('span', { class: 'agent-busy-bar-2' })
          )
        );
        transcript.appendChild(busyEl);
      } else if (item.role === 'assistant') {
        if (item.content) {
          const bubble = h('div', { class: 'agent-bubble-assistant' }, item.content);
          transcript.appendChild(bubble);
        }
      } else if (item.role === 'error') {
        const titleEl = h('b', null, item.title || STRINGS.requestFailed);
        const bubble = h('div', { class: 'agent-bubble-error' }, titleEl, item.message || '');
        const resendBtn = h('button', {
          type: 'button',
          class: 'btn-resend',
          disabled: isBusy,
          onClick: () => {
            const req = item.originalRequest || {};
            handleSend(req.text, { isResend: true, constraints: req.constraints });
          }
        }, STRINGS.resend);

        const wrap = h('div', { class: 'agent-error-wrap' }, bubble, resendBtn);
        transcript.appendChild(wrap);
      } else if (item.role === 'system') {
        const noticeEl = h('div', { class: 'agent-system-notice' },
          ruleSvg.cloneNode(true),
          item.content
        );
        transcript.appendChild(noticeEl);
      }
    }

    transcript.scrollTop = transcript.scrollHeight;
  }

  async function handleSend(customText = null, { isResend = false, constraints = null } = {}) {
    if (isBusy) {
      return;
    }

    const text = (customText !== null ? customText : textarea.value).trim();
    if (!text) {
      return;
    }

    if (customText === null) {
      textarea.value = '';
    }

    isBusy = true;
    updateControls();

    try {
      const turnResult = await executeChatStream({
        ctx,
        text,
        constraints,
        isResend,
        onTurnChange: (turn) => {
          activeTurn = turn;
          renderTranscript();
        }
      });

      const finalItems = turnToChatItems(turnResult);
      activeTurn = null;

      if (ctx.store) {
        const currentChat = ctx.store.get().chat || [];
        ctx.store.set({ chat: [...currentChat, ...finalItems] });
      }
    } catch (err) {
      activeTurn = null;
    } finally {
      isBusy = false;
      updateControls();
      renderTranscript();
    }
  }

  async function handleRuleCalc() {
    if (isBusy) {
      return;
    }

    isBusy = true;
    updateControls();

    const noticeItem = {
      role: 'system',
      content: STRINGS.ruleFallbackNotice
    };

    if (ctx.store) {
      const currentChat = ctx.store.get().chat || [];
      ctx.store.set({ chat: [...currentChat, noticeItem] });
    }

    try {
      await executeRulePlan({ ctx });
    } catch (err) {
      if (ctx.store) {
        const currentChat = ctx.store.get().chat || [];
        ctx.store.set({
          chat: [
            ...currentChat,
            {
              role: 'error',
              title: STRINGS.requestFailed,
              message: err.message || STRINGS.requestFailed,
              canResend: false
            }
          ]
        });
      }
    } finally {
      isBusy = false;
      updateControls();
      renderTranscript();
    }
  }

  textarea.addEventListener('input', () => {
    updateControls();
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn.addEventListener('click', () => {
    handleSend();
  });

  ruleCalcBtn.addEventListener('click', () => {
    handleRuleCalc();
  });

  if (ctx.store) {
    unsubscribeStore = ctx.store.subscribe(() => {
      renderTranscript();
    });
  }

  updateControls();
  renderTranscript();

  return () => {
    if (unsubscribeStore) {
      unsubscribeStore();
      unsubscribeStore = null;
    }
    clear(el);
  };
}
