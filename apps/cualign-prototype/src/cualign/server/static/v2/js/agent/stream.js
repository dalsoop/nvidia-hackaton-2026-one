// SSE streaming integration for cuAlign agent and rule-based planning

import { PlanStream } from '../../../plan-stream.js';
import { chatStream, listPlans, rulePlan } from '../api/endpoints.js';
import { createTurnState, applyStreamEvent, finalizeTurn } from './events.js';
import { STRINGS } from './strings.js';

export async function executeChatStream({
  ctx,
  text,
  constraints = null,
  isResend = false,
  onTurnChange = null
}) {
  const store = ctx.store;
  const state = store.get();
  const caseId = state.caseId;

  if (!caseId) {
    throw new Error('No active case selected');
  }

  const prevPlanId = state.viewingPlanId || null;
  const requestId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : ('req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));

  const currentPlans = state.plans || [];
  const nextPlanNumber = currentPlans.length + 1;

  // Build transcript for model request
  const currentChat = state.chat || [];
  const modelMessages = [];
  for (const item of currentChat) {
    if (item.role === 'user' || item.role === 'assistant') {
      modelMessages.push({ role: item.role, content: item.content });
    }
  }

  if (isResend && modelMessages.length > 0 && modelMessages[modelMessages.length - 1].role === 'user') {
    modelMessages.pop();
  }
  modelMessages.push({ role: 'user', content: text });

  const activeConstraints = constraints !== null ? constraints : (state.constraints || null);

  const turnState = createTurnState({
    requestId,
    caseId,
    nextPlanNumber,
    userMessage: text,
    constraints: activeConstraints
  });

  if (onTurnChange) {
    onTurnChange(turnState);
  }

  const body = {
    messages: modelMessages,
    cualign: {
      request_id: requestId,
      case_id: caseId,
      base_plan_id: prevPlanId,
      constraints: activeConstraints
    }
  };

  try {
    const response = await (ctx.api?.chatStream ? ctx.api.chatStream(body) : chatStream(body));
    if (!response.body) {
      throw new Error('Streaming response body is missing');
    }

    const reader = response.body.getReader();
    const parser = new PlanStream();

    while (true) {
      const { value, done } = await reader.read();
      const events = parser.push(value, done);
      for (const event of events) {
        applyStreamEvent(turnState, event);
      }
      if (onTurnChange) {
        onTurnChange(turnState);
      }
      if (done) {
        break;
      }
    }

    finalizeTurn(turnState);

    if (turnState.selectedPlan && !turnState.hasStreamError) {
      const listFn = ctx.api?.listPlans || listPlans;
      const freshPlans = await listFn(caseId);
      store.set({
        plans: freshPlans,
        viewingPlanId: turnState.selectedPlan.plan_id
      });
    }

    if (onTurnChange) {
      onTurnChange(turnState);
    }
    return turnState;
  } catch (err) {
    turnState.hasStreamError = true;
    turnState.status = 'error';
    const isOverload = turnState.hasOverload;
    turnState.error = {
      title: STRINGS.requestFailed,
      message: isOverload ? STRINGS.overloadNotice : (err.message || STRINGS.requestFailed),
      isOverload
    };
    if (onTurnChange) {
      onTurnChange(turnState);
    }
    return turnState;
  }
}

export async function executeRulePlan({
  ctx,
  constraints = null
}) {
  const store = ctx.store;
  const state = store.get();
  const caseId = state.caseId;

  if (!caseId) {
    throw new Error('No active case selected');
  }

  const viewingPlanId = state.viewingPlanId || null;
  const activeConstraints = constraints !== null ? constraints : (state.constraints || {});

  const ruleFn = ctx.api?.rulePlan || rulePlan;
  const res = await ruleFn({
    case_id: caseId,
    parent_plan_id: viewingPlanId,
    ...activeConstraints
  });

  const selected = res.chosen || res.best_failed;
  if (selected && selected.plan_id) {
    const listFn = ctx.api?.listPlans || listPlans;
    const freshPlans = await listFn(caseId);
    store.set({
      plans: freshPlans,
      viewingPlanId: selected.plan_id
    });
  }

  return res;
}
