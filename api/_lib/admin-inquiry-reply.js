import { createHash } from 'node:crypto';

import { requireAdmin } from './admin-auth.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const FROM = 'NOVELIGHT <auth@novelight.jp>';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parsePositiveId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeReply(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const subject = String(payload.subject ?? '').trim();
  const message = String(payload.message ?? '').trim();

  if (!subject || subject.length > 160) return null;
  if (!message || message.length > 10000) return null;

  return { subject, message };
}

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function emailPayload({ to, subject, message }) {
  const htmlMessage = htmlEscape(message).replaceAll('\n', '<br>');
  return {
    from: FROM,
    to: [to],
    subject,
    text: message,
    html: `<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8"><title>${htmlEscape(subject)}</title></head>
  <body style="margin:0;padding:0;background:#f5f4ef;color:#1d2433;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Yu Gothic',sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px">
      <div style="background:#fff;border:1px solid #e5dfcf;border-radius:16px;padding:32px">
        <p style="margin:0 0 10px;color:#8a6f2d;font-size:13px;font-weight:700;letter-spacing:.08em">NOVELIGHT SUPPORT</p>
        <div style="font-size:15px;line-height:1.9;word-break:break-word">${htmlMessage}</div>
      </div>
    </div>
  </body>
</html>`
  };
}

function idempotencyKey({ id, to, subject, message }) {
  const digest = createHash('sha256')
    .update(`${id}\n${to}\n${subject}\n${message}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `novelight-inquiry-reply-${id}-${digest}`;
}

async function loadInquiry(supabase, id) {
  const { data, error } = await supabase
    .from('contact_inquiries')
    .select('id,email,subject,status')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function markResolved(supabase, adminUserId, id) {
  const { data, error } = await supabase.rpc(
    'novelight_admin_update_contact_inquiry_status',
    {
      p_admin_user_id: adminUserId,
      p_id: id,
      p_status: 'resolved'
    }
  );
  if (error) throw error;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

async function sendReplyEmail({ env, fetchImpl, id, to, subject, message }) {
  const apiKey = String(env.RESEND_API_KEY ?? '').trim();
  if (!apiKey) {
    const error = new Error('RESEND_API_KEY is unavailable');
    error.code = 'RESEND_NOT_CONFIGURED';
    throw error;
  }

  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey({ id, to, subject, message })
    },
    body: JSON.stringify(emailPayload({ to, subject, message }))
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok || !responseBody?.id) {
    const error = new Error('Resend rejected inquiry reply');
    error.code = 'RESEND_REJECTED';
    error.httpStatus = response.status;
    throw error;
  }

  return { id: responseBody.id };
}

export function createAdminInquiryReplyHandler({
  supabase,
  env = process.env,
  fetchImpl = globalThis.fetch,
  getInquiry = loadInquiry,
  setResolved = markResolved,
  sendReply = sendReplyEmail
}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const admin = await requireAdmin({ req, res, supabase, env });
    if (!admin) return;

    const id = parsePositiveId(req.body?.id);
    const reply = normalizeReply(req.body);
    if (!id || !reply) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    try {
      const inquiry = await getInquiry(supabase, id);
      if (!inquiry) return res.status(404).json({ error: 'Not found' });

      const to = String(inquiry.email ?? '')
        .trim()
        .toLowerCase();
      if (!EMAIL_PATTERN.test(to)) {
        return res.status(409).json({ error: 'Inquiry email is unavailable' });
      }

      const delivery = await sendReply({
        env,
        fetchImpl,
        id,
        to,
        subject: reply.subject,
        message: reply.message
      });
      const updatedInquiry = await setResolved(supabase, admin.id, id);

      return res.status(200).json({
        inquiry: updatedInquiry ?? { id, status: 'resolved' },
        delivery: { id: delivery.id }
      });
    } catch (error) {
      if (error?.code === 'RESEND_NOT_CONFIGURED') {
        return res
          .status(503)
          .json({ error: 'Email delivery is not configured' });
      }
      if (error?.code === 'RESEND_REJECTED') {
        console.error('NOVELIGHT inquiry reply delivery rejected', {
          status: error.httpStatus ?? null
        });
        return res.status(502).json({ error: 'Email delivery failed' });
      }
      console.error('NOVELIGHT inquiry reply failed', {
        message: error?.message ?? 'unknown error'
      });
      return res.status(500).json({ error: 'Inquiry reply unavailable' });
    }
  };
}
