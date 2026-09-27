// SSE streaming integration for cuAlign agent and rule-based planning

import { PlanStream } from '../../../plan-stream.js';
import { chatStream, listPlans, rulePlan } from '../api/endpoints.js';
import { T_AGENT } from '../domain/vocab/agent.js';
import { createTurnState, applyStreamEvent, finalizeTurn } from './events.js';

function plansFrom(state) {
  const raw = state.plans;
  return Array.isArray(raw) ? raw : (raw?.plans || []);
}

function viewingPlanFrom(state) {
  if ((state.viewingPlan?.plan_id || state.viewingPlan?.id) === state.viewingPlanId) {
    return state.viewingPlan;
  }
  return plansFrom(state).find((plan) => (plan.plan_id || plan.id) === state.viewingPlanId);
}

export function resolvePlanConstraints(state, supplied) {
  if (supplied && typeof supplied === 'object' && !Array.isArray(supplied)) {
    return supplied;
  }
  const current = viewingPlanFrom(state)?.constraints ?? state.constraints;
  return current && typeof current === 'object' && !Array.isArray(current) ? current : undefined;
}

export function buildChatRequest({ state, text, requestId, constraints, isResend = false }) {
  const messages = (state.chat || [])
    .filter((item) => !item.caseId || item.caseId === state.caseId)
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({ role: item.role, content: item.content }));

  if (isResend && messages.at(-1)?.role === 'user') {
    messages.pop();
  }
  messages.push({ role: 'user', content: text });

  const cualign = {
    request_id: requestId,
    case_id: state.caseId,
    base_plan_id: state.viewingPlanId || null
  };
  if (constraints !== undefined) {
    cualign.constraints = constraints;
  }
  return { messages, cualign };
}

export async function executeChatStream({
  ctx,
  text,
  constraints,
  isResend = false,
  onTurnChange = null
}) {
  const store = ctx.store;
  const state = store.get();
  const caseId = state.caseId;

  if (!caseId) {
    throw new Error('No active case selected');
  }

  const requestId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : ('req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));

  const currentPlans = plansFrom(state);
  const nextPlanNumber = currentPlans.length + 1;
  const activeConstraints = resolvePlanConstraints(state, constraints);

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

  const body = buildChatRequest({ state, text, requestId, constraints: activeConstraints, isResend });

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
      const freshPlansRes = await listFn(caseId);
      const freshPlans = Array.isArray(freshPlansRes) ? freshPlansRes : (freshPlansRes?.plans || []);
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
      title: T_AGENT.requestFailed,
      message: err.message || (isOverload ? T_AGENT.overloadNotice : T_AGENT.requestFailed),
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
  constraints
}) {
  const store = ctx.store;
  const state = store.get();
  const caseId = state.caseId;

  if (!caseId) {
    throw new Error('No active case selected');
  }

  const viewingPlanId = state.viewingPlanId || null;
  const activeConstraints = resolvePlanConstraints(state, constraints) || {};

  const ruleFn = ctx.api?.rulePlan || rulePlan;
  const res = await ruleFn({
    case_id: caseId,
    ...activeConstraints,
    parent_plan_id: viewingPlanId
  });

  const selected = res.chosen || res.best_failed;
  if (selected && selected.plan_id) {
    const listFn = ctx.api?.listPlans || listPlans;
    const freshPlansRes = await listFn(caseId);
    const freshPlans = Array.isArray(freshPlansRes) ? freshPlansRes : (freshPlansRes?.plans || []);
    store.set({
      plans: freshPlans,
      viewingPlanId: selected.plan_id
    });
  } else {
    const unsupported = Array.isArray(res.unsupported) ? res.unsupported.join('\n') : '';
    throw new Error(unsupported || T_AGENT.noPlanCreated);
  }

  return res;
}
