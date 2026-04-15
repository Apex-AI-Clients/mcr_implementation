import { CHECKLIST_ORDER, CATEGORY_META } from '@/lib/constants'

export function renderMagicLinkEmail({
  clientName,
  portalUrl,
  expiresAt,
}: {
  clientName: string
  portalUrl: string
  expiresAt: Date
}): string {
  const firstName = clientName.split(' ')[0]
  const expiryStr = expiresAt.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const documentsHtml = CHECKLIST_ORDER.map((cat) => {
    const meta = CATEGORY_META[cat]
    const optional = meta.isOptional ? ' <span style="color:#9ca3af;">(if applicable)</span>' : ''
    return `<li style="color:#1A1A2E;font-size:14px;line-height:28px;">${meta.label}${optional} — <span style="color:#6b7280;">${meta.formatLabel}</span></li>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:40px 0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
    <div style="background:#1A1A2E;padding:24px 32px;">
      <h1 style="color:#fff;font-size:20px;font-weight:700;margin:0;">MCR Partners</h1>
    </div>
    <div style="padding:32px;">
      <h2 style="color:#1A1A2E;font-size:22px;font-weight:600;margin:0 0 20px;">Your document portal is ready</h2>
      <p style="color:#374151;font-size:15px;line-height:24px;margin:0 0 16px;">Hi ${firstName},</p>
      <p style="color:#374151;font-size:15px;line-height:24px;margin:0 0 20px;">
        Thank you for working with MCR Partners. Please supply the following documents through your secure portal:
      </p>
      <ol style="margin:0 0 20px;padding:0 0 0 20px;">
        ${documentsHtml}
      </ol>
      <div style="background:#f9fafb;border-radius:8px;padding:16px 20px;margin:0 0 20px;">
        <p style="color:#374151;font-size:14px;line-height:22px;margin:0 0 8px;font-weight:600;">Please also:</p>
        <ul style="margin:0;padding:0 0 0 16px;">
          <li style="color:#374151;font-size:14px;line-height:24px;">Add us as admin on your ATO portal (MCR Partners, assist@mcrpartners.com.au)</li>
          <li style="color:#374151;font-size:14px;line-height:24px;">Provide your current accountant's contact details</li>
        </ul>
      </div>
      <div style="text-align:center;margin:32px 0;">
        <a href="${portalUrl}" style="background:#E94560;color:#fff;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;display:inline-block;">
          Open My Document Portal
        </a>
      </div>
      <p style="color:#6b7280;font-size:13px;line-height:20px;margin:0 0 16px;padding:12px 16px;background:#f9fafb;border-radius:6px;border-left:3px solid #E94560;">
        This link is personal to you and expires on <strong>${expiryStr}</strong>. Please do not share it.
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p style="color:#9ca3af;font-size:12px;line-height:18px;margin:0 0 8px;">
        If you need a new link, contact your MCR Partners advisor directly.
      </p>
      <p style="color:#9ca3af;font-size:12px;margin:0;">MCR Partners &middot; Debt Advisory &middot; Australia</p>
    </div>
  </div>
</body>
</html>`
}

export function renderReminderEmail({
  clientName,
  portalUrl,
  missingItems,
}: {
  clientName: string
  portalUrl: string
  missingItems: string[]
}): string {
  const firstName = clientName.split(' ')[0]
  const itemsHtml = missingItems
    .map(
      (item) =>
        `<p style="color:#1A1A2E;font-size:14px;line-height:24px;margin:2px 0;font-weight:500;">&middot; ${item}</p>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:40px 0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:540px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
    <div style="background:#1A1A2E;padding:24px 32px;">
      <h1 style="color:#fff;font-size:20px;font-weight:700;margin:0;">MCR Partners</h1>
    </div>
    <div style="padding:32px;">
      <h2 style="color:#1A1A2E;font-size:22px;font-weight:600;margin:0 0 20px;">A few more documents needed</h2>
      <p style="color:#374151;font-size:15px;line-height:24px;margin:0 0 16px;">Hi ${firstName},</p>
      <p style="color:#374151;font-size:15px;line-height:24px;margin:0 0 16px;">
        We are still waiting on a few documents to complete your file:
      </p>
      <div style="background:#fef2f2;border-radius:8px;padding:16px 20px;margin:0 0 20px;border-left:3px solid #E94560;">
        ${itemsHtml}
      </div>
      <div style="text-align:center;margin:28px 0;">
        <a href="${portalUrl}" style="background:#E94560;color:#fff;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;display:inline-block;">
          Upload Documents Now
        </a>
      </div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p style="color:#9ca3af;font-size:12px;line-height:18px;margin:0 0 8px;">
        If you have already uploaded these, our system may still be processing them — no action needed.
      </p>
      <p style="color:#9ca3af;font-size:12px;margin:0;">MCR Partners &middot; Debt Advisory &middot; Australia</p>
    </div>
  </div>
</body>
</html>`
}
