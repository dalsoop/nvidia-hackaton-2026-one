import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTurnState,
  applyStreamEvent,
  finalizeTurn,
  turnToChatItems,
  eventsToTurn
} from '../../src/cualign/server/static/v2/js/agent/events.js';

import { executeChatStream, executeRulePlan } from '../../src/cualign/server/static/v2/js/agent/stream.js';
import { createStore } from '../../src/cualign/server/static/v2/js/state/store.js';
import { STRINGS } from '../../src/cualign/server/static/v2/js/agent/strings.js';

test('Agent strings: verify Korean strings match design specifications', () => {
  assert.equal(STRINGS.send, '전송');
  assert.equal(STRINGS.ruleCalc, '규칙으로 계산');
  assert.equal(STRINGS.resend, '다시 보내기');
  assert.equal(STRINGS.requestFailed, '계획 요청 실패');
  assert.equal(STRINGS.overloadNotice, 'NVIDIA API가 일시적으로 과부하 상태입니다. 다시 시도해 주세요.');
  assert.equal(STRINGS.makingPlan(4), '계획 4을 만드는 중');
  assert.equal(STRINGS.makingPlan(1), '계획 1을 만드는 중');
  assert.equal(STRINGS.running, '실행 중');
  assert.equal(STRINGS.done, '완료');
  assert.equal(STRINGS.failed, '실패');
});

test('createTurnState: initializes turn state with correct defaults', () => {
  const turn = createTurnState({
    requestId: 'req-001',
    caseId: 'case-abc',
    nextPlanNumber: 3,
    userMessage: 'Test prompt',
    constraints: { allow_extraction: false }
  });

  assert.equal(turn.requestId, 'req-001');
  assert.equal(turn.caseId, 'case-abc');
  assert.equal(turn.nextPlanNumber, 3);
  assert.equal(turn.userMessage, 'Test prompt');
  assert.deepEqual(turn.constraints, { allow_extraction: false });
  assert.equal(turn.status, 'streaming');
  assert.deepEqual(turn.steps, []);
  assert.equal(turn.assistantText, '');
  assert.equal(turn.selectedPlan, null);
  assert.equal(turn.error, null);
  assert.equal(turn.hasOverload, false);
  assert.equal(turn.hasStreamError, false);
});

test('applyStreamEvent: data events accumulate streamed delta text', () => {
  const turn = createTurnState({
    requestId: 'req-002',
    caseId: 'case-abc',
    nextPlanNumber: 2,
    userMessage: 'Make plan'
  });

  applyStreamEvent(turn, {
    type: 'data',
    data: { choices: [{ delta: { content: 'Plan ' } }] }
  });
  applyStreamEvent(turn, {
    type: 'data',
    data: { choices: [{ delta: { content: 'generated ' } }] }
  });
  applyStreamEvent(turn, {
    type: 'data',
    data: { choices: [{ delta: { content: 'successfully.' } }] }
  });

  assert.equal(turn.assistantText, 'Plan generated successfully.');
});

test('applyStreamEvent: intermediate_data transitions step states', () => {
  const turn = createTurnState({
    requestId: 'req-003',
    caseId: 'case-abc',
    nextPlanNumber: 2
  });

  applyStreamEvent(turn, {
    type: 'intermediate_data',
    data: { name: 'set_constraints', id: 's1', payload: { lock: [13] } }
  });

  assert.equal(turn.steps.length, 1);
  assert.equal(turn.steps[0].name, 'set_constraints');
  assert.equal(turn.steps[0].state, 'running');

  applyStreamEvent(turn, {
    type: 'intermediate_data',
    data: { name: 'plan_stages', id: 's2', payload: null }
  });

  assert.equal(turn.steps.length, 2);
  assert.equal(turn.steps[0].state, 'done');
  assert.equal(turn.steps[1].state, 'running');

  applyStreamEvent(turn, {
    type: 'intermediate_data',
    data: { name: 'validate', id: 's3', payload: null }
  });

  assert.equal(turn.steps.length, 3);
  assert.equal(turn.steps[1].state, 'done');
  assert.equal(turn.steps[2].state, 'running');
});

