import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTurnState,
  applyStreamEvent,
  finalizeTurn,
  turnToChatItems,
  eventsToTurn
} from '../../src/cualign/server/static/v2/js/agent/events.js';

import {
  buildChatRequest,
  executeChatStream,
  executeRulePlan,
  resolvePlanConstraints
} from '../../src/cualign/server/static/v2/js/agent/stream.js';
import { createStore } from '../../src/cualign/server/static/v2/js/state/store.js';
import { T_AGENT } from '../../src/cualign/server/static/v2/js/domain/vocab/agent.js';

test('Agent vocabulary matches the design', () => {
  assert.equal(T_AGENT.send, '전송');
  assert.equal(T_AGENT.ruleCalc, '규칙으로 계산');
  assert.equal(T_AGENT.resend, '다시 보내기');
  assert.equal(T_AGENT.requestFailed, '계획 요청 실패');
  assert.equal(T_AGENT.overloadNotice, 'NVIDIA API가 일시적으로 과부하 상태입니다. 다시 시도해 주세요.');
  assert.equal(T_AGENT.makingPlan(4), '계획 4 만드는 중');
  assert.equal(T_AGENT.makingPlan(1), '계획 1 만드는 중');
  assert.equal(T_AGENT.running, '실행 중');
  assert.equal(T_AGENT.done, '완료');
  assert.equal(T_AGENT.failed, '실패');
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
  assert.equal(turn.error.title, T_AGENT.requestFailed);
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
  assert.equal(turn.error.message, 'Overload from NIM server');
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
  assert.equal(items[2].title, '계획 4 만드는 중');
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
  assert.equal(items[2].message, 'Server busy');
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
  assert.equal(turn.error.title, T_AGENT.requestFailed);
});

test('buildChatRequest omits absent constraints and excludes another case transcript', () => {
  const body = buildChatRequest({
    state: {
      caseId: 'case-current',
      viewingPlanId: 'plan-parent',
      chat: [
        { role: 'user', content: 'old case', caseId: 'case-old' },
        { role: 'assistant', content: 'current answer', caseId: 'case-current' }
      ]
    },
    text: 'current request',
    requestId: 'request-current',
    constraints: undefined
  });

  assert.equal(Object.hasOwn(body.cualign, 'constraints'), false);
  assert.equal(body.cualign.base_plan_id, 'plan-parent');
  assert.deepEqual(body.messages, [
    { role: 'assistant', content: 'current answer' },
    { role: 'user', content: 'current request' }
  ]);
});

test('resolvePlanConstraints uses the viewed plan conditions', () => {
  const state = {
    viewingPlanId: 'plan-current',
    viewingPlan: { plan_id: 'plan-current', constraints: { lock: [8] } },
    plans: [{ plan_id: 'plan-summary', constraints: { lock: [9] } }]
  };

  assert.deepEqual(resolvePlanConstraints(state), { lock: [8] });
  assert.deepEqual(resolvePlanConstraints(state, { lock: [10] }), { lock: [10] });
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
  assert.equal(turn.error.message, 'Server 503');

  const items = turnToChatItems(turn);
  const errorItem = items.find((i) => i.role === 'error');
  assert.notEqual(errorItem, undefined);
  assert.equal(errorItem.isOverload, true);
  assert.equal(errorItem.message, 'Server 503');
  assert.equal(errorItem.canResend, true);
});

test('turnToChatItems: omits user and trace items when empty', () => {
  const turn = createTurnState({
    requestId: 'req-empty-items',
    caseId: 'case-100',
    nextPlanNumber: 1,
    userMessage: ''
  });
  turn.status = 'completed';
  turn.assistantText = '결과가 준비되었습니다.';

  const items = turnToChatItems(turn);
  assert.equal(items.length, 1);
  assert.equal(items[0].role, 'assistant');
  assert.equal(items[0].content, '결과가 준비되었습니다.');
});

test('applyStreamEvent: keeps done steps as done when plan_error arrives', () => {
  const turn = createTurnState({
    requestId: 'req-mixed-steps',
    caseId: 'case-100',
    nextPlanNumber: 2
  });

  applyStreamEvent(turn, { type: 'intermediate_data', data: { name: 'step_one' } });
  applyStreamEvent(turn, { type: 'intermediate_data', data: { name: 'step_two' } });

  assert.equal(turn.steps[0].state, 'done');
  assert.equal(turn.steps[1].state, 'running');

  applyStreamEvent(turn, {
    type: 'plan_error',
    data: { message: 'Engine failure on step two' }
  });

  assert.equal(turn.steps[0].state, 'done');
  assert.equal(turn.steps[1].state, 'failed');
  assert.equal(turn.hasStreamError, true);
});

