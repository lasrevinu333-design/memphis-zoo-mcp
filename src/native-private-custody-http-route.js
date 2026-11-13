import {
  privateCustodyExchangePath,
  privateCustodyCurrentQueryPath,
  sameOriginalRecoveryTargetPath,
  captureAuthenticatedPrivateCustodyExchange,
  captureAuthenticatedCurrentPrivateCustodyQuery,
  captureAuthenticatedSameOriginalRecoveryTarget,
  readAuthenticatedSameOriginalRecoveryTarget,
  readAuthenticatedPrivateCustodyExchange,
  readAuthenticatedPrivateCustodyReturnedPiece,
  recordAuthenticatedPrivateCustodyExchange,
  closeAuthenticatedPrivateCustodyExchangeCapture,
} from './native-private-custody-exchange.js';

const MAX_REQUEST_BYTES = 393216;
const MAX_CURRENT_QUERY_REQUEST_BYTES = 526336;
// Absolute body-receive lifetime, not a socket, authentication or SQL timeout.
// Traffic cannot renew it. It is canceled before any handler work starts.
const MAX_REQUEST_RECEIVE_MILLISECONDS = 30_000;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
// Server-owned source composition only. Never selected by employee request,
// environment default, query parameter or callback-supplied SQL/RPC name.
const BOUNDED_ORIGINAL_QUERY_REPLY = 'bounded-original-frame-piece.v1';

function failureResponse(error) {
  const status = Number.isInteger(error?.status) ? error.status : 403;
  const errorCode = typeof error?.code === 'string' && /^[a-z0-9_]{1,96}$/.test(error.code)
    ? error.code
    : 'native_private_custody_request_invalid';
  return {
    status,
    body: {
      ok: false,
      error: errorCode,
      state: status >= 500 ? 'PENDING_REVIEW' : status === 409 ? 'PENDING_REVIEW' : 'DENIED',
    },
  };
}

function reply(res, status, body) {
  if (res.headersSent || res.writableEnded) return;
  res.status(status).json(body);
}

function rejectRequest(res, status, code) {
  reply(res, status, {
    ok: false,
    error: code,
    state: status >= 500 || status === 409 ? 'PENDING_REVIEW' : 'DENIED',
  });
}

function ownBodyParser(path = privateCustodyExchangePath, maxRequestBytes = MAX_REQUEST_BYTES) {
  return (req, res, next) => {
    res.setHeader?.('Cache-Control', 'no-store');
    if (req.originalUrl !== path) {
      rejectRequest(res, 404, 'native_private_custody_exact_path_required');
      return;
    }
    if (req.aborted === true) {
      rejectRequest(res, 499, 'native_private_custody_request_aborted');
      return;
    }
    if (req.method !== 'POST') {
      rejectRequest(res, 405, 'native_private_custody_method_not_allowed');
      return;
    }
    const contentType = req.headers?.['content-type'] || '';
    const contentEncoding = req.headers?.['content-encoding'];
    if (!JSON_CONTENT_TYPE.test(contentType) || (contentEncoding && contentEncoding !== 'identity')) {
      rejectRequest(res, 415, 'native_private_custody_content_type_invalid');
      return;
    }

    let bytes = 0;
    let ended = false;
    let aborted = false;
    let settled = false;
    let receiveTimer;
    const parts = [];
    const stopReceiving = () => {
      if (receiveTimer !== undefined) {
        clearTimeout(receiveTimer);
        receiveTimer = undefined;
      }
      req.off?.('data', onData);
      req.off?.('end', onEnd);
      res.off?.('close', onResponseClose);
    };
    const cleanup = () => {
      stopReceiving();
      req.off?.('aborted', onAborted);
      req.off?.('close', onClose);
    };
    const clearParts = () => {
      for (const part of parts) part.fill(0);
      parts.length = 0;
      bytes = 0;
    };
    const finishEarly = (status, code, respond = true) => {
      if (settled) return;
      settled = true;
      cleanup();
      clearParts();
      if (respond && res.destroyed !== true) {
        if (!res.headersSent && !res.writableEnded) res.setHeader?.('Connection', 'close');
        rejectRequest(res, status, code);
      } else if (!res.writableEnded) {
        // Pre-dispatch only: no auth/read/write await or capture exists. Use
        // the normal end hook after cleanup, never touch the restore lease.
        res.end?.();
      }
    };
    const onData = (chunk) => {
      if (settled || aborted) return;
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += part.length;
      if (bytes > maxRequestBytes) {
        finishEarly(413, 'native_private_custody_request_too_large');
        return;
      }
      parts.push(Buffer.from(part));
    };
    const onAborted = () => {
      aborted = true;
      if (!ended) finishEarly(499, 'native_private_custody_request_aborted');
    };
    const onClose = () => {
      // close after a complete request is ordinary stream cleanup, not an abort.
      // Only this parser's observed end establishes complete original bytes.
      if (!ended) onAborted();
    };
    const onResponseClose = () => {
      aborted = true;
      finishEarly(499, 'native_private_custody_request_aborted', false);
    };
    const onEnd = () => {
      if (settled) return;
      ended = true;
      stopReceiving();
      if (aborted) {
        finishEarly(499, 'native_private_custody_request_aborted');
        return;
      }
      const raw = Buffer.concat(parts);
      clearParts();
      let parsed;
      try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw));
      } catch {
        raw.fill(0);
        finishEarly(400, 'native_private_custody_request_invalid');
        return;
      }
      req.scanAuthorityRawBody = raw;
      req.body = parsed;
      settled = true;
      req.nativePrivateCustodyRequestState = {
        isAborted: () => aborted,
        isResponseClosed: () => false,
        cleanup: () => {
          cleanup();
          // Own the allocation, not a mutable request property. A foreign
          // replacement must neither orphan this buffer nor be erased here.
          raw.fill(0);
          delete req.scanAuthorityRawBody;
          delete req.body;
          delete req.nativePrivateCustodyRequestState;
        },
      };
      next();
    };
    receiveTimer = setTimeout(() => finishEarly(408, 'native_private_custody_body_receive_timeout'), MAX_REQUEST_RECEIVE_MILLISECONDS);
    receiveTimer.unref?.();
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('aborted', onAborted);
    req.once('close', onClose);
    res.once?.('close', onResponseClose);
  };
}

