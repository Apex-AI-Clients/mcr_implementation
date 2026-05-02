import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'noreply@mcrpartners.com.au'

interface SendInviteEmailParams {
  to: string
  clientName: string
  inviteLink: string
  customMessage?: string
  attachments?: { filename: string; content: Buffer }[]
}

export async function sendInviteEmail({
  to,
  clientName,
  inviteLink,
  customMessage,
  attachments,
}: SendInviteEmailParams) {
  const { data, error } = await resend.emails.send({
    from: `MCR Partners <${FROM_EMAIL}>`,
    to,
    subject: 'MCR Partners Preassessment Invitation',
    html: buildInviteHtml({ clientName, inviteLink, customMessage }),
    attachments: attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
  })

  if (error) {
    console.error('[sendInviteEmail] Resend error:', error)
    throw new Error(error.message)
  }

  return data
}

function buildInviteHtml({ clientName, inviteLink, customMessage }: { clientName: string; inviteLink: string; customMessage?: string }) {
  // Convert plain-text message to HTML paragraphs (split on double newlines for paragraphs,
  // single newlines become <br>, bullet lines become list items)
  const messageHtml = formatMessageToHtml(customMessage ?? '')

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MCR Partners Invitation</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7fa;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background-color:#1a3a5c;padding:36px 40px;text-align:center;">
              <h1 style="margin:0;font-size:26px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">
                MCR Partners
              </h1>
              <p style="margin:6px 0 0;font-size:13px;color:#a8c4e0;font-weight:400;letter-spacing:1px;text-transform:uppercase;">
                Preassessment Portal
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 20px;">
              <p style="margin:0 0 8px;font-size:15px;color:#64748b;">Hello,</p>
              <h2 style="margin:0 0 20px;font-size:22px;font-weight:600;color:#1e293b;">
                Welcome, ${escapeHtml(clientName)}
              </h2>
              ${messageHtml ? `<div style="margin:0 0 32px;font-size:15px;line-height:1.7;color:#475569;">${messageHtml}</div>` : `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569;">MCR Partners has invited you to their secure document portal. This is where you'll upload the financial documents we need to complete your preassessment.</p><p style="margin:0 0 32px;font-size:15px;line-height:1.7;color:#475569;">Click the button below to set up your account password and get started. The process takes just a few minutes.</p>`}
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding:0 40px 32px;" align="center">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#2563eb;border-radius:8px;">
                    <a href="${escapeHtml(inviteLink)}" target="_blank" style="display:inline-block;padding:14px 40px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">
                      Set Up Your Account
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:0;" />
            </td>
          </tr>

          <!-- Help text -->
          <tr>
            <td style="padding:24px 40px 12px;">
              <p style="margin:0 0 12px;font-size:13px;color:#94a3b8;line-height:1.6;">
                If the button above doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-size:12px;color:#2563eb;word-break:break-all;line-height:1.5;">
                ${escapeHtml(inviteLink)}
              </p>
            </td>
          </tr>

          <!-- Security note -->
          <tr>
            <td style="padding:16px 40px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f7ff;border-radius:8px;border:1px solid #dbeafe;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0;font-size:13px;color:#1e40af;line-height:1.6;">
                      <strong>Security note:</strong> This invitation link is unique to you. Do not forward this email. If you did not expect this invitation, please disregard it.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;text-align:center;">
                &copy; ${new Date().getFullYear()} MCR Partners. All rights reserved.
              </p>
              <p style="margin:0;font-size:12px;color:#cbd5e1;text-align:center;">
                This is an automated message from MCR Partners' secure portal.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ============================================================
// Reupload request email
// ============================================================

interface SendReuploadEmailParams {
  to: string
  clientName: string
  reason: string
  documentName?: string
}

export async function sendReuploadEmail({
  to,
  clientName,
  reason,
  documentName,
}: SendReuploadEmailParams) {
  const portalUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const { data, error } = await resend.emails.send({
    from: `MCR Partners <${FROM_EMAIL}>`,
    to,
    subject: 'MCR Partners — File Reupload Required',
    html: buildReuploadHtml({ clientName, reason, portalUrl, documentName }),
  })

  if (error) {
    console.error('[sendReuploadEmail] Resend error:', error)
    throw new Error(error.message)
  }

  return data
}

function buildReuploadHtml({
  clientName,
  reason,
  portalUrl,
  documentName,
}: {
  clientName: string
  reason: string
  portalUrl: string
  documentName?: string
}) {
  const docRef = documentName ? ` for <strong>${escapeHtml(documentName)}</strong>` : ''

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MCR Partners — Reupload Required</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7fa;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background-color:#1a3a5c;padding:36px 40px;text-align:center;">
              <h1 style="margin:0;font-size:26px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">
                MCR Partners
              </h1>
              <p style="margin:6px 0 0;font-size:13px;color:#a8c4e0;font-weight:400;letter-spacing:1px;text-transform:uppercase;">
                Preassessment Portal
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 20px;">
              <p style="margin:0 0 8px;font-size:15px;color:#64748b;">Hello ${escapeHtml(clientName)},</p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569;">
                We have reviewed your uploaded documents and a reupload is required${docRef}. Please log in to your portal and upload the corrected file at your earliest convenience.
              </p>
            </td>
          </tr>

          <!-- Reason box -->
          <tr>
            <td style="padding:0 40px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef3c7;border-radius:8px;border:1px solid #fde68a;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;">
                      Reason
                    </p>
                    <p style="margin:0;font-size:14px;color:#78350f;line-height:1.6;">
                      ${escapeHtml(reason)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding:0 40px 32px;" align="center">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#2563eb;border-radius:8px;">
                    <a href="${escapeHtml(portalUrl)}/portal" target="_blank" style="display:inline-block;padding:14px 40px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">
                      Open Your Portal
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;text-align:center;">
                &copy; ${new Date().getFullYear()} MCR Partners. All rights reserved.
              </p>
              <p style="margin:0;font-size:12px;color:#cbd5e1;text-align:center;">
                This is an automated message from MCR Partners' secure portal.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** Converts plain text with bullet points and paragraphs into simple HTML */
function formatMessageToHtml(text: string): string {
  if (!text.trim()) return ''

  const lines = text.split('\n')
  const parts: string[] = []
  let inList = false

  for (const line of lines) {
    const trimmed = line.trim()
    const isBullet = /^[•\-\*]\s/.test(trimmed)

    if (isBullet) {
      if (!inList) {
        parts.push('<ul style="margin:8px 0 8px 0;padding-left:20px;">')
        inList = true
      }
      parts.push(`<li style="margin:2px 0;font-size:15px;color:#475569;">${escapeHtml(trimmed.replace(/^[•\-\*]\s/, ''))}</li>`)
    } else {
      if (inList) {
        parts.push('</ul>')
        inList = false
      }
      if (trimmed === '') {
        parts.push('<br/>')
      } else {
        parts.push(`<p style="margin:0 0 8px;font-size:15px;line-height:1.7;color:#475569;">${escapeHtml(trimmed)}</p>`)
      }
    }
  }
  if (inList) parts.push('</ul>')

  return parts.join('')
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