test('eventsToTurn: full multi-step workflow with plan_context and final plan selection', () => {
  const events = [
    { type: 'intermediate_data', data: { name: 'set_constraints' } },
    {
      type: 'plan_context',
      data: {
        request_id: 'req-full-flow',
        case_id: 'case-full',
        constraints: { lock: [11, 21], ipr_limit_mm: 0.3 }
      }
    },
    { type: 'intermediate_data', data: { name: 'propose_target' } },
    { type: 'data', data: { choices: [{ delta: { content: '목표 배열 생성 완료. ' } }] } },
    { type: 'intermediate_data', data: { name: 'plan_stages' } },
    { type: 'data', data: { choices: [{ delta: { content: '총 14단계 계획입니다.' } }] } },
    {
      type: 'plan_selected',
      data: {
        schema_version: 1,
        request_id: 'req-full-flow',
        case_id: 'case-full',
        plan_id: 'plan-success-99'
      }
    }
  ];

  const turn = eventsToTurn(events, {
    requestId: 'req-full-flow',
    caseId: 'case-full',
    nextPlanNumber: 5,
    userMessage: '처방 조건대로 계획해 주세요'
  });

  assert.equal(turn.status, 'completed');
  assert.equal(turn.hasStreamError, false);
  assert.deepEqual(turn.constraints, { lock: [11, 21], ipr_limit_mm: 0.3 });
  assert.equal(turn.assistantText, '목표 배열 생성 완료. 총 14단계 계획입니다.');
  assert.equal(turn.steps.length, 3);
  assert.equal(turn.steps.every((s) => s.state === 'done'), true);

  const items = turnToChatItems(turn);
  assert.equal(items.length, 3);
  assert.equal(items[0].role, 'user');
  assert.equal(items[0].content, '처방 조건대로 계획해 주세요');
  assert.equal(items[1].role, 'trace');
  assert.equal(items[1].steps.length, 3);
  assert.equal(items[2].role, 'assistant');
  assert.equal(items[2].content, '목표 배열 생성 완료. 총 14단계 계획입니다.');
  assert.equal(items[2].planId, 'plan-success-99');
});

test('executeChatStream: isResend replaces previous user message in transcript', async () => {
  const store = createStore({
    caseId: 'case-resend-01',
    viewingPlanId: null,
    chat: [
      { role: 'user', content: '처음 실패한 메시지' }
    ],
    plans: []
  });

  let capturedChatBody = null;
  const mockApi = {
    async chatStream(body) {
      capturedChatBody = body;
      const ssePayload = `data: [DONE]\n\n`;
      const encoder = new TextEncoder();
      return {
        body: {
          getReader() {
            let done = false;
            return {
              async read() {
                if (done) return { value: undefined, done: true };
                done = true;
                return { value: encoder.encode(ssePayload), done: false };
              }
            };
          }
        }
      };
    }
  };

  await executeChatStream({
    ctx: { store, api: mockApi },
    text: '처음 실패한 메시지',
    isResend: true
  });

  // Verify only 1 user message exists in the sent body messages (not duplicated)
  assert.equal(capturedChatBody.messages.length, 1);
  assert.equal(capturedChatBody.messages[0].role, 'user');
  assert.equal(capturedChatBody.messages[0].content, '처음 실패한 메시지');
});

test('executeRulePlan: throws error when caseId is missing', async () => {
  const store = createStore({
    caseId: null,
    viewingPlanId: null
  });

  await assert.rejects(
    async () => {
      await executeRulePlan({ ctx: { store, api: {} } });
    },
    /No active case selected/
  );
});

test('T_AGENT: vocab dictionary provides accurate Korean terms and tool labels', () => {
  assert.equal(T_AGENT.title, '에이전트');
  assert.equal(T_AGENT.send, '전송');
  assert.equal(T_AGENT.ruleCalc, '규칙으로 계산');
  assert.equal(T_AGENT.resend, '다시 보내기');
  assert.equal(T_AGENT.requestFailed, '계획 요청 실패');
  assert.equal(T_AGENT.overloadNotice, 'NVIDIA API가 일시적으로 과부하 상태입니다. 다시 시도해 주세요.');
  assert.equal(T_AGENT.makingPlan(5), '계획 5 만드는 중');
  assert.equal(T_AGENT.tools.load_case, '케이스 불러오기');
  assert.equal(T_AGENT.tools.set_constraints, '처방 반영');
  assert.equal(T_AGENT.tools.propose_target, '목표 배열 제안');
  assert.equal(T_AGENT.tools.plan_stages, '단계 계획');
  assert.equal(T_AGENT.tools.validate, '규칙 검사');
  assert.equal(T_AGENT.tools.export_stl, '출력 파일 생성');
});

test('executeRulePlan: selects best_failed when chosen is not available', async () => {
  const store = createStore({
    caseId: 'case-rule-fail',
    viewingPlanId: 'p-prev',
    constraints: {},
    plans: [{ plan_id: 'p-prev' }]
  });

  const mockApi = {
    async rulePlan() {
      return {
        case_id: 'case-rule-fail',
        chosen: null,
        best_failed: { plan_id: 'p-failed-best', passed: false },
        tried: [{ plan_id: 'p-failed-best' }]
      };
    },
    async listPlans() {
      return [{ plan_id: 'p-prev' }, { plan_id: 'p-failed-best' }];
    }
  };

  const res = await executeRulePlan({
    ctx: { store, api: mockApi }
  });

  assert.equal(res.chosen, null);
  assert.equal(res.best_failed.plan_id, 'p-failed-best');
  assert.equal(store.get().viewingPlanId, 'p-failed-best');
  assert.equal(store.get().plans.length, 2);
});

test('executeRulePlan reports unsupported cases instead of silently finishing', async () => {
  const store = createStore({
    caseId: 'case-unsupported',
    viewingPlanId: 'plan-parent',
    plans: [{ plan_id: 'plan-parent', constraints: { allow_extraction: false } }]
  });

  await assert.rejects(
    executeRulePlan({
      ctx: {
        store,
        api: { async rulePlan() { return { chosen: null, unsupported: ['unsupported scan'] }; } }
      }
    }),
    /unsupported scan/
  );
});

test('executeChatStream: throws error when caseId is null', async () => {
  const store = createStore({
    caseId: null,
    viewingPlanId: null
  });

  await assert.rejects(
    async () => {
      await executeChatStream({
        ctx: { store, api: {} },
        text: 'hello'
      });
    },
    /No active case selected/
  );
});