async function handle(req, res, capabilities, queryReader,
  captureRequest = captureAuthenticatedPrivateCustodyExchange, queryOnly = false) {
  const lifecycle = req.nativePrivateCustodyRequestState;
  const isAborted = () => lifecycle?.isAborted?.() === true;
  let responseClosed = false;
  const onResponseClose = () => {
    if (!res.writableEnded) responseClosed = true;
  };
  res.once?.('close', onResponseClose);
  const isResponseClosed = () => responseClosed || lifecycle?.isResponseClosed?.() === true;
  let capture;
  try {
    if (isAborted() || isResponseClosed()) return;
    const clock = typeof capabilities.now === 'function' ? capabilities.now() : new Date();
    capture = await captureRequest(req, {
      env: capabilities.env,
      store: capabilities.store,
      runReadOnlySql: capabilities.runReadOnlySql,
      now: clock,
    });
    if (isAborted() || isResponseClosed()) return;
    if (queryOnly && capture?.mode !== 'QUERY') {
      throw Object.assign(new Error('current original private query capture required'), {
        code: 'native_private_custody_current_query_capture_invalid', status: 403,
      });
    }

    const data = !queryOnly && capture.mode === 'WRITE'
      ? await recordAuthenticatedPrivateCustodyExchange(capture, {
        db: capabilities.db,
        runReadOnlySql: capabilities.runReadOnlySql,
      })
      : await queryReader(capture, {
        runReadOnlySql: capabilities.runReadOnlySql,
      });
    if (isAborted() || isResponseClosed()) return;
    reply(res, 200, { ok: true, data });
  } catch (error) {
    if (!isAborted() && !isResponseClosed()) {
      const response = failureResponse(error);
      reply(res, response.status, response.body);
    }
  } finally {
    const responseWasClosed = isResponseClosed();
    if (capture) closeAuthenticatedPrivateCustodyExchangeCapture(capture);
    res.off?.('close', onResponseClose);
    lifecycle?.cleanup?.();
    // A disconnected response does not emit finish. Only after all awaited
    // work and owned capture/body cleanup have settled, use the normal end
    // hook to release this exact restore lease. Never send a success reply,
    // release during an unresolved await, retry, or change the restore guard.
    if (!res.writableEnded && (isAborted() || responseWasClosed)) res.end();
  }
}

/**
 * Registers the unmounted private-custody route. The caller must exempt this
 * exact path from any earlier body parser so this parser receives raw bytes.
 * No default Supabase client, process environment, SQL text, or credentials
 * are created here.
 */
