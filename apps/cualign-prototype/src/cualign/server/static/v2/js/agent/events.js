// Pure event transformation and turn state management for agent streaming

import { matchesSelection } from '../../../plan-stream.js';
import { STRINGS } from './strings.js';

export function createTurnState({
  requestId,
  caseId,
  nextPlanNumber = 1,
  userMessage = '',
  constraints = null
}) {
  return {
    requestId,
    caseId,
    nextPlanNumber: Number(nextPlanNumber) || 1,
    userMessage,
    constraints,
    status: 'streaming', // 'streaming' | 'completed' | 'error'
    steps: [],
    assistantText: '',
    selectedPlan: null,
    error: null,
    hasOverload: false,
    hasStreamError: false
  };
}

export function applyStreamEvent(turnState, event) {
  if (!event || !event.type) {
    return turnState;
  }

  const { type, data } = event;

  if (type === 'data') {
    const ch = data && data.choices && data.choices[0];
    const delta = (ch && (ch.delta?.content ?? ch.message?.content)) ?? data?.value ?? '';
    if (typeof delta === 'string') {
      turnState.assistantText += delta;
    }
  } else if (type === 'intermediate_data') {
    for (const step of turnState.steps) {
      if (step.state === 'running') {
        step.state = 'done';
      }
    }
    const name = (data && data.name) || 'step';
    const id = (data && data.id) || ('step-' + (turnState.steps.length + 1));
    turnState.steps.push({
      id,
      name,
      payload: data?.payload ?? null,
      state: 'running'
    });
  } else if (type === 'plan_selected') {
    if (data && matchesSelection(data, turnState.requestId, turnState.caseId)) {
      turnState.selectedPlan = data;
    }
  } else if (type === 'plan_context') {
    if (data && data.request_id === turnState.requestId && data.case_id === turnState.caseId) {
      turnState.constraints = data.constraints;
    }
  } else if (type === 'plan_error' || type === 'error' || (data && data.code)) {
    turnState.hasStreamError = true;
    for (const step of turnState.steps) {
      if (step.state === 'running') {
        step.state = 'failed';
      }
    }
    const isOverload = Boolean(data && data.kind === 'nim_overload' && data.request_id === turnState.requestId);
    if (isOverload) {
      turnState.hasOverload = true;
    }
    const message = isOverload
      ? STRINGS.overloadNotice
      : ((data && (data.message || data.detail)) || STRINGS.requestFailed);

    turnState.error = {
      title: STRINGS.requestFailed,
      message,
      isOverload
    };
  }

  return turnState;
}

export function finalizeTurn(turnState) {
  if (turnState.selectedPlan && !turnState.hasStreamError) {
    turnState.status = 'completed';
    for (const step of turnState.steps) {
      if (step.state === 'running') {
        step.state = 'done';
      }
    }
  } else {
    turnState.status = 'error';
    for (const step of turnState.steps) {
      if (step.state === 'running') {
        step.state = 'failed';
      }
    }
    if (!turnState.error) {
      const message = turnState.hasOverload
        ? STRINGS.overloadNotice
        : (turnState.assistantText || STRINGS.requestFailed);

      turnState.error = {
        title: STRINGS.requestFailed,
        message,
        isOverload: turnState.hasOverload
      };
    }
  }

  return turnState;
}

export function turnToChatItems(turnState) {
  const items = [];

  if (turnState.userMessage) {
    items.push({
      id: 'user-' + turnState.requestId,
      role: 'user',
      content: turnState.userMessage
    });
  }

  if (turnState.steps.length > 0) {
    items.push({
      id: 'trace-' + turnState.requestId,
      role: 'trace',
      steps: turnState.steps.map((s) => ({ ...s }))
    });
  }

  if (turnState.status === 'streaming') {
    items.push({
      id: 'busy-' + turnState.requestId,
      role: 'busy',
      planNumber: turnState.nextPlanNumber,
      title: STRINGS.makingPlan(turnState.nextPlanNumber)
    });
  } else if (turnState.status === 'completed') {
    items.push({
      id: 'assistant-' + turnState.requestId,
      role: 'assistant',
      content: turnState.assistantText,
      planId: turnState.selectedPlan?.plan_id || null
    });
  } else if (turnState.status === 'error') {
    items.push({
      id: 'error-' + turnState.requestId,
      role: 'error',
      title: (turnState.error && turnState.error.title) || STRINGS.requestFailed,
      message: (turnState.error && turnState.error.message) || STRINGS.requestFailed,
      isOverload: Boolean(turnState.error && turnState.error.isOverload),
      canResend: true,
      originalRequest: {
        text: turnState.userMessage,
        constraints: turnState.constraints
      }
    });
  }

  return items;
}

export function eventsToTurn(events, initialConfig) {
  const turn = createTurnState(initialConfig);
  for (const event of events) {
    applyStreamEvent(turn, event);
  }
  return finalizeTurn(turn);
}