test('applyStreamEvent: plan_selected matches valid requestId and caseId', () => {
  const turn = createTurnState({
    requestId: 'req-valid',
    caseId: 'case-100',
    nextPlanNumber: 1
  });

  // Mismatched request_id should be ignored
  applyStreamEvent(turn, {
    type: 'plan_selected',
    data: {
      schema_version: 1,
      request_id: 'req-other',
      case_id: 'case-100',
      plan_id: 'p-ignored'
    }
  });
  assert.equal(turn.selectedPlan, null);

  // Matching selection event
  applyStreamEvent(turn, {
    type: 'plan_selected',
    data: {
      schema_version: 1,
      request_id: 'req-valid',
      case_id: 'case-100',
      plan_id: 'p-valid-001',
      strategy: 'expansion'
    }
  });

  assert.notEqual(turn.selectedPlan, null);
  assert.equal(turn.selectedPlan.plan_id, 'p-valid-001');
  assert.equal(turn.selectedPlan.strategy, 'expansion');
});

test('applyStreamEvent: plan_context updates constraints for matching request', () => {
  const turn = createTurnState({
    requestId: 'req-ctx',
    caseId: 'case-100',
    nextPlanNumber: 1
  });

  applyStreamEvent(turn, {
    type: 'plan_context',
    data: {
      request_id: 'req-ctx',
      case_id: 'case-100',
      constraints: { lock: [13, 14], ipr_limit_mm: 0.2 }
    }
  });

  assert.deepEqual(turn.constraints, { lock: [13, 14], ipr_limit_mm: 0.2 });
});

test('applyStreamEvent: plan_error marks running steps failed and records error', () => {
  const turn = createTurnState({
    requestId: 'req-err',
    caseId: 'case-100',
    nextPlanNumber: 2
  });

  applyStreamEvent(turn, {
    type: 'intermediate_data',
    data: { name: 'plan_stages' }
  });

  assert.equal(turn.steps[0].state, 'running');

  applyStreamEvent(turn, {
    type: 'plan_error',
    data: {
      message: 'Failed to find viable stage path',
      code: 'STAGE_ERROR'
    }
  });

  assert.equal(turn.hasStreamError, true);
  assert.equal(turn.steps[0].state, 'failed');
  assert.equal(turn.error.title, STRINGS.requestFailed);
  assert.equal(turn.error.message, 'Failed to find viable stage path');
  assert.equal(turn.error.isOverload, false);
});

test('applyStreamEvent: nim_overload sets isOverload flag and friendly message', () => {
  const turn = createTurnState({
    requestId: 'req-overload',
    caseId: 'case-100',
    nextPlanNumber: 2
  });

  applyStreamEvent(turn, {
    type: 'plan_error',
    data: {
      kind: 'nim_overload',
      request_id: 'req-overload',
      message: 'Overload from NIM server'
    }
  });

  assert.equal(turn.hasOverload, true);
  assert.equal(turn.hasStreamError, true);
  assert.equal(turn.error.isOverload, true);
  assert.equal(turn.error.message, STRINGS.overloadNotice);
});

test('turnToChatItems: in streaming state produces user, trace, and busy card', () => {
  const turn = createTurnState({
    requestId: 'req-busy-test',
    caseId: 'case-100',
    nextPlanNumber: 4,
    userMessage: '13번 움직이지 마'
  });

  applyStreamEvent(turn, {
    type: 'intermediate_data',
    data: { name: 'set_constraints' }
  });

  const items = turnToChatItems(turn);

  assert.equal(items.length, 3);
  assert.equal(items[0].role, 'user');
  assert.equal(items[0].content, '13번 움직이지 마');

  assert.equal(items[1].role, 'trace');
  assert.equal(items[1].steps.length, 1);
  assert.equal(items[1].steps[0].name, 'set_constraints');
  assert.equal(items[1].steps[0].state, 'running');

  assert.equal(items[2].role, 'busy');
  assert.equal(items[2].planNumber, 4);
  assert.equal(items[2].title, '계획 4을 만드는 중');
});