export function installNativePrivateCustodyExchangeRoute(app, capabilities = {}) {
  if (!app || typeof app.post !== 'function') throw new TypeError('app.post is required');
  // Capture only normal references, not credentials or copies of live stores.
  // Later installer-field mutation cannot rebind this registered request's
  // authentication, writer, readback or clock after an awaited capture.
  const {env, store, db, runReadOnlySql, now, originalQueryReply} = capabilities;
  const fixedCapabilities = Object.freeze({env, store, db, runReadOnlySql, now});
  if (originalQueryReply !== undefined && originalQueryReply !== BOUNDED_ORIGINAL_QUERY_REPLY) {
    throw new TypeError('originalQueryReply must be the exact bounded original-frame contract or omitted for legacy readback');
  }
  // Pin the function once before registration/awaits. A mutated installer
  // object cannot switch an in-flight original QUERY or create a fallback.
  const queryReader = originalQueryReply === BOUNDED_ORIGINAL_QUERY_REPLY
    ? readAuthenticatedPrivateCustodyReturnedPiece
    : readAuthenticatedPrivateCustodyExchange;
  const required = ['env', 'store', 'db', 'runReadOnlySql'];
  for (const key of required) {
    if (!fixedCapabilities[key]) throw new TypeError(`${key} capability is required`);
  }
  if (typeof fixedCapabilities.env !== 'object' || fixedCapabilities.env === null) throw new TypeError('env capability must be an object');
  app.post(privateCustodyExchangePath, ownBodyParser(), (req, res) => handle(req, res, fixedCapabilities, queryReader));
  return Object.freeze({ path: privateCustodyExchangePath, method: 'POST', maxRequestBytes: MAX_REQUEST_BYTES });
}

/** The current read path uses only the owning capture and bounded piece reader. */
export function installNativePrivateCustodyCurrentQueryRoute(app, capabilities = {}) {
  if (!app || typeof app.post !== 'function') throw new TypeError('app.post is required');
  if (!capabilities || typeof capabilities !== 'object') throw new TypeError('capabilities must be an object');
  for (const key of Object.keys(capabilities)) {
    if (!['env', 'store', 'runReadOnlySql', 'now'].includes(key)) {
      throw new TypeError(`unsupported current-query capability: ${key}`);
    }
  }
  const {env, store, runReadOnlySql, now} = capabilities;
  if (!env || typeof env !== 'object') throw new TypeError('env capability must be an object');
  if (!store || typeof store !== 'object') throw new TypeError('store capability must be an object');
  if (typeof runReadOnlySql !== 'function') throw new TypeError('runReadOnlySql capability must be a function');
  if (now !== undefined && typeof now !== 'function') throw new TypeError('now capability must be a function');
  const fixedCapabilities = Object.freeze({env, store, runReadOnlySql, now});
  app.post(privateCustodyCurrentQueryPath,
    ownBodyParser(privateCustodyCurrentQueryPath, MAX_CURRENT_QUERY_REQUEST_BYTES),
    (req, res) => handle(req, res, fixedCapabilities,
      readAuthenticatedPrivateCustodyReturnedPiece, captureAuthenticatedCurrentPrivateCustodyQuery, true));
  return Object.freeze({path: privateCustodyCurrentQueryPath, method: 'POST',
    maxRequestBytes: MAX_CURRENT_QUERY_REQUEST_BYTES});
}

// Separate read-only metadata endpoint. No writer/client fallback or remotely
// selected protocol/path; global index mounting remains Main-owned/unqualified.
export function installSameOriginalRecoveryTargetRoute(app, capabilities = {}) {
  if (!app || typeof app.post !== 'function') throw new TypeError('app.post is required');
  for (const key of Object.keys(capabilities)) {
    if (!['env','store','runReadOnlySql','now'].includes(key)) throw new TypeError('unsupported target-read capability');
  }
  const {env,store,runReadOnlySql,now}=capabilities;
  if (!env || typeof env!=='object' || !store || typeof store!=='object' || typeof runReadOnlySql!=='function'
    || (now!==undefined&&typeof now!=='function')) throw new TypeError('target-read capabilities required');
  const fixed=Object.freeze({env,store,runReadOnlySql,now});
  app.post(sameOriginalRecoveryTargetPath,ownBodyParser(sameOriginalRecoveryTargetPath,MAX_CURRENT_QUERY_REQUEST_BYTES),
    (req,res)=>handle(req,res,fixed,readAuthenticatedSameOriginalRecoveryTarget,captureAuthenticatedSameOriginalRecoveryTarget,true));
  return Object.freeze({path:sameOriginalRecoveryTargetPath,method:'POST',maxRequestBytes:MAX_CURRENT_QUERY_REQUEST_BYTES});
}
