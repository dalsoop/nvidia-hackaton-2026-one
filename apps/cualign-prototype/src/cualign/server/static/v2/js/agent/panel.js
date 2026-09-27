// Agent chat panel mounting and interaction (J7 contract)

import { clear, h } from '../ui/dom.js';
import { T_AGENT } from '../domain/vocab/agent.js';
import { turnToChatItems } from './events.js';
import { executeChatStream, executeRulePlan } from './stream.js';
import { createRuleIcon, renderChatTranscript } from './view.js';

const CHAT_CASES = new WeakMap();

export function mountAgent(el, ctx) {
  clear(el);

  const initialCaseId = ctx.store?.get().caseId;
  const priorCaseId = ctx.store ? CHAT_CASES.get(ctx.store) : null;
  if (ctx.store && priorCaseId && priorCaseId !== initialCaseId) {
    ctx.store.set({ chat: [] });
  }
  if (ctx.store) {
    CHAT_CASES.set(ctx.store, initialCaseId);
  }

  let isBusy = false;
  let activeTurn = null;
  let unsubscribeStore = null;
  let disposed = false;
  let turnController = null;

  const panel = h('div', { class: 'agent-panel' });
  const header = h('div', { class: 'agent-header' },
    h('h2', { class: 'agent-title' }, T_AGENT.title)
  );

  const transcript = h('div', {
    class: 'agent-transcript',
    role: 'log',
    'aria-live': 'polite'
  });

  const textarea = h('textarea', {
    class: 'agent-textarea',
    rows: 3,
    placeholder: T_AGENT.messagePlaceholder
  });

  const sendBtn = h('button', {
    type: 'button',
    class: 'btn-send',
    disabled: true
  }, T_AGENT.send);

  const ruleSvg = createRuleIcon();

  const ruleCalcBtn = h('button', {
    type: 'button',
    class: 'btn-rule-calc'
  }, ruleSvg, T_AGENT.ruleCalc);

  const actions = h('div', { class: 'agent-actions' }, sendBtn, ruleCalcBtn);

  const inputContainer = h('div', { class: 'agent-input-container' },
    h('label', { class: 'agent-input-label' },
      h('span', { class: 'sr-only' }, T_AGENT.messageLabel),
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
    const storeState = ctx.store ? ctx.store.get() : {};
    const allItems = (storeState.chat || [])
      .filter((item) => !item.caseId || item.caseId === storeState.caseId);
    if (activeTurn) {
      allItems.push(...turnToChatItems(activeTurn));
    }
    renderChatTranscript(transcript, allItems, {
      isBusy,
      ruleIcon: ruleSvg,
      onResend: (item) => {
        const req = item.originalRequest || {};
        handleSend(req.text, { isResend: true, constraints: req.constraints });
      }
    });
  }

  async function handleSend(customText = null, { isResend = false, constraints } = {}) {
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
    turnController = new AbortController();

    try {
      const turnResult = await executeChatStream({
        ctx,
        text,
        constraints,
        isResend,
        signal: turnController.signal,
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
      // Leaving the screen aborts the turn; nothing is left to report.
      if (disposed) return;
      if (ctx.store) {
        const currentChat = ctx.store.get().chat || [];
        ctx.store.set({
          chat: [...currentChat, {
            role: 'error',
            title: T_AGENT.requestFailed,
            message: err.message || T_AGENT.requestFailed,
            canResend: false,
            caseId: ctx.store.get().caseId
          }]
        });
      }
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

    const storeState = ctx.store ? ctx.store.get() : {};
    const rawPlans = storeState.plans;
    const currentPlans = Array.isArray(rawPlans) ? rawPlans : (rawPlans?.plans || []);
    const nextPlanNumber = currentPlans.length + 1;

    const noticeItem = {
      role: 'system',
      content: T_AGENT.ruleFallbackNotice,
      caseId: storeState.caseId
    };

    if (ctx.store) {
      const currentChat = ctx.store.get().chat || [];
      ctx.store.set({ chat: [...currentChat, noticeItem] });
    }

    activeTurn = {
      requestId: 'rule-' + Date.now(),
      status: 'streaming',
      nextPlanNumber,
      steps: [],
      userMessage: ''
    };
    renderTranscript();

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
              title: T_AGENT.requestFailed,
              message: err.message || T_AGENT.requestFailed,
              canResend: false,
              caseId: ctx.store.get().caseId
            }
          ]
        });
      }
    } finally {
      activeTurn = null;
      isBusy = false;
      updateControls();
      renderTranscript();
    }
  }

  textarea.addEventListener('input', () => {
    updateControls();
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.isComposing) {
      return;
    }
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
    disposed = true;
    turnController?.abort();
    if (unsubscribeStore) {
      unsubscribeStore();
      unsubscribeStore = null;
    }
    clear(el);
  };
}