test('turnToChatItems: completed state produces user, trace, and assistant bubble', () => {
  const events = [
    { type: 'intermediate_data', data: { name: 'set_constraints' } },
    { type: 'intermediate_data', data: { name: 'propose_target' } },
    { type: 'data', data: { choices: [{ delta: { content: 'Plan created.' } }] } },
    {
      type: 'plan_selected',
      data: {
        schema_version: 1,
        request_id: 'req-full',
        case_id: 'case-100',
        plan_id: 'p-final-001'
      }
    }
  ];

  const turn = eventsToTurn(events, {
    requestId: 'req-full',
    caseId: 'case-100',
    nextPlanNumber: 3,
    userMessage: 'Please plan'
  });

  assert.equal(turn.status, 'completed');
  assert.equal(turn.steps.every((s) => s.state === 'done'), true);

  const items = turnToChatItems(turn);
  assert.equal(items.length, 3);
  assert.equal(items[0].role, 'user');
  assert.equal(items[1].role, 'trace');
  assert.equal(items[1].steps.length, 2);
  assert.equal(items[2].role, 'assistant');
  assert.equal(items[2].content, 'Plan created.');
  assert.equal(items[2].planId, 'p-final-001');
});

test('turnToChatItems: error state produces user, trace, and error card with resend', () => {
  const events = [
    { type: 'intermediate_data', data: { name: 'set_constraints' } },
    {
      type: 'plan_error',
      data: {
        kind: 'nim_overload',
        request_id: 'req-err-flow',
        message: 'Server busy'
      }
    }
  ];

  const turn = eventsToTurn(events, {
    requestId: 'req-err-flow',
    caseId: 'case-100',
    nextPlanNumber: 2,
    userMessage: 'Retry prompt',
    constraints: { lock: [12] }
  });

  assert.equal(turn.status, 'error');
  assert.equal(turn.steps[0].state, 'failed');

  const items = turnToChatItems(turn);
  assert.equal(items.length, 3);
  assert.equal(items[0].role, 'user');
  assert.equal(items[1].role, 'trace');
  assert.equal(items[2].role, 'error');
  assert.equal(items[2].title, '계획 요청 실패');
  assert.equal(items[2].message, STRINGS.overloadNotice);
  assert.equal(items[2].isOverload, true);
  assert.equal(items[2].canResend, true);
  assert.deepEqual(items[2].originalRequest, {
    text: 'Retry prompt',
    constraints: { lock: [12] }
  });
});

test('turnToChatItems: generic error creates error card without overload', () => {
  const events = [
    {
      type: 'plan_error',
      data: {
        message: 'Internal engine calculation timeout'
      }
    }
  ];

  const turn = eventsToTurn(events, {
    requestId: 'req-generic-err',
    caseId: 'case-200',
    nextPlanNumber: 1,
    userMessage: 'Test calculation'
  });

  assert.equal(turn.status, 'error');
  assert.equal(turn.hasOverload, false);

  const items = turnToChatItems(turn);
  assert.equal(items.length, 2);
  assert.equal(items[0].role, 'user');
  assert.equal(items[1].role, 'error');
  assert.equal(items[1].message, 'Internal engine calculation timeout');
  assert.equal(items[1].isOverload, false);
  assert.equal(items[1].canResend, true);
});

test('eventsToTurn: empty stream without selected plan results in error', () => {
  const turn = eventsToTurn([], {
    requestId: 'req-empty',
    caseId: 'case-300',
    nextPlanNumber: 1,
    userMessage: 'Hello'
  });

  assert.equal(turn.status, 'error');
  assert.equal(turn.selectedPlan, null);
  assert.equal(turn.error.title, STRINGS.requestFailed);
});

test('executeRulePlan: calls rulePlan with viewingPlanId as parent_plan_id and updates store', async () => {
  const store = createStore({
    caseId: 'case-rule-01',
    viewingPlanId: 'p-initial',
    constraints: { allow_extraction: true },
    plans: [{ plan_id: 'p-initial' }]
  });

  let capturedRuleBody = null;
  const mockApi = {
    async rulePlan(body) {
      capturedRuleBody = body;
      return {
        case_id: 'case-rule-01',
        chosen: { plan_id: 'p-new-rule', passed: true },
        tried: [{ plan_id: 'p-new-rule' }]
      };
    },
    async listPlans(caseId) {
      return {
        plans: [{ plan_id: 'p-initial' }, { plan_id: 'p-new-rule' }]
      };
    }
  };

  const res = await executeRulePlan({
    ctx: { store, api: mockApi }
  });

  assert.equal(capturedRuleBody.case_id, 'case-rule-01');
  assert.equal(capturedRuleBody.parent_plan_id, 'p-initial');
  assert.equal(capturedRuleBody.allow_extraction, true);
  assert.equal(res.chosen.plan_id, 'p-new-rule');

  // Verify store plans and viewingPlanId updated
  assert.equal(store.get().viewingPlanId, 'p-new-rule');
  assert.equal(store.get().plans.length, 2);
});

