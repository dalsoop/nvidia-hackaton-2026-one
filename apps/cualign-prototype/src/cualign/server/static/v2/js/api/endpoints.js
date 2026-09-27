// API client endpoints for backend communication

import { T } from '../domain/vocab.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(url, options = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new ApiError(0, err.message || T.errors.network);
  }

  if (!res.ok) {
    let message = res.statusText || T.errors.requestFailed;
    const text = await res.text();
    if (text) {
      try {
        const body = JSON.parse(text);
        if (body && body.detail) {
          message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
        } else {
          message = text;
        }
      } catch (parseErr) {
        message = text;
      }
    }
    throw new ApiError(res.status, message);
  }

  return res.json();
}

export function listCases() {
  return request('/api/cases');
}

export function activateCase(caseId) {
  return request(`/api/cases/${encodeURIComponent(caseId)}/activate`, {
    method: 'POST'
  });
}

export function caseMesh(caseId) {
  return request(`/api/cases/${encodeURIComponent(caseId)}/mesh`);
}

export function caseCheck(caseId) {
  return request(`/api/cases/${encodeURIComponent(caseId)}/check`);
}

export function uploadCase(files) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  return request('/api/cases/upload', {
    method: 'POST',
    body: formData
  });
}

export function listPatients() {
  return request('/api/patients');
}

export function createPatient(alias, memo = '') {
  return request('/api/patients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias, memo })
  });
}

export function getPatient(pid) {
  return request(`/api/patients/${encodeURIComponent(pid)}`);
}

export function uploadScan(pid, files) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  return request(`/api/patients/${encodeURIComponent(pid)}/scans`, {
    method: 'POST',
    body: formData
  });
}

export function confirmScan(pid, sid, revision = null) {
  return request(`/api/patients/${encodeURIComponent(pid)}/scans/${encodeURIComponent(sid)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision })
  });
}

export function mirrorScan(pid, sid) {
  return request(`/api/patients/${encodeURIComponent(pid)}/scans/${encodeURIComponent(sid)}/mirror`, {
    method: 'POST'
  });
}

export function deleteScan(pid, sid) {
  return request(`/api/patients/${encodeURIComponent(pid)}/scans/${encodeURIComponent(sid)}`, {
    method: 'DELETE'
  });
}

export function deletePatient(pid) {
  return request(`/api/patients/${encodeURIComponent(pid)}`, {
    method: 'DELETE'
  });
}

export function listPlans(caseId = null) {
  const query = caseId ? `?case_id=${encodeURIComponent(caseId)}` : '';
  return request(`/api/plans${query}`);
}

export function getPlan(id) {
  return request(`/api/plans/${encodeURIComponent(id)}`);
}

export function approvePlan(id) {
  return request(`/api/plans/${encodeURIComponent(id)}/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmed: true })
  });
}

export function revokeApproval(id) {
  return request(`/api/plans/${encodeURIComponent(id)}/approval`, {
    method: 'DELETE'
  });
}

export function requestReview(id) {
  return request(`/api/plans/${encodeURIComponent(id)}/review`, {
    method: 'POST'
  });
}

export function stlUrl(id) {
  return `/api/plans/${encodeURIComponent(id)}/stl.zip`;
}

export function rulePlan(body) {
  return request('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export async function chatStream(body, signal = null) {
  let res;
  try {
    res = await fetch('/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(body),
      signal
    });
  } catch (err) {
    throw new ApiError(0, err.message || T.errors.streamFailed);
  }

  if (!res.ok) {
    let message = res.statusText || T.errors.streamFailed;
    const text = await res.text();
    if (text) {
      try {
        const errJson = JSON.parse(text);
        if (errJson && errJson.detail) {
          message = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
        } else {
          message = text;
        }
      } catch (parseErr) {
        message = text;
      }
    }
    throw new ApiError(res.status, message);
  }

  return res;
}

export function nextFollowup(messages = []) {
  return request('/api/followup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages })
  });
}