test('executeChatStream: formats request body matching app.js, processes stream, and updates viewingPlanId', async () => {
  const store = createStore({
    caseId: 'case-chat-01',
    viewingPlanId: 'p-base-01',
    constraints: { lock: [14] },
    chat: [
      { role: 'user', content: '처음 요청' },
      { role: 'assistant', content: '처음 답변' }
    ],
    plans: [{ plan_id: 'p-base-01' }]
  });

  let capturedChatBody = null;
  const mockApi = {
    async chatStream(body) {
      capturedChatBody = body;
      const reqId = body.cualign.request_id;
      const caseId = body.cualign.case_id;

      const ssePayload = [
        `event: intermediate_data\ndata: ${JSON.stringify({ name: 'set_constraints', id: 's1' })}\n\n`,
        `event: data\ndata: ${JSON.stringify({ choices: [{ delta: { content: '새 계획이 ' } }] })}\n\n`,
        `event: data\ndata: ${JSON.stringify({ choices: [{ delta: { content: '준비되었습니다.' } }] })}\n\n`,
        `event: plan_selected\ndata: ${JSON.stringify({ schema_version: 1, request_id: reqId, case_id: caseId, plan_id: 'p-chat-02' })}\n\n`,
        `data: [DONE]\n\n`
      ].join('');

      const encoder = new TextEncoder();
      return {
        body: {
          getReader() {
            let done = false;
            return {
              async read() {
                if (done) {
                  return { value: undefined, done: true };
                }
                done = true;
                return { value: encoder.encode(ssePayload), done: false };
              }
            };
          }
        }
      };
    },
    async listPlans(caseId) {
      return [{ plan_id: 'p-base-01' }, { plan_id: 'p-chat-02' }];
    }
  };

  const turn = await executeChatStream({
    ctx: { store, api: mockApi },
    text: '두 번째 요청'
  });

  // Verify request body
  assert.equal(capturedChatBody.cualign.case_id, 'case-chat-01');
  assert.equal(capturedChatBody.cualign.base_plan_id, 'p-base-01');
  assert.deepEqual(capturedChatBody.cualign.constraints, { lock: [14] });
  assert.equal(capturedChatBody.messages.length, 3);
  assert.equal(capturedChatBody.messages[2].content, '두 번째 요청');

  // Verify stream outcome
  assert.equal(turn.status, 'completed');
  assert.equal(turn.assistantText, '새 계획이 준비되었습니다.');
  assert.equal(turn.selectedPlan.plan_id, 'p-chat-02');

  // Verify store state
  assert.equal(store.get().viewingPlanId, 'p-chat-02');
  assert.equal(store.get().plans.length, 2);
});

test('executeChatStream: handles nim_overload stream error and formats error turn', async () => {
  const store = createStore({
    caseId: 'case-overload-01',
    viewingPlanId: null,
    chat: [],
    plans: []
  });

  const mockApi = {
    async chatStream(body) {
      const reqId = body.cualign.request_id;
      const ssePayload = [
        `event: intermediate_data\ndata: ${JSON.stringify({ name: 'prepare' })}\n\n`,
        `event: plan_error\ndata: ${JSON.stringify({ kind: 'nim_overload', request_id: reqId, message: 'Server 503' })}\n\n`
      ].join('');

      const encoder = new TextEncoder();
      return {
        body: {
          getReader() {
            let done = false;
            return {
              async read() {
                if (done) {
                  return { value: undefined, done: true };
                }
                done = true;
                return { value: encoder.encode(ssePayload), done: false };
              }
            };
          }
        }
      };
    }
  };

  const turn = await executeChatStream({
    ctx: { store, api: mockApi },
    text: '과부하 테스트'
  });

  assert.equal(turn.status, 'error');
  assert.equal(turn.hasOverload, true);
  assert.equal(turn.error.isOverload, true);
  assert.equal(turn.error.message, STRINGS.overloadNotice);

  const items = turnToChatItems(turn);
  const errorItem = items.find((i) => i.role === 'error');
  assert.notEqual(errorItem, undefined);
  assert.equal(errorItem.isOverload, true);
  assert.equal(errorItem.message, STRINGS.overloadNotice);
  assert.equal(errorItem.canResend, true);
});

